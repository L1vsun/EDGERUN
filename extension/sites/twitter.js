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

  const flush = E.debounce(async () => {
    if (!pending.size) return;
    const batch = new Map(pending);
    pending.clear();

    const addresses = [...new Set([...batch.values()].flatMap((v) => v.addresses))];
    const tickers = [...new Set([...batch.values()].flatMap((v) => v.tickers))];

    let verdicts = {};
    let resolved = {};
    try {
      [verdicts, resolved] = await Promise.all([
        addresses.length ? E.ask({ type: "verdicts", addresses }) : Promise.resolve({}),
        tickers.length ? E.ask({ type: "tickers", tickers }) : Promise.resolve({}),
      ]);
    } catch (err) {
      E.log("batch failed", err.message);
      return;
    }

    for (const [article, found] of batch) {
      if (!article.isConnected) continue; // scrolled away and unmounted while we waited
      render(article, found, verdicts, resolved);
    }
  }, 220);

  function render(article, found, verdicts, resolved) {
    if (article.querySelector('[data-edgerun="badge"]')) return;

    const results = found.addresses.map((a) => verdicts[a]).filter(Boolean);
    const tickers = found.tickers.map((t) => resolved[t]).filter(Boolean);

    // Every decision about what this post gets told lives in detect.js, where it can be
    // tested without a DOM. This function only draws the answer.
    const result = E.decideBadge({
      results,
      official: tickers.filter((t) => t.kind === "official"),
      onchain: tickers.filter((t) => t.kind === "onchain"),
      namedTickers: found.tickers,
    });
    if (!result) return;

    // A strip directly under the post text, not a chip tucked into the action bar. The
    // action bar is cramped, low-contrast and below the fold of the eye's path - a warning
    // about a fake contract has to sit in the reading flow, where it cannot be scrolled past.
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

    const text = article.querySelector('[data-testid="tweetText"]');
    const anchor = text?.parentElement?.contains(text) ? text : null;
    if (anchor) {
      anchor.insertAdjacentElement("afterend", badge);
    } else {
      // no post text (a card-only or media-only post): fall back to the action bar row
      const bar = article.querySelector('[role="group"]');
      if (!bar) return;
      bar.insertAdjacentElement("beforebegin", badge);
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
