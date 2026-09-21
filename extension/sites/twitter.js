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
    const official = tickers.filter((t) => t.kind === "official");
    const onchain = tickers.filter((t) => t.kind === "onchain");
    const url = (a) => `https://robinhoodchain.blockscout.com/address/${a}`;
    const stamp = { level: "identity", scannedAt: Date.now() };

    let result;

    // 1. The strongest claim available: an official ticker named next to a contract that is
    //    not that ticker's registry address. Provable from Robinhood's own registry.
    const wrongOfficial = official
      .map((o) => ({ o, given: results.find((r) => r.address !== o.address) }))
      .find((x) => x.given);

    // 2. Weaker but still a fact: the post names a ticker and hands over a contract whose
    //    own symbol is something else. Stated as an observation, not an accusation - a post
    //    can legitimately mention one token and link another.
    const wrongSymbol = !wrongOfficial && onchain
      .map((t) => ({ t, given: results.find((r) => r.symbol && r.symbol.toUpperCase().replace(/^\$/, "") !== t.ticker) }))
      .find((x) => x.given);

    if (wrongOfficial) {
      const { o, given } = wrongOfficial;
      result = {
        ...given,
        verdict: "FAIL",
        symbol: `$${o.ticker}`,
        lead: `This post names $${o.ticker}, which Robinhood publishes at ${o.address.slice(0, 10)}… - but the contract in the post is ${given.address.slice(0, 10)}…, a different token.`,
      };
    } else if (wrongSymbol) {
      const { t, given } = wrongSymbol;
      result = {
        ...given,
        verdict: given.verdict === "FAIL" ? "FAIL" : "CAUTION",
        symbol: `$${t.ticker}`,
        lead: `The post says $${t.ticker}, but the contract it gives is ${given.symbol}. They are not the same token - check which one you actually want.`,
      };
    } else if (results.length) {
      result = results.sort((a, b) => (RANK[b.verdict] || 0) - (RANK[a.verdict] || 0))[0];
      if (results.length > 1) {
        result = { ...result, lead: `${results.length} tokens named in this post; showing the one that matters most.` };
      }
    } else if (official.length) {
      const o = official[0];
      result = {
        ...stamp,
        address: o.address,
        symbol: `$${o.ticker}`,
        verdict: "OFFICIAL",
        explorerUrl: url(o.address),
        lead: `$${o.ticker} (${o.name}) is an official Robinhood tokenised stock at ${o.address}. This post names no contract address - check any address you are given against that one.`,
        checks: [{ id: "stock_token", label: "official address", status: "ok", detail: `${o.ticker} → ${o.address}, from Robinhood's published registry` }],
      };
    } else if (onchain.length) {
      // A ticker that belongs to nobody. The count IS the answer.
      const t = onchain[0];
      const many = t.count > 1;
      result = {
        ...stamp,
        address: t.candidates[0].address,
        symbol: `$${t.ticker}`,
        verdict: many ? "CAUTION" : "UNRESOLVED",
        explorerUrl: url(t.candidates[0].address),
        lead: many
          ? `$${t.ticker} is not one token here - at least ${t.count} different contracts use that ticker on this chain, and this post does not say which. That is how people buy the wrong one.`
          : `$${t.ticker} matches one contract on this chain (${t.candidates[0].name || "unnamed"}). Nothing about that contract has been checked yet.`,
        checks: [
          {
            id: "ticker", label: "ticker", status: many ? "warn" : "unresolved",
            detail: many
              ? `${t.count}${t.capped ? "+" : ""} contracts on Robinhood Chain use the symbol ${t.ticker}. No registry decides which is "the" one - only an address does.`
              : `one contract on this chain uses the symbol ${t.ticker}`,
          },
          ...t.candidates.map((c) => ({
            id: `cand:${c.address}`, label: c.name || "unnamed", status: "unresolved",
            detail: `${c.address}${c.verified ? " · source verified" : " · source not verified"}`,
          })),
        ],
      };
    } else {
      return;
    }

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
