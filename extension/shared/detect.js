// Finding tokens in arbitrary page text, and the plumbing every surface shares.
//
// Two things are being looked for, and they are not equally trustworthy:
//
//   a contract address - unambiguous. 0x + 40 hex, and the chain settles the rest.
//   a $TICKER          - ambiguous by construction on this chain. A ten-ticker sweep found
//                        213 contracts using an official ticker. So a ticker is only ever
//                        resolved against Robinhood's own registry: if it is an official
//                        stock ticker we can name the one true address, and if it is not,
//                        no badge is drawn at all. Guessing which of 213 contracts someone
//                        meant would be worse than saying nothing.

(() => {
  const E = (globalThis.EDGERUN = globalThis.EDGERUN || {});
  if (E.findTokens) return;

  const ADDRESS_RE = /0x[0-9a-fA-F]{40}/g;
  // v4 pools are identified by a 32-byte id, which is not an address and must not be
  // mistaken for one when it shows up in a URL or a post.
  const POOL_ID_RE = /0x[0-9a-fA-F]{64}/g;
  const TICKER_RE = /\$([A-Za-z]{2,8})\b/g;

  E.ADDRESS_RE = ADDRESS_RE;
  E.POOL_ID_RE = POOL_ID_RE;
  E.isAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(String(s || "").trim());

  /** Everything worth asking about in a blob of text. */
  E.findTokens = function findTokens(text) {
    if (!text) return { addresses: [], tickers: [] };
    const withoutPools = text.replace(POOL_ID_RE, " ");
    const addresses = [...new Set((withoutPools.match(ADDRESS_RE) || []).map((a) => a.toLowerCase()))];
    const tickers = [...new Set([...text.matchAll(TICKER_RE)].map((m) => m[1].toUpperCase()))];
    return { addresses, tickers };
  };

  /** Promise wrapper over the worker's message API. Resolves to data, throws on error. */
  E.ask = function ask(message) {
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        chrome.runtime.sendMessage(message, (reply) => {
          if (settled) return;
          settled = true;
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message));
          if (!reply) return reject(new Error("no reply from the extension worker"));
          if (!reply.ok) return reject(new Error(reply.error));
          resolve(reply.data);
        });
      } catch (err) {
        // the worker is gone mid-navigation, or the extension was just reloaded
        if (!settled) reject(err);
      }
    });
  };

  E.debounce = function debounce(fn, ms) {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  /**
   * Batched DOM watching. The callback fires at most once per `ms` no matter how much the
   * page mutates - both X and Dexscreener rewrite their DOM constantly, and re-walking on
   * every mutation is how an extension makes a host page feel broken.
   */
  E.watch = function watch(target, fn, ms = 250) {
    const run = E.debounce(fn, ms);
    const mo = new MutationObserver(run);
    mo.observe(target || document.documentElement, { childList: true, subtree: true });
    run();
    return () => mo.disconnect();
  };

  /** Calls `fn(el)` the first time an element comes near the viewport. */
  E.whenNear = function whenNear(el, fn, margin = "600px") {
    if (!("IntersectionObserver" in window)) return fn(el);
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.disconnect();
        fn(el);
      }
    }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  };

  /**
   * Waits for a host-page element to exist. Both of these sites render their heading after
   * the shell, so "look once at document_idle" finds nothing and the badge ends up wherever
   * the fallback puts it. Resolves null on timeout, and the caller decides what to do then -
   * which is never "inject it somewhere random".
   */
  E.waitFor = function waitFor(find, timeout = 8000) {
    return new Promise((resolve) => {
      const found = find();
      if (found) return resolve(found);
      const started = Date.now();
      const iv = setInterval(() => {
        const el = find();
        if (el || Date.now() - started > timeout) {
          clearInterval(iv);
          resolve(el || null);
        }
      }, 200);
    });
  };

  /** SPA navigation, which a plain load listener misses entirely. */
  E.onRouteChange = function onRouteChange(fn) {
    let last = location.href;
    const fire = () => {
      if (location.href === last) return;
      last = location.href;
      fn(location.href);
    };
    for (const m of ["pushState", "replaceState"]) {
      const orig = history[m];
      history[m] = function (...args) {
        const r = orig.apply(this, args);
        setTimeout(fire, 0);
        return r;
      };
    }
    window.addEventListener("popstate", () => setTimeout(fire, 0));
    // some routers swap the view without touching history at all
    setInterval(fire, 1200);
  };

  /**
   * Which official ticker, if any, is this post actually passing an address off as.
   *
   * The naive pairing - "an official ticker appears, an address appears, they differ" - is a
   * false-accusation machine. A post saying "$DOGGIE, which is paired with $TSLA" alongside
   * DOGGIE's own contract names an official ticker and a contract that is not it, and means
   * nothing whatever by it. Flagging that is worse than missing a fake, because it burns a
   * real project and it is the kind of mistake that gets a tool uninstalled.
   *
   * So an address is only a claim against a ticker when the post gives no other explanation
   * for it:
   *
   *   impersonation - the contract's own symbol IS that official ticker, and it is not the
   *                   registry address. Nothing ambiguous about it, whatever else the post
   *                   mentions.
   *   mismatch      - the post names exactly one ticker and hands over an unrelated address,
   *                   so the pairing is unambiguous even though the contract claims nothing.
   *   ambiguous     - several tickers named and the address matches none of them. We cannot
   *                   know which one it was offered as, so this is reported, not charged.
   *   (explained)   - the contract's symbol is another ticker the post also names. No claim
   *                   exists. This is the $DOGGIE case, and it produces no finding at all.
   *
   * @returns {{o: object, given: object, strength: "impersonation"|"mismatch"|"ambiguous"}|null}
   */
  E.pairTickerClaims = function pairTickerClaims(official, results, namedTickers) {
    const named = new Set((namedTickers || []).map((t) => String(t).toUpperCase().replace(/^\$/, "")));
    const symbolOf = (r) => String(r?.symbol || "").toUpperCase().replace(/^\$/, "");
    const claims = [];

    for (const o of official || []) {
      const ticker = String(o.ticker || "").toUpperCase();
      for (const r of results || []) {
        if (!r?.address || r.address.toLowerCase() === String(o.address || "").toLowerCase()) continue;
        const sym = symbolOf(r);
        if (sym && sym === ticker) claims.push({ o, given: r, strength: "impersonation" });
        else if (sym && named.has(sym)) continue; // another ticker in the post accounts for it
        else if (named.size <= 1) claims.push({ o, given: r, strength: "mismatch" });
        else claims.push({ o, given: r, strength: "ambiguous" });
      }
    }

    const RANKS = { impersonation: 3, mismatch: 2, ambiguous: 1 };
    return claims.sort((a, b) => RANKS[b.strength] - RANKS[a.strength])[0] || null;
  };

  /**
   * What the badge on a post should say, or null for no badge at all.
   *
   * Extracted from the X surface because it is the part that gets decisions wrong: it
   * decides whether a post is accused, informed about, or left alone, and both of the
   * false positives found in the wild came from here rather than from the engine.
   *
   * Order is by strength of claim. Anything that reaches the end without a claim gets no
   * badge - silence is the default, not a fallback.
   */
  E.decideBadge = function decideBadge({ results = [], official = [], onchain = [], namedTickers = [] }) {
    const url = (a) => `https://robinhoodchain.blockscout.com/address/${a}`;
    const stamp = { level: "identity", scannedAt: Date.now() };
    const RANK = { FAIL: 4, CAUTION: 3, OFFICIAL: 2, PASS: 2, UNRESOLVED: 1 };

    // A post that only NAMES a ticker is a post about a stock, not about a contract.
    // "$TSLA earnings tomorrow" carries no address, nothing is being passed off as anything,
    // and there is no claim to check. Badging it anyway put a badge on every finance post on
    // the timeline, which is how a security tool teaches people to stop seeing it: when
    // everything is marked, the red one stops meaning anything.
    //
    // The single exception is a ticker that is genuinely not one token here. If several
    // contracts share it, that count is a real finding and it holds with no address at all.
    const collision = onchain.find((t) => t.count > 1) || null;

    const claim = E.pairTickerClaims(official, results, namedTickers);

    const wrongSymbol = !claim && onchain
      .map((t) => ({ t, given: results.find((r) => r.symbol && r.symbol.toUpperCase().replace(/^\$/, "") !== t.ticker) }))
      .find((x) => x.given);

    if (claim && claim.strength === "ambiguous") {
      // Several tickers, one address, matching none of them. Which ticker it was offered as
      // is a guess, so this is stated as something to check rather than charged as
      // impersonation - and it keeps the contract's own symbol, not the official one.
      const { o, given } = claim;
      return {
        ...given,
        verdict: given.verdict === "FAIL" ? "FAIL" : "CAUTION",
        lead: `This post names several tickers, $${o.ticker} among them, and one contract address. That address is ${given.symbol ? `${given.symbol}, ` : ""}not Robinhood's $${o.ticker} at ${o.address.slice(0, 10)}… - worth checking which token you are being pointed at.`,
      };
    }

    if (claim) {
      const { o, given } = claim;
      return {
        ...given,
        verdict: "FAIL",
        symbol: `$${o.ticker}`,
        lead: `This post names $${o.ticker}, which Robinhood publishes at ${o.address.slice(0, 10)}… - but the contract in the post is ${given.address.slice(0, 10)}…, a different token.`,
      };
    }

    if (wrongSymbol) {
      const { t, given } = wrongSymbol;
      return {
        ...given,
        verdict: given.verdict === "FAIL" ? "FAIL" : "CAUTION",
        symbol: `$${t.ticker}`,
        lead: `The post says $${t.ticker}, but the contract it gives is ${given.symbol}. They are not the same token - check which one you actually want.`,
      };
    }

    if (results.length) {
      const best = [...results].sort((a, b) => (RANK[b.verdict] || 0) - (RANK[a.verdict] || 0))[0];
      return results.length > 1
        ? { ...best, lead: `${results.length} tokens named in this post; showing the one that matters most.` }
        : best;
    }

    if (collision) {
      const t = collision;
      return {
        ...stamp,
        address: t.candidates[0].address,
        symbol: `$${t.ticker}`,
        verdict: "CAUTION",
        explorerUrl: url(t.candidates[0].address),
        lead: `$${t.ticker} is not one token here - at least ${t.count} different contracts use that ticker on this chain, and this post does not say which. That is how people buy the wrong one.`,
        checks: [
          {
            id: "ticker", label: "ticker", status: "warn",
            detail: `${t.count}${t.capped ? "+" : ""} contracts on Robinhood Chain use the symbol ${t.ticker}. No registry decides which is "the" one - only an address does.`,
          },
          ...t.candidates.map((c) => ({
            id: `cand:${c.address}`, label: c.name || "unnamed", status: "unresolved",
            detail: `${c.address}${c.verified ? " · source verified" : " · source not verified"}`,
          })),
        ],
      };
    }

    return null;
  };

  E.log = (...args) => console.debug("[edgerun]", ...args);
})();
