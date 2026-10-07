// Finding tokens in arbitrary page text, and the plumbing every surface shares.
//
// Two things are being looked for, and they are not equally trustworthy:
//
//   a contract address - unambiguous. A base58 Solana mint, or 0x + 40 hex.
//   a $TICKER          - ambiguous by construction, on every chain. A ten-ticker sweep of
//                        one chain found 213 contracts using a registered ticker, and on
//                        Solana anybody can mint a second $ANYTHING for the price of lunch.
//                        So a ticker alone never draws a badge. It is only ever compared
//                        against a contract the same post hands over, or resolved against an
//                        issuer's published registry where one exists. Guessing which of 213
//                        contracts someone meant would be worse than saying nothing.

(() => {
  const E = (globalThis.EDGERUN = globalThis.EDGERUN || {});
  if (E.findTokens) return;

  const ADDRESS_RE = /0x[0-9a-fA-F]{40}/g;
  // v4 pools are identified by a 32-byte id, which is not an address and must not be
  // mistaken for one when it shows up in a URL or a post.
  const POOL_ID_RE = /0x[0-9a-fA-F]{64}/g;
  const TICKER_RE = /\$([A-Za-z]{2,8})\b/g;
  // Solana mints are base58, which has no 0, O, I or l. This only finds CANDIDATES - whether
  // 32 to 44 base58 characters are actually a 32-byte public key needs a decode, and that
  // lives in lib/base58.js where the worker can import it. A content script is a classic
  // script with no imports, and duplicating a decoder into it is how the two copies start
  // disagreeing.
  const MINT_RE = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;

  // A link to a Solana pair page. The id is a pair - or the mint - and Dexscreener writes its
  // own links lowercased, so what is in the URL is not an address anybody can read from a
  // chain: the worker asks Dexscreener which token it is and uses the answer.
  const DEX_LINK_RE = /dexscreener\.com\/solana\/([0-9A-Za-z]{32,44})(?![0-9A-Za-z])/g;

  E.ADDRESS_RE = ADDRESS_RE;
  E.POOL_ID_RE = POOL_ID_RE;
  E.isAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(String(s || "").trim());

  /** Everything worth asking about in a blob of text. */
  E.findTokens = function findTokens(text) {
    if (!text) return { addresses: [], tickers: [], mints: [], pairs: [] };
    const pairs = [...new Set([...text.matchAll(DEX_LINK_RE)].map((m) => m[1]))].slice(0, 3);
    // taken out before anything else looks: a pair id is 32-44 characters of the right
    // alphabet and would otherwise be offered as a mint, which it is not
    const withoutPools = text.replace(DEX_LINK_RE, " ").replace(POOL_ID_RE, " ");
    const addresses = [...new Set((withoutPools.match(ADDRESS_RE) || []).map((a) => a.toLowerCase()))];
    const tickers = [...new Set([...text.matchAll(TICKER_RE)].map((m) => m[1].toUpperCase()))];
    // 0x addresses are stripped first so a hex string is never offered as a base58 candidate,
    // and the candidates are capped: a post is allowed to name a few tokens, not forty.
    const mints = [...new Set((withoutPools.replace(ADDRESS_RE, " ").match(MINT_RE) || []))].slice(0, 6);
    return { addresses, tickers, mints, pairs };
  };

  /**
   * The text of a post, plus the full text of every link in it.
   *
   * A long URL in a post is displayed cut short, and the contract is usually in the part that
   * was cut: `pump.fun/coin/8xu4aFUU…`. Where the page keeps the rest of the URL in the link's
   * own markup - hidden from the eye, present in the document - `textContent` returns it and
   * `innerText` may not. So both are read. If the page does not keep it, this adds nothing
   * and costs nothing; it cannot produce a contract that is not written in the post.
   *
   * (Whether X keeps it could not be checked while this was written: a logged-out visitor is
   * served a different, static page with none of the app's markup.)
   */
  E.textWithLinks = function textWithLinks(el) {
    if (!el) return "";
    const links = [...(el.querySelectorAll?.("a[href]") || [])].map((a) => a.textContent || "").filter((t) => t.length >= 24);
    return links.length ? `${el.innerText || ""}\n${links.join("\n")}` : el.innerText || "";
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
        // either the call throws "Extension context invalidated", or `chrome.runtime` is
        // simply gone - both mean this page has outlived the extension that injected it
        if (/context invalidated/i.test(String(err?.message)) || !globalThis.chrome?.runtime?.id) E.contextLost?.();
        if (!settled) reject(err);
      }
    });
  };

  /**
   * The extension was updated or reloaded underneath this page.
   *
   * From that moment this script can no longer reach its worker, and it fails in the worst
   * way available: silently. The page looks normal and no post ever gets a badge again until
   * the tab is reloaded - which nobody knows to do, because nothing says so. So it says so,
   * once, in a corner, and reloads on a click.
   */
  let lostShown = false;
  E.contextLost = function contextLost() {
    if (lostShown || !document.body) return;
    lostShown = true;
    const tip = document.createElement("div");
    tip.setAttribute("data-edgerun", "reload");
    tip.textContent = "EDGERUN was updated - click to reload this page and keep checking";
    tip.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:2147483647;max-width:300px;padding:10px 14px;" +
      "font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#12171a;background:#fff;" +
      "border:1px solid #e0e5e7;border-left:5px solid #a15c07;border-radius:12px;box-shadow:0 6px 24px rgba(10,16,20,.22);cursor:pointer;";
    tip.addEventListener("click", () => location.reload());
    document.body.appendChild(tip);
  };

  E.debounce = function debounce(fn, ms) {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  /**
   * At most once per `ms`, and - the part that matters - AT LEAST once per `ms` while calls
   * keep arriving.
   *
   * `E.watch` used a debounce for this and claimed in its own comment to be doing what this
   * function actually does. It is not the same thing, and the difference is not academic: a
   * debounce clears its timer on every call, so a page that mutates without pause never stops
   * resetting it and the callback NEVER RUNS.
   *
   * X mutates without pause - hydration, media, polling, hover. Reported from the field
   * 2026-09-28 as the profile card appearing at random: on a hard reload the mutations never
   * let up and the sweep was starved out entirely, while arriving through search left a quiet
   * moment in which the debounce finally fired. Same code, opposite outcome, which is what
   * made it look random rather than broken.
   *
   * Leading edge too, so the first mutation after a quiet period is acted on immediately
   * rather than a full interval later.
   */
  E.throttle = function throttle(fn, ms) {
    let last = 0;
    let timer = 0;
    return (...args) => {
      const now = Date.now();
      const wait = Math.max(0, ms - (now - last));
      clearTimeout(timer);
      if (wait === 0) {
        last = now;
        return fn(...args);
      }
      timer = setTimeout(() => {
        last = Date.now();
        fn(...args);
      }, wait);
    };
  };

  /**
   * Batched DOM watching. The callback fires at most once per `ms` no matter how much the
   * page mutates - both X and Dexscreener rewrite their DOM constantly, and re-walking on
   * every mutation is how an extension makes a host page feel broken.
   */
  E.watch = function watch(target, fn, ms = 250) {
    // Throttled, not debounced. See E.throttle: a debounce here is starved to death by a page
    // that never stops mutating, which is every page this runs on.
    const run = E.throttle(fn, ms);
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

  // X handles: 1-15 of [A-Za-z0-9_], and nothing else has ever been issued.
  const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
  // /i18n, /home, /settings and friends sit at the same depth as a profile and are not people
  const NOT_PEOPLE = new Set([
    "home", "explore", "notifications", "messages", "i", "settings", "search",
    "compose", "login", "signup", "tos", "privacy", "about", "download",
  ]);

  /**
   * Who posted this, from the pieces of a User-Name block.
   *
   * Pure, and separate from the DOM walk, because getting it wrong is expensive in both
   * directions: attribute a contract to the wrong account and the caller record becomes
   * libel, attribute nothing and the graph never fills.
   *
   * The href is trusted first - a profile link is `/handle` exactly, and it cannot be spoofed
   * by what someone types. The text is the fallback, and it is second for a reason: display
   * names routinely contain an "@", so the first @-looking thing in the block is not reliably
   * the handle. In the text path the LAST match wins, because the display name comes first.
   *
   * @returns {{handle: string, display: string|null}|null}
   */
  E.authorFrom = function authorFrom({ hrefs = [], text = "" } = {}) {
    let handle = null;
    for (const href of hrefs) {
      const m = /^(?:https?:\/\/(?:www\.)?(?:twitter|x)\.com)?\/([A-Za-z0-9_]{1,15})\/?$/.exec(String(href || ""));
      if (!m) continue;
      const h = m[1];
      if (NOT_PEOPLE.has(h.toLowerCase())) continue;
      handle = h;
      break;
    }
    if (!handle) {
      const found = [...String(text || "").matchAll(/@([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/g)].map((m) => m[1]);
      handle = found.length ? found[found.length - 1] : null;
    }
    if (!handle || !HANDLE_RE.test(handle) || NOT_PEOPLE.has(handle.toLowerCase())) return null;

    // the display name is the first line, and only when it is not just the handle again
    const first = String(text || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || null;
    const display = first && first !== `@${handle}` && !first.startsWith("@") ? first : null;
    return { handle: handle.toLowerCase(), display };
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
  /**
   * A ticker several contracts answer to. A finding that needs no address at all.
   */
  E.collisionResult = function collisionResult(t) {
    // which chain the count is about travels with the lookup - a count with no chain on it
    // is an answer to an unstated question
    const where = t.chainName || "this chain";
    const url = (a) => (t.explorer ? `${t.explorer}/address/${a}` : null);
    return {
      level: "identity",
      scannedAt: Date.now(),
      address: t.candidates[0].address,
      chainName: t.chainName || null,
      symbol: `$${t.ticker}`,
      verdict: "CAUTION",
      explorerUrl: url(t.candidates[0].address),
      lead: `$${t.ticker} is not one token on ${where} - at least ${t.count} different contracts use that ticker there. Check that the address in this post is the one you mean.`,
      checks: [
        {
          id: "ticker", label: "ticker", status: "warn",
          detail: `${t.count}${t.capped ? "+" : ""} contracts on ${where} use the symbol ${t.ticker}. No registry decides which is "the" one - only an address does.`,
        },
        ...t.candidates.map((c) => ({
          id: `cand:${c.address}`, label: c.name || "unnamed", status: "unresolved",
          detail: `${c.address}${c.verified ? " · source verified" : " · source not verified"}`,
        })),
      ],
    };
  };

  // Tickers that name what a trade is paid in, not what is being bought. "Ape with $SOL"
  // beside a contract is not a claim that the contract is SOL.
  const CURRENCIES = new Set(["SOL", "WSOL", "USDC", "USDT", "USD", "ETH", "WETH", "BTC", "WBTC", "BNB"]);
  E.isCurrency = (t) => CURRENCIES.has(String(t || "").toUpperCase().replace(/^\$/, ""));

  /**
   * A ticker that several Solana mints answer to, in a post that gives no contract.
   *
   * "The ticker in that post is not one token" - said under the post, with the mints. When a
   * list vouches for one of them the line is quiet and names it: most readers mean that one,
   * and it is worth one glance to know there are others. When NONE is vouched for there is no
   * right answer to point at, only the fact that the name is shared - which is exactly the
   * position somebody is in when they go and buy "the" token from a ticker.
   *
   * It carries no accusation and names no account. It is about the ticker.
   */
  E.symbolResult = function symbolResult(t) {
    const top = t.mints[0];
    const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
    const held = (m) => (m.holders ? `${Number(m.holders).toLocaleString("en-US")} wallets` : "an unknown number of wallets");
    const others = t.count - 1;
    return {
      level: "identity",
      scannedAt: Date.now(),
      ticker: true,
      count: t.count,
      address: top.mint,
      chainName: "Solana",
      symbol: `$${t.ticker}`,
      verdict: t.verified ? "UNRESOLVED" : "CAUTION",
      explorerUrl: `https://solscan.io/token/${top.mint}`,
      dexUrl: `https://dexscreener.com/solana/${top.mint}`,
      lead: t.verified
        ? `The listed $${t.ticker} is ${short(top.mint)}, held by ${held(top)}. At least ${others} other mint${others === 1 ? " uses" : "s use"} the same symbol, and this post gives no contract.`
        : `At least ${t.count} mints use $${t.ticker} and no list vouches for any of them. The most-held is ${short(top.mint)}, with ${held(top)}. This post does not say which one it means.`,
      checks: [
        {
          id: "ticker", label: "ticker", status: t.verified ? "unresolved" : "warn",
          detail: `at least ${t.count} mints on Solana use the symbol ${t.ticker}. Only an address says which one a post means.`,
        },
        ...t.mints.map((m) => ({
          id: `mint:${m.mint}`, label: m.name || "unnamed", status: m.verified ? "ok" : "unresolved",
          detail: `${m.mint} · ${held(m)}${m.verified ? " · on a verified list" : ""}`,
        })),
      ],
    };
  };

  /** Resolve with `fallback` if `promise` has not settled in `ms`. Never rejects. */
  E.settle = function settle(promise, fallback, ms = 9000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(fallback), ms);
      Promise.resolve(promise).then(
        (value) => { clearTimeout(timer); resolve(value); },
        () => { clearTimeout(timer); resolve(fallback); },
      );
    });
  };
  const bare = (s) => String(s || "").toUpperCase().replace(/^\$/, "").trim();

  /**
   * The post names one ticker and hands over one Solana mint that calls itself something else.
   *
   * The Solana form of the oldest check here, and deliberately the gentlest version of it.
   * A mint's symbol is whatever its creator typed, and "$WIF is dead, this is next" beside a
   * new mint names $WIF without claiming to be it - so this never changes the verdict and
   * never colours the badge. It supplies the sentence, and the sentence is only a statement
   * of two facts that are both on the page.
   *
   * Silent unless the pairing is unambiguous: exactly one ticker that is not a currency,
   * exactly one mint, and no EVM contract in the post that the ticker could belong to instead.
   */
  E.mintClaim = function mintClaim({ solana = [], results = [], namedTickers = [] } = {}) {
    const named = [...new Set((namedTickers || []).map(bare))].filter((t) => t && !CURRENCIES.has(t));
    if (named.length !== 1 || solana.length !== 1) return null;
    const mint = solana[0];
    const symbol = bare(mint?.symbol);
    if (!symbol || symbol === named[0]) return null;
    if ((results || []).some((r) => bare(r?.symbol) === named[0])) return null; // the ticker is the EVM contract's
    return {
      ...mint,
      lead: `The post says $${named[0]}, but the mint it gives calls itself ${mint.symbol}. They are not the same token - check which one you actually want.`,
    };
  };

  /**
   * The line of launch facts under a Solana badge: where, how old, how widely held.
   *
   * Context from an index, so it describes and never accuses - there is no threshold in here
   * and nothing in it can change a verdict. It is on the badge because for a token that is
   * forty minutes old these are the first three things anybody asks.
   */
  E.launchLine = function launchLine(ctx, now = Date.now()) {
    if (!ctx) return "";
    const parts = [];
    if (ctx.launchpad) parts.push(ctx.launchpad);
    if (ctx.createdAt && now > ctx.createdAt) {
      const mins = Math.floor((now - ctx.createdAt) / 60000);
      const age = mins < 1 ? "under a minute" : mins < 60 ? `${mins} min` : mins < 2880 ? `${Math.floor(mins / 60)} h` : `${Math.floor(mins / 1440)} days`;
      parts.push(`${age} old`);
    }
    if (ctx.holders != null) parts.push(`${Number(ctx.holders).toLocaleString("en-US")} holder${Number(ctx.holders) === 1 ? "" : "s"}`);
    if (ctx.top10Pct != null) parts.push(`top 10 hold ${Math.round(ctx.top10Pct)}%`);
    return parts.join(" · ");
  };

  /**
   * Which of the mints in a post name the POSTER as their own X account.
   *
   * A token names an account by writing a link into its metadata, which proves nothing on
   * its own. It becomes a fact when the named account is the one holding the contract out:
   * the link then holds in both directions, and the reader is looking at a token's own
   * account promoting it rather than at a stranger who found it.
   */
  E.ownTokens = function ownTokens(author, solana = []) {
    const handle = String(author?.handle || "").toLowerCase();
    if (!handle) return [];
    return (solana || []).filter((r) => {
      const x = r?.context?.x;
      return x && (x.kind === "account" || x.kind === "post") && x.handle === handle;
    });
  };

  E.decideBadge = function decideBadge({ results = [], official = [], onchain = [], namedTickers = [] }) {
    const RANK = { FAIL: 4, CAUTION: 3, OFFICIAL: 2, PASS: 2, UNRESOLVED: 1 };

    // A post that only NAMES a ticker is a post about a stock, not about a contract.
    // "$TSLA earnings tomorrow" carries no address, nothing is being passed off as anything,
    // and there is no claim to check. Badging it anyway put a badge on every finance post on
    // the timeline, which is how a security tool teaches people to stop seeing it: when
    // everything is marked, the red one stops meaning anything.
    //
    // A ticker several contracts share is a real finding, but it is a finding about ONE
    // chain - and a post with no contract in it has not said which chain it is about. So the
    // count is only ever shown beside a contract (see decideBadges), never on its own.

    const claim = E.pairTickerClaims(official, results, namedTickers);

    // Same exemption the registry pairing has: a contract whose symbol is ANOTHER ticker the
    // post names is explained, and saying "the post says $PUMP but the contract is PONS"
    // under a post about both would be charging it with a mismatch it did not make.
    const namedSet = new Set((namedTickers || []).map((t) => String(t).toUpperCase().replace(/^\$/, "")));
    const symOf = (r) => String(r.symbol || "").toUpperCase().replace(/^\$/, "");
    const wrongSymbol = !claim && onchain
      .map((t) => ({ t, given: results.find((r) => r.symbol && symOf(r) !== t.ticker && !namedSet.has(symOf(r))) }))
      .find((x) => x.given);

    if (claim && claim.strength === "ambiguous") {
      // Several tickers, one address, matching none of them. Which ticker it was offered as
      // is a guess, so this is stated as something to check rather than charged as
      // impersonation - and it keeps the contract's own symbol, not the official one.
      const { o, given } = claim;
      return {
        ...given,
        verdict: given.verdict === "FAIL" ? "FAIL" : "CAUTION",
        lead: `This post names several tickers, $${o.ticker} among them, and one contract address. That address is ${given.symbol ? `${given.symbol}, ` : ""}not the $${o.ticker} its issuer publishes at ${o.address.slice(0, 10)}… - worth checking which token you are being pointed at.`,
      };
    }

    if (claim) {
      const { o, given } = claim;
      return {
        ...given,
        verdict: "FAIL",
        // an identity failure, which is what lets the badge say "not the real one"
        claimed: true,
        symbol: `$${o.ticker}`,
        lead: `This post names $${o.ticker}, which its issuer publishes at ${o.address.slice(0, 10)}… - but the contract in the post is ${given.address.slice(0, 10)}…, a different token.`,
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
      // The worst one leads. The others are not dropped any more - decideBadges shows them
      // all - so this no longer needs to apologise for picking one.
      return [...results].sort((a, b) => (RANK[b.verdict] || 0) - (RANK[a.verdict] || 0))[0];
    }

    return null;
  };

  /* ---- the account, which is the part no server can answer ----
   *
   * Every badge below this line is about a contract, and a contract can be checked by anyone
   * from anywhere. Who handed it to you cannot: it is a fact about your feed at the moment
   * you scrolled it, and the only witness is the browser that was there.
   *
   * The record was being kept from the start and shown only on a tab in the side panel, which
   * is the wrong place - the decision happens in the feed, under the post, and a record
   * nobody sees at the moment of the decision is a record that changed nothing.
   */

  // How much history an account needs before its record is worth a line under a post.
  // Below this, a clean account has no record yet - it has a couple of posts - and printing
  // "1 contract, none flagged" under every post is exactly the noise that teaches people to
  // stop reading badges. Silence is the default here too; the record earns its line by being
  // long enough to mean something, or by having something against it.
  const CALLER_MIN_TOKENS = 5;

  /**
   * What to say about the account that posted this, if anything.
   *
   * Returns null far more often than not. Three things can earn a line, in descending order
   * of urgency:
   *
   *   1. A cluster. Several accounts put the same contract in this feed inside one window -
   *      the one finding here that is time-sensitive, and the one a scanner cannot produce
   *      at all. It speaks whatever the account's own record looks like.
   *   2. A record with something against it.
   *   3. A long clean record, which is worth stating precisely because most are not.
   */
  E.decideAccount = function decideAccount({ caller = null, clusters = {}, addresses = [], own = [], handle = null } = {}) {
    const cluster = addresses
      .map((a) => clusters[String(a).toLowerCase()]?.cluster)
      .filter(Boolean)
      .sort((a, b) => b.count - a.count)[0] || null;

    const tokens = caller?.tokens || 0;
    const flagged = caller?.flagged || 0;
    const hasRecord = Boolean(caller?.handle) && tokens > 0;
    const worthSaying = flagged >= 1 || tokens >= CALLER_MIN_TOKENS;
    // the price half of the record, already reduced to a sentence by the worker - and only
    // ever present once enough calls have been priced for a sentence to be fair
    const after = hasRecord ? caller.outcomeSay || null : null;
    if (!cluster && !own.length && !after && !(hasRecord && worthSaying)) return null;

    // A cluster is never "ok" - the point of saying it is that arriving together is not the
    // same as several people noticing the same thing.
    const ratio = tokens ? flagged / tokens : 0;
    // "ok" is earned by a record long enough to mean something. A strip that is only here to
    // say "this is the token's own account" is a fact with no colour: green beside it would
    // read as approval of a token for naming its own promoter.
    const tone = flagged && ratio >= 1 / 3 ? "bad" : flagged || cluster ? "warn" : hasRecord && worthSaying ? "ok" : "flat";

    const lines = [];
    if (own.length) {
      const names = own.slice(0, 2).map((r) => r.symbol || "this token").join(" and ");
      lines.push(`${names} names this account as its own X account - you are reading the token's own account.`);
    }
    if (cluster) {
      lines.push(
        `${cluster.count} accounts put this contract in your feed inside ${E.spanText(cluster.spanMs)}.`,
      );
    }
    if (hasRecord && worthSaying) {
      const span = caller.days === 1 ? "today" : `over ${caller.days} days`;
      const count = `${tokens} contract${tokens === 1 ? "" : "s"} ${span}`;
      lines.push(flagged ? `${count}, ${flagged} flagged.` : `${count}, none flagged.`);
    }
    if (after) lines.push(after);

    return {
      handle: caller?.handle || handle || null,
      display: caller?.display || null,
      tokens,
      flagged,
      days: caller?.days || 0,
      tone,
      cluster: cluster || null,
      lead: lines.join(" "),
    };
  };

  /**
   * Whose profile is this, if it is a profile at all.
   *
   * A profile page is the one place where showing an account's whole record is obviously
   * right: the reader navigated here to size somebody up. In the feed the same panel would be
   * the bare-ticker mistake again - mark everything and the marks stop meaning anything.
   *
   * Only the bare `/handle` and its tabs count. `/handle/status/123` is a post (the feed code
   * owns that), and `/i/...`, `/home`, `/search` are not people at all - the same NOT_PEOPLE
   * set the author walk uses, so the two can never disagree about what a person is.
   */
  E.profileHandleFrom = function profileHandleFrom(pathname) {
    const parts = String(pathname || "").split("/").filter(Boolean);
    if (!parts.length || parts.length > 2) return null;
    // /handle, or a profile tab: /handle/with_replies, /handle/media, /handle/likes
    const TABS = new Set(["with_replies", "media", "likes", "highlights", "articles", "superfollows"]);
    if (parts.length === 2 && !TABS.has(parts[1].toLowerCase())) return null;
    const handle = parts[0];
    if (!HANDLE_RE.test(handle) || NOT_PEOPLE.has(handle.toLowerCase())) return null;
    return handle.toLowerCase();
  };

  /**
   * Where a profile card can be mounted without React taking it straight back.
   *
   * Reported from the field: the card appeared for a moment and vanished once the page
   * finished loading. The first version anchored off the `UserName` element and fell back to
   * that element's own parent - deep inside a component X re-renders as the profile hydrates,
   * so the card was being mounted into a subtree that was about to be replaced.
   *
   * The second version then walked UP from the timeline to whichever node was a direct child
   * of the column, on the theory that a foreign node between two of the column's own children
   * survives a re-render of either. That theory cost the position: a real profile column has
   * ONE wrapper holding the header, the tab bar and the feed, so the walk reached that wrapper
   * and `afterend` put the card below the entire page - reported from the field as "it goes to
   * the end of all posts". A correct position beats a theoretically stabler one, and removal
   * is already handled by re-mounting.
   *
   * So: no walking. Anchor on the tab bar, which is one element, unambiguous, and exactly
   * where a reader looks for a summary of the account they just opened.
   *
   * Pure apart from the DOM it is handed, so it can be tested without a browser.
   */
  E.profileAnchorIn = function profileAnchorIn(column) {
    if (!column) return null;

    // The Posts / Replies / Media tab bar. It is the actual boundary between the profile
    // header and the feed, it is a single well-marked element, and it is where a reader looks
    // for a summary of the account they just opened.
    const nav = column.querySelector('nav[role="navigation"]') || column.querySelector("nav");
    if (nav) return { el: nav, where: "afterend" };

    // Still hydrating: the tab bar has not rendered, but the feed has. Directly above it.
    const timeline = column.querySelector('section[role="region"]');
    if (timeline) return { el: timeline, where: "beforebegin" };

    // Nothing recognisable yet. Returning null is the ANSWER, not a failure - the next
    // mutation runs this again, and by then the tab bar exists.
    return null;
  };

  /** "11 minutes", "under a minute", "3 hours" - for spans, not for timestamps. */
  E.spanText = function spanText(ms) {
    const mins = Math.round(Number(ms || 0) / 60000);
    if (mins < 1) return "under a minute";
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
    const hours = Math.round(mins / 60);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  };

  // A post naming four tokens used to get one badge and a line saying so. That is the wrong
  // trade: the reason somebody pastes four contracts is that they are talking about four
  // things, and answering about one of them is answering a question nobody asked.
  const MAX_BADGES = 4;

  /**
   * Every token this post is worth saying something about, worst first.
   *
   * The decisive finding - an impersonation, a mismatched ticker - still leads and keeps the
   * sentence that explains it, because it is a statement about the post rather than about one
   * contract. Everything else follows in the order it was named.
   */
  E.decideBadges = function decideBadges({ results = [], official = [], onchain = [], namedTickers = [], solana = [], symbols = [] }) {
    const out = [];
    const seen = new Set();
    const push = (r) => {
      const key = String(r?.address || "");
      if (!r || !key || seen.has(key)) return;
      seen.add(key);
      out.push(r);
    };

    // An 0x address with no contract behind it on the chain that was read is not a token
    // THERE - it is a wallet, or a token on a chain this pass did not ask. Saying
    // "unresolved" under the post would be answering about the wrong chain, so it gets no
    // badge; the panel still holds the row, and "dig deeper" asks the other chains.
    const present = results.filter((r) => !r?.absent);

    // the decisive finding carries a rewritten verdict and lead, so it must be pushed before
    // the raw result for the same address, which the seen-set then skips
    push(E.decideBadge({ results: present, official, onchain, namedTickers }));
    push(E.mintClaim({ solana, results: present, namedTickers }));
    for (const r of present) push(r);
    for (const r of solana) push(r);
    // Every ticker the post names that several contracts answer to, in the order it was
    // named. decideBadge only ever returns the first collision, so a post about two contested
    // tickers used to get one answer about the wrong one: a post whose subject was $PONS
    // (15 contracts on one chain) was handed a badge about $PUMP because $PUMP appeared first.
    //
    // Only beside a contract on that same chain. The count is a fact about one chain, and a
    // post that names a ticker and no contract has not said which chain it means - under a
    // post about a Solana token it would be a warning about somewhere else entirely.
    if (present.some((r) => r?.symbol)) {
      for (const t of onchain) if (t.count > 1) push(E.collisionResult(t));
    }

    // A ticker several Solana mints share, when the post hands over no contract at all. With
    // a contract in the post there is nothing to add: the contract IS the answer to "which
    // one", and it is already checked above.
    if (!present.length && !solana.length) {
      for (const t of symbols.slice(0, 2)) if (t?.count > 1 && t.mints?.length) push(E.symbolResult(t));
    }

    return out.slice(0, MAX_BADGES);
  };

  E.log = (...args) => console.debug("[edgerun]", ...args);
})();
