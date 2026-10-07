// Solana token pages: the explorer and the launchpad.
//
// These are the pages a reader lands on one click after a post - "is this the one" asked in
// front of the token itself - and both put the mint in the path, so there is nothing to
// resolve and nothing to guess.
//
// The badge goes in a fixed corner and is never threaded into the page's own markup. Both
// sites ship hashed class names that change across deploys, and none of this has been
// anchored against their live DOM; a badge in an obviously separate corner cannot land in the
// wrong row, which a guessed container can. The mint in the URL is the only thing relied on.
//
// One table, so another site whose path carries the mint is one line here and one in the
// manifest's `matches`.

(() => {
  const E = globalThis.EDGERUN;
  if (!E || window.__edgerunSolPage) return;
  window.__edgerunSolPage = true;

  const MINT = "([1-9A-HJ-NP-Za-km-z]{32,44})";
  const SITES = [
    { host: /(^|\.)solscan\.io$/, path: new RegExp(`^/token/${MINT}(?:[/?#]|$)`) },
    { host: /(^|\.)pump\.fun$/, path: new RegExp(`^/(?:coin/)?${MINT}(?:[/?#]|$)`) },
  ];

  /** The mint this page is about, or null. Pure, so the table can be tested without a DOM. */
  E.mintFromPage = function mintFromPage(hostname, pathname) {
    for (const site of SITES) {
      if (!site.host.test(String(hostname || ""))) continue;
      return site.path.exec(String(pathname || ""))?.[1] || null;
    }
    return null;
  };

  let shown = null;
  let running = false;
  const notTokens = new Set(); // paths that looked like a mint and were not: never retried

  async function run() {
    const mint = E.mintFromPage(location.hostname, location.pathname);
    if (!mint) {
      document.querySelectorAll('[data-edgerun="slot"]').forEach((n) => n.remove());
      shown = null;
      return;
    }
    if (running || shown === mint || notTokens.has(mint)) return;
    running = true;
    shown = mint;
    document.querySelectorAll('[data-edgerun="slot"]').forEach((n) => n.remove());

    const badge = E.makeBadge({
      onFull: async (address) => {
        try { badge.update(await E.ask({ type: "mint", address, fresh: true })); }
        catch (err) { badge.fail(err.message); }
      },
      onWatch: (address) => E.ask({ type: "watch:toggle", address }).catch(() => {}),
    });
    const slot = document.createElement("div");
    slot.setAttribute("data-edgerun", "slot");
    slot.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:2147483646;";
    slot.appendChild(badge);
    document.body.appendChild(slot);

    try {
      const result = await E.ask({ type: "mint", address: mint });
      if (E.mintFromPage(location.hostname, location.pathname) !== mint) return; // routed away while waiting
      badge.update(result);
    } catch (err) {
      // A path that looks like a mint and is a wallet, or anything else: say nothing rather
      // than park a "check unavailable" chip on a page that was never about a token.
      slot.remove();
      notTokens.add(mint);
      E.log("solana page", err.message);
    } finally {
      running = false;
    }
  }

  // re-inject if the app's own re-render throws our node away
  E.watch(document.body, () => { if (!running && shown && !document.querySelector('[data-edgerun="slot"]')) { shown = null; run(); } }, 400);
  E.onRouteChange(() => { shown = null; run(); });
  run();
})();
