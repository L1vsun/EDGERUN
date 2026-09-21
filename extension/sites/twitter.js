// X / Twitter: a badge on any post that names a Robinhood Chain token.
//
// The timeline is virtualised — posts are unmounted as they scroll away and remounted when
// they come back — so every article is tagged the moment it is first seen and never
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
    const officialTickers = found.tickers.map((t) => resolved[t]).filter(Boolean);

    // The cross-check. An official ticker named next to a contract that is not that
    // ticker's registry address is the strongest thing this extension can say.
    let mismatch = null;
    for (const official of officialTickers) {
      for (const r of results) {
        if (r.address !== official.address) {
          mismatch = { official, given: r };
          break;
        }
      }
      if (mismatch) break;
    }

    let result;
    if (mismatch) {
      result = {
        ...mismatch.given,
        verdict: "FAIL",
        symbol: `$${mismatch.official.ticker}`,
        lead: `This post names $${mismatch.official.ticker}, which Robinhood publishes at ${mismatch.official.address.slice(0, 10)}… — but the contract in the post is ${mismatch.given.address.slice(0, 10)}…, a different token.`,
      };
    } else if (results.length) {
      result = results.sort((a, b) => (RANK[b.verdict] || 0) - (RANK[a.verdict] || 0))[0];
      if (results.length > 1) {
        result = { ...result, lead: `${results.length} tokens named in this post; showing the one that matters most.` };
      }
    } else if (officialTickers.length) {
      const o = officialTickers[0];
      result = {
        address: o.address,
        symbol: `$${o.ticker}`,
        verdict: "OFFICIAL",
        level: "identity",
        scannedAt: Date.now(),
        explorerUrl: `https://robinhoodchain.blockscout.com/address/${o.address}`,
        lead: `$${o.ticker} (${o.name}) is an official Robinhood tokenised stock at ${o.address}. This post names no contract address — check any address you are given against that one.`,
        checks: [{ id: "stock_token", label: "official address", status: "ok", detail: `${o.ticker} → ${o.address}, from Robinhood's published registry` }],
      };
    } else {
      return;
    }

    const badge = E.makeBadge({
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

    const bar = article.querySelector('[role="group"]');
    if (bar) {
      const slot = document.createElement("div");
      slot.style.cssText = "display:inline-flex;align-items:center;margin-left:8px;";
      slot.appendChild(badge);
      bar.appendChild(slot);
    } else {
      // no action bar (a quoted or embedded post): sit under the text instead
      const text = article.querySelector('[data-testid="tweetText"]');
      if (!text) return;
      const slot = document.createElement("div");
      slot.style.cssText = "margin:6px 0 2px;";
      slot.appendChild(badge);
      text.insertAdjacentElement("afterend", slot);
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
