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

  E.log = (...args) => console.debug("[edgerun]", ...args);
})();
