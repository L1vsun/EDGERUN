// Dexscreener.
//
// The URL carries the *pair*, not the token — dexscreener.com/robinhood/<pairId> — and on
// this chain some of those ids are Uniswap v4 pools, which are 32-byte ids rather than
// addresses. So the pair is resolved to its base token through the worker first. (The chain
// slug is `robinhood`; `robinhoodchain` and `rhchain` both return nothing.)
//
// The anchor is found by looking for the token's own symbol in the page rather than by a
// class-name chain. Dexscreener's markup changes across deploys and its classes are hashed,
// but the page always writes the ticker near the top — and we know what that ticker is,
// because resolving the pair told us before we ever touch the DOM. If the symbol is not
// found, the badge goes in a floating panel of its own: an obviously separate corner beats
// guessing at a container and landing in the wrong row.
//
// This is a page about one token, so it gets the full check rather than the identity tier.

(() => {
  const E = globalThis.EDGERUN;
  if (!E || window.__edgerunDex) return;
  window.__edgerunDex = true;

  const PATH = /^\/robinhood\/([0-9a-zA-Z]+)/;
  let shown = null;
  let running = false; // the header mounts late, so run() awaits it while the watcher fires

  /** The shallowest leaf in the top of the page whose text is this ticker. */
  function symbolAnchor(symbol) {
    if (!symbol) return null;
    const want = symbol.toUpperCase();
    let best = null;
    for (const el of document.querySelectorAll("h1, h2, span, div, a, p")) {
      if (el.children.length) continue; // leaves only: we want the text node's own box
      const text = (el.textContent || "").trim().toUpperCase();
      if (text !== want && text !== `$${want}` && !text.startsWith(`${want}/`)) continue;
      const box = el.getBoundingClientRect();
      if (box.top > 320 || box.width === 0) continue; // must be in the header region
      if (!best || box.top < best.box.top) best = { el, box };
    }
    return best?.el || null;
  }

  function floatingSlot(node) {
    const float = document.createElement("div");
    float.setAttribute("data-edgerun", "slot");
    float.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:2147483646;";
    float.appendChild(node);
    document.body.appendChild(float);
    return float;
  }

  function inlineSlot(anchor, node) {
    const slot = document.createElement("span");
    slot.setAttribute("data-edgerun", "slot");
    slot.style.cssText = "display:inline-flex;align-items:center;margin-left:8px;vertical-align:middle;";
    slot.appendChild(node);
    anchor.insertAdjacentElement("afterend", slot);
    return slot;
  }

  async function run() {
    const m = location.pathname.match(PATH);
    if (!m) return;
    const pairId = m[1];
    if (running || shown === pairId) return;
    running = true;
    shown = pairId;
    document.querySelectorAll('[data-edgerun="slot"]').forEach((n) => n.remove());

    const badge = E.makeBadge({
      onFull: async (address) => {
        try { badge.update(await E.ask({ type: "verdict", address, level: "full", fresh: true })); }
        catch (err) { badge.fail(err.message); }
      },
      onWatch: (address) => E.ask({ type: "watch:toggle", address }).catch(() => {}),
    });

    try {
      const pair = await E.ask({ type: "pair", pairId });
      if (!pair?.baseToken) throw new Error("could not resolve this pair to a token");
      if (!location.pathname.startsWith(`/robinhood/${pairId}`)) return; // routed away while waiting

      // now that the ticker is known, wait for the page to put it on screen
      const anchor = await E.waitFor(() => symbolAnchor(pair.baseSymbol), 6000);
      if (anchor) inlineSlot(anchor, badge);
      else {
        E.log(`no "${pair.baseSymbol}" in the header — using the floating slot`);
        floatingSlot(badge);
      }

      badge.update(await E.ask({ type: "verdict", address: pair.baseToken, level: "full" }));
    } catch (err) {
      if (!document.querySelector('[data-edgerun="slot"]')) floatingSlot(badge);
      badge.fail(err.message);
      E.log("dexscreener", err.message);
    } finally {
      running = false;
    }
  }

  // The header mounts after the shell, and the router swaps tokens without a page load.
  E.watch(document.body, () => { if (!running && !document.querySelector('[data-edgerun="slot"]')) { shown = null; run(); } }, 400);
  E.onRouteChange(() => { shown = null; run(); });
  run();
})();
