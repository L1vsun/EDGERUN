// X / Twitter: a badge on any post that names a Robinhood Chain token.
//
// The timeline is virtualised - posts are unmounted as they scroll away and remounted when
// they come back - so every article is tagged the moment it is first seen and never
// processed twice. Nothing is read until a post is near the viewport, and every address
// found in a scroll batch is resolved in one message to the worker, which answers the whole
// batch from the registry plus a single JSON-RPC round trip.
//
// The check that matters here is the cross-check: a post that says $TSLA and pastes a
// contract address which is not Robinhood's published TSLA address is showing you a
// different token than the one it names. That is provable from the registry alone, it needs
// no backend, and it is the whole reason this surface exists.

(() => {
  const E = globalThis.EDGERUN;
  if (!E || window.__edgerunX) return;
  window.__edgerunX = true;

  const SEEN = "data-edgerun-seen";
  const RANK = { FAIL: 4, CAUTION: 3, OFFICIAL: 2, PASS: 2, UNRESOLVED: 1 };
  const pending = new Map(); // article -> { addresses, tickers }

  const tweets = () => document.querySelectorAll(`article[data-testid="tweet"]:not([${SEEN}])`);

  function textOf(article) {
    // innerText of the whole article picks up the post, any quoted post, and link-card text
    // in one read. Images and video are out of scope for this version by design.
    return article.innerText || "";
  }

  /**
   * The account that posted this, not the one being quoted.
   *
   * A quoted post is a second User-Name block nested inside the same article, so the first
   * one in document order is the author and the rest are other people. That distinction is
   * the whole ball game here: charging someone with a contract that appeared in a post they
   * quoted would be exactly backwards.
   */
  function authorOf(article) {
    const block = article.querySelector('[data-testid="User-Name"]');
    if (!block) return null;
    const hrefs = [...block.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
    return E.authorFrom({ hrefs, text: block.innerText || "" });
  }

  const flush = E.debounce(async () => {
    if (!pending.size) return;
    const batch = new Map(pending);
    pending.clear();

    const addresses = [...new Set([...batch.values()].flatMap((v) => v.addresses))];
    const tickers = [...new Set([...batch.values()].flatMap((v) => v.tickers))];
    const candidates = [...new Set([...batch.values()].flatMap((v) => v.mints || []))];

    let verdicts = {};
    let resolved = {};
    let mints = [];
    try {
      [verdicts, resolved, mints] = await Promise.all([
        addresses.length ? E.ask({ type: "verdicts", addresses }) : Promise.resolve({}),
        tickers.length ? E.ask({ type: "tickers", tickers }) : Promise.resolve({}),
        candidates.length ? E.ask({ type: "mints", candidates }) : Promise.resolve([]),
      ]);
    } catch (err) {
      E.log("batch failed", err.message);
      return;
    }

    const byMint = new Map((mints || []).map((r) => [r.address, r]));

    for (const [article, found] of batch) {
      if (!article.isConnected) continue; // scrolled away and unmounted while we waited
      render(article, found, verdicts, resolved, byMint);
    }

    record(batch, verdicts);
  }, 220);

  /**
   * Log who posted what, for every contract in the batch - including the ones that got no
   * badge.
   *
   * Recording only the flagged ones would make the caller record meaningless: an account's
   * number is "nine of the forty-seven contracts you posted failed", and the forty-seven is
   * half of that sentence. A clean call is still a call.
   *
   * Only addresses count. A post that says "$TSLA earnings tomorrow" has named a ticker, not
   * made a call, and counting it would turn every finance account on the timeline into a
   * caller.
   *
   * And only addresses in the author's OWN text count. The badge reads the whole article -
   * quoted post, link card and all - because anything on screen can be what the reader acts
   * on. Attribution cannot be that wide: a post quoting a scam carries the scammer's contract
   * in its article text, and charging the quoter with it is the same false-accusation shape
   * as the $DOGGIE bug. The first `tweetText` in an article is the author's own; a quoted
   * post's text is a later one.
   *
   * Known limit: an account warning about a contract has still posted that contract, and
   * nothing here can tell a warning from a shill. The per-contract list in the panel is what
   * a reader checks before believing the headline count.
   */
  function record(batch, verdicts) {
    const sightings = [];
    for (const [article, found] of batch) {
      if (!found.addresses.length || !article.isConnected) continue;
      const author = authorOf(article);
      if (!author) continue;
      const own = article.querySelector('[data-testid="tweetText"]');
      if (!own) continue; // media- or card-only post: nothing the author themselves wrote
      const written = new Set(E.findTokens(own.innerText || "").addresses);
      for (const address of found.addresses) {
        if (!written.has(address)) continue; // it came from a quoted post, not from them
        const v = verdicts[address];
        sightings.push({
          handle: author.handle,
          display: author.display,
          address,
          symbol: v?.symbol || null,
          verdict: v?.verdict || null,
        });
      }
    }
    if (sightings.length) E.ask({ type: "graph:record", sightings }).catch(() => {});
  }

  function render(article, found, verdicts, resolved, byMint) {
    if (article.querySelector('[data-edgerun="badge"]')) return;

    const results = found.addresses.map((a) => verdicts[a]).filter(Boolean);
    const tickers = found.tickers.map((t) => resolved[t]).filter(Boolean);
    const solana = (found.mints || []).map((m) => byMint.get(m)).filter(Boolean);

    // Every decision about what this post gets told lives in detect.js, where it can be
    // tested without a DOM. This function only draws the answers.
    //
    // Answers, plural: a post naming three tokens gets three strips. Picking one and saying
    // "showing the one that matters most" was answering a question nobody asked - somebody
    // who pastes three contracts is talking about three things.
    const found_ = E.decideBadges({
      results,
      official: tickers.filter((t) => t.kind === "official"),
      onchain: tickers.filter((t) => t.kind === "onchain"),
      namedTickers: found.tickers,
      solana,
    });
    if (!found_.length) return;

    // A strip directly under the post text, not a chip tucked into the action bar. The
    // action bar is cramped, low-contrast and below the fold of the eye's path - a warning
    // about a fake contract has to sit in the reading flow, where it cannot be scrolled past.
    const strips = document.createElement("div");
    strips.setAttribute("data-edgerun", "badge");
    for (const result of found_) {
      const badge = E.makeBadge({
        mode: "block",
        onFull: async (address) => {
          try {
            const full = await E.ask({ type: "verdict", address, level: "full", fresh: true });
            badge.update(full);
          } catch (err) {
            badge.fail(err.message);
          }
        },
        onWatch: (address) => E.ask({ type: "watch:toggle", address }).catch(() => {}),
      });
      badge.update(result);
      strips.append(badge);
    }

    const text = article.querySelector('[data-testid="tweetText"]');
    const anchor = text?.parentElement?.contains(text) ? text : null;
    if (anchor) {
      anchor.insertAdjacentElement("afterend", strips);
    } else {
      // no post text (a card-only or media-only post): fall back to the action bar row
      const bar = article.querySelector('[role="group"]');
      if (!bar) return;
      bar.insertAdjacentElement("beforebegin", strips);
    }
  }

  function sweep() {
    for (const article of tweets()) {
      article.setAttribute(SEEN, "1");
      E.whenNear(article, () => {
        const found = E.findTokens(textOf(article));
        if (!found.addresses.length && !found.tickers.length) return;
        pending.set(article, found);
        flush();
      });
    }
  }

  E.watch(document.body, sweep, 300);
  E.log("x surface active");
})();
