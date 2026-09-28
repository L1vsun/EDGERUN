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

    // Who wrote each post in this batch. Gathered here rather than in render() so the whole
    // screen's worth of records comes back in one message instead of one per post.
    const authors = new Map();
    for (const [article] of batch) {
      const author = authorOf(article);
      if (author) authors.set(article, author);
    }
    const handles = [...new Set([...authors.values()].map((a) => a.handle))];

    let verdicts = {};
    let resolved = {};
    let mints = [];
    let callers = {};
    let clusters = {};
    try {
      [verdicts, resolved, mints, callers, clusters] = await Promise.all([
        addresses.length ? E.ask({ type: "verdicts", addresses }) : Promise.resolve({}),
        tickers.length ? E.ask({ type: "tickers", tickers }) : Promise.resolve({}),
        candidates.length ? E.ask({ type: "mints", candidates }) : Promise.resolve([]),
        handles.length ? E.ask({ type: "graph:callers", handles }) : Promise.resolve({}),
        addresses.length ? E.ask({ type: "graph:tokens", addresses }) : Promise.resolve({}),
      ]);
    } catch (err) {
      E.log("batch failed", err.message);
      return;
    }

    const byMint = new Map((mints || []).map((r) => [r.address, r]));

    for (const [article, found] of batch) {
      if (!article.isConnected) continue; // scrolled away and unmounted while we waited
      render(article, found, verdicts, resolved, byMint, authors.get(article), callers, clusters);
    }

    // After render, and that ordering is the point: the record shown under a post is the
    // account's record BEFORE this post was counted. "47 contracts, 9 flagged" describes what
    // they had already done when they handed you this one, which is the only version of the
    // sentence that is useful while deciding what to do about it.
    record(batch, verdicts, byMint);
  }, 220);

  /**
   * Log who posted what, for every contract in the batch - including the ones that got no
   * badge.
   *
   * Recording only the flagged ones would make the caller record meaningless: an account's
   * number is "nine of the forty-seven contracts you posted failed", and the forty-seven is
   * half of that sentence. A clean call is still a call.
   *
   * Only contracts count - an 0x address or a resolved Solana mint. A post that says "$TSLA
   * earnings tomorrow" has named a ticker, not made a call, and counting it would turn every
   * finance account on the timeline into a caller.
   *
   * Mints were missed entirely at first: this bailed on `!found.addresses.length` and looped
   * only over addresses, so on a Solana-heavy feed the graph stayed empty while the badges
   * worked fine. Reported from the field 2026-09-24 as "0 accounts after scrolling a lot".
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
  function record(batch, verdicts, byMint) {
    const sightings = [];
    for (const [article, found] of batch) {
      // Only mints the worker actually resolved count. `found.mints` are raw base58
      // candidates and most of them are not keys at all.
      const mints = (found.mints || []).filter((m) => byMint.has(m));
      const anything = found.addresses.length || mints.length || found.tickers.length;
      if (!anything || !article.isConnected) continue;

      const author = authorOf(article);
      if (!author) continue;
      const own = article.querySelector('[data-testid="tweetText"]');
      if (!own) continue; // media- or card-only post: nothing the author themselves wrote

      const theirs = E.findTokens(own.innerText || "");
      const written = new Set([...theirs.addresses, ...theirs.mints]);

      // Tickers the author wrote themselves. Counted, never charged - see the note on
      // `recordSightings`. A page of real timeline is mostly this, and dropping it was why a
      // scan could read eighty-seven posts and report finding nothing at all.
      for (const ticker of theirs.tickers.slice(0, 6)) {
        sightings.push({ handle: author.handle, display: author.display, ticker });
      }

      for (const token of [...found.addresses, ...mints]) {
        if (!written.has(token)) continue; // it came from a quoted post, not from them
        const v = verdicts[token] || byMint.get(token) || null;
        sightings.push({
          handle: author.handle,
          display: author.display,
          address: token,
          symbol: v?.symbol || null,
          verdict: v?.verdict || null,
        });
      }
    }
    if (sightings.length) E.ask({ type: "graph:record", sightings }).catch(() => {});
  }

  function render(article, found, verdicts, resolved, byMint, author, callers = {}, clusters = {}) {
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

    // Computed before the early return, because it can be the ONLY thing worth saying. Six
    // accounts pushing one contract into a feed inside eleven minutes is a finding even when
    // that contract passes every check there is - and it is the finding a scanner cannot
    // reach, so returning early on "no token badges" would have hidden the whole point.
    const account = E.decideAccount({
      caller: author ? callers[author.handle.toLowerCase()] || null : null,
      clusters,
      addresses: [...found.addresses, ...(found.mints || []).filter((m) => byMint.has(m))],
    });
    if (!found_.length && !account) return;

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

    // The account sits under the verdicts: the contract is what you act on now, the record is
    // the context for it.
    if (account) {
      const strip = E.makeAccountStrip(account, {
        onOpen: (handle) => E.ask({ type: "panel:caller", handle }).catch(() => {}),
      });
      if (strip) strips.append(strip);
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

  /* ---- the profile card, and the cold start it fixes ----
   *
   * The account record is the thing here a server cannot produce, and until now it built up
   * only as a side effect of ordinary scrolling. That made a fresh install look like a plain
   * token checker for the first few days: every badge was about a contract, because there was
   * no history behind any account yet.
   *
   * A profile page fixes both halves at once. It is the one page where showing a whole record
   * is obviously wanted, and it is also a list of exactly the posts needed to build one. The
   * scan below does what a reader would do by hand - scroll their timeline - and lets the
   * existing observer do the recording. Nothing is fetched behind X's back: the same posts,
   * the same detection, the same attribution rules, just without the wrist work.
   */
  let profileFor = null;   // whose card is currently on the page
  let scanning = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Ten seconds. Long enough to read a real slice of a timeline, short enough to sit through. */
  const SCAN_MS = 10000;

  /*
   * How hard to push.
   *
   * There is a real tension here and it is worth naming: X unmounts posts as they leave the
   * viewport, so scrolling FASTER covers more timeline but reads less of it - a post that
   * mounts and unmounts between two ticks is never seen. What makes this survivable is that
   * detection fires on a 600px margin rather than on screen, so a post is picked up before it
   * arrives and stays eligible for a step or two after.
   *
   * 0.8 of a viewport every 450ms is the compromise: about twenty-two screens in ten seconds,
   * with every post spending at least one full tick inside the detection margin.
   */
  const STEP = 0.8;
  const TICK = 450;

  /** Permalinks of the posts currently mounted - the honest way to count what was read. */
  function harvest(into) {
    let added = 0;
    for (const a of document.querySelectorAll('article[data-testid="tweet"] a[href*="/status/"]')) {
      const href = a.getAttribute("href") || "";
      const m = /\/status\/(\d+)/.exec(href);
      if (m && !into.has(m[1])) {
        into.add(m[1]);
        added++;
      }
    }
    return added;
  }

  async function scanProfile({ onProgress, stopped } = {}) {
    if (scanning) return null;
    scanning = true;
    const handle = E.profileHandleFrom(location.pathname);
    const seen = new Set();
    try {
      const until = Date.now() + SCAN_MS;
      let quiet = 0;
      harvest(seen);
      while (Date.now() < until && !stopped?.()) {
        window.scrollBy(0, Math.round(window.innerHeight * STEP));
        await sleep(TICK);
        const added = harvest(seen);
        onProgress?.({ posts: seen.size, left: Math.max(0, until - Date.now()) });
        // Three quiet ticks means the end of the timeline, or a rate limit. Either way there
        // is nothing further down to read, so stop rather than spend the rest of the budget
        // scrolling against a wall.
        if (added === 0 && ++quiet >= 3) break;
        if (added > 0) quiet = 0;
      }

      // The last batch is still in flight: the 220ms flush plus a worker round trip.
      await sleep(700);
      window.scrollTo({ top: 0, behavior: "auto" });
      await sleep(250);
      const record = await E.ask({ type: "graph:caller", handle });
      return { record, posts: seen.size };
    } catch (err) {
      E.log("profile scan failed", err.message);
      return null;
    } finally {
      scanning = false;
    }
  }

  const profileAnchor = () => E.profileAnchorIn(document.querySelector('[data-testid="primaryColumn"]'));

  /*
   * React can pull the card out again while the profile hydrates. Rather than fight that, put
   * it back.
   *
   * Bounded by TIME rather than by a number of attempts, which was the first instinct and the
   * wrong one: a count has to guess how many times React will re-render before it settles,
   * and guessing twelve means giving up on the thirteenth - on exactly the page that needed
   * one more. A window covers the whole hydration burst however many renders that takes, and
   * then stops for good.
   *
   * Past the window nothing is lost. `sweep()` already rebuilds the card from scratch on any
   * later mutation; this observer only exists because it can do the same thing synchronously,
   * without a round trip to the worker, during the one second where the flicker is visible.
   */
  const HEAL_MS = 20000;
  let healer = null;

  function mountCard(card, spot) {
    spot.el.insertAdjacentElement(spot.where, card);
    healer?.disconnect();
    const until = Date.now() + HEAL_MS;
    healer = new MutationObserver(() => {
      if (card.isConnected) return;
      if (Date.now() > until || E.profileHandleFrom(location.pathname) !== profileFor) {
        return void healer?.disconnect();
      }
      const again = profileAnchor();
      if (again) again.el.insertAdjacentElement(again.where, card);
    });
    healer.observe(document.body, { childList: true, subtree: true });
  }

  // The card we built for the profile currently open, kept so putting it back costs nothing.
  let currentCard = null;

  async function profileCard() {
    const handle = E.profileHandleFrom(location.pathname);
    if (handle !== profileFor) {
      healer?.disconnect();
      healer = null;
      document.querySelector('[data-edgerun="profile"]')?.remove();
      currentCard = null;
      profileFor = handle;
    }
    if (!handle) return;

    // Already up and attached: nothing to do.
    if (currentCard?.isConnected) return;

    /*
     * Built once, then pulled out of the tree by a re-render. Put the SAME element straight
     * back, synchronously.
     *
     * The first version had no branch here: a removed card meant building a new one, which
     * meant waiting on the worker for the record first. Every re-render therefore cost a
     * message round trip before anything could reappear, and while that was in flight the
     * page had usually re-rendered again - so the card lost the race repeatedly and read as
     * simply gone. Reusing the element removes the wait entirely.
     */
    if (currentCard) {
      const back = profileAnchor();
      if (back) mountCard(currentCard, back);
      return;
    }

    if (document.querySelector('[data-edgerun="profile"]')) return;

    const spot = profileAnchor();
    if (!spot) return; // the profile has not rendered yet; the next mutation brings us back

    let record = null;
    try {
      record = await E.ask({ type: "graph:caller", handle });
    } catch {
      /* worker asleep or storage blocked: the card still draws, empty and honest */
    }
    if (E.profileHandleFrom(location.pathname) !== handle) return; // navigated away while waiting
    if (document.querySelector('[data-edgerun="profile"]')) return;

    const fresh = profileAnchor();
    if (!fresh) return;

    currentCard = E.makeProfileCard(handle, record, {
      onScan: scanProfile,
      onOpen: (h) => E.ask({ type: "panel:caller", handle: h }).catch(() => {}),
    });
    mountCard(currentCard, fresh);
  }

  function sweep() {
    profileCard();
    for (const article of tweets()) {
      article.setAttribute(SEEN, "1");
      E.whenNear(article, () => {
        const found = E.findTokens(textOf(article));
        // Mints count here too. Leaving them out of this gate meant a post whose only
        // contract was a Solana mint never entered the batch at all - no scan, no badge, no
        // sighting - which on a pump.fun-shaped feed is most of the posts that matter.
        if (!found.addresses.length && !found.tickers.length && !found.mints.length) return;
        pending.set(article, found);
        flush();
      });
    }
  }

  E.watch(document.body, sweep, 300);

  /*
   * SPA navigation, which mutations alone do not reliably announce.
   *
   * Dexscreener and Blockscout have both used this since they were written; X, the one
   * surface here that is actually a single-page app, was relying entirely on the mutation
   * sweep. Moving between two profiles therefore left whichever card happened to be mounted
   * sitting under the wrong account until something else happened to trigger a sweep.
   */
  E.onRouteChange(() => {
    healer?.disconnect();
    healer = null;
    document.querySelector('[data-edgerun="profile"]')?.remove();
    currentCard = null;
    profileFor = null;
    sweep();
  });
  E.log("x surface active");
})();
