// Blockscout.
//
// The address is in the path here, which makes this the simplest surface. Someone on an
// explorer page is already reading detail, so this renders the full check as a standing
// panel rather than hiding it behind a hover - the badge goes next to the heading, the
// panel sits under it.

(() => {
  const E = globalThis.EDGERUN;
  if (!E || window.__edgerunBs) return;
  window.__edgerunBs = true;

  const PATH = /^\/(?:address|token)\/(0x[0-9a-fA-F]{40})/;
  let shown = null;
  let running = false; // run() awaits the heading, and the DOM watcher fires while it waits

  // The heading mounts after the shell, so this waits for it rather than grabbing whatever
  // exists at document_idle. No heading after the timeout means a floating panel, not a
  // guess at a container - putting a security badge in the wrong row is worse than putting
  // it in an obvious corner of its own.
  const findHeading = () => document.querySelector("main h1") || document.querySelector("h1");

  function floatingSlot(node) {
    const float = document.createElement("div");
    float.setAttribute("data-edgerun", "slot");
    float.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:2147483646;max-width:360px;";
    float.appendChild(node);
    document.body.appendChild(float);
    return float;
  }

  // A standing panel, in the same light card language as the badge, rendered in its own
  // shadow root so the explorer's stylesheet cannot reach it.
  function panelFor(result) {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-edgerun", "panel");
    wrap.style.cssText = "display:block;margin:16px 0;";
    const root = wrap.attachShadow({ mode: "open" });
    const accent = { FAIL: "#c62828", CAUTION: "#a15c07", UNRESOLVED: "#5d6752" }[result.verdict] || "#4a7c0f";
    const rows = (result.checks || []).map((c) => {
      const color = { ok: "#4a7c0f", warn: "#a15c07", fail: "#c62828", unresolved: "#b9c0aa" }[c.status] || "#b9c0aa";
      return `<div class="row"><i style="background:${color}"></i>
        <span><b>${E.esc(c.label)}</b><span>${E.esc(c.detail)}</span></span></div>`;
    }).join("");
    root.innerHTML = `
      <style>
        :host { all: initial; display: block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; }
        * { box-sizing: border-box; }
        /* re-declared inside the shadow root: the page's own rules beat :host on the host */
        .card { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
          background: #fff; color: #151a11; border: 1px solid #e3e7d9; border-left: 6px solid ${accent};
          border-radius: 14px; box-shadow: 0 6px 24px rgba(12,18,6,.16); overflow: hidden; }
        .head { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid #e3e7d9; flex-wrap: wrap; }
        .brand { font-size: 13px; font-weight: 800; letter-spacing: .16em; color: #5d6752; }
        .v { font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
          padding: 6px 12px; border-radius: 999px; color: #fff; background: ${accent}; }
        .count { margin-left: auto; font-size: 13px; color: #5d6752; }
        .lead { margin: 0; padding: 16px 20px; font-size: 16px; line-height: 1.5; font-weight: 600; }
        .rows { padding: 6px 0 14px; }
        .row { display: grid; grid-template-columns: 10px 1fr; gap: 12px; padding: 9px 20px; }
        .row i { width: 9px; height: 9px; border-radius: 50%; margin-top: 7px; }
        .row b { display: block; font-size: 12px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: #5d6752; margin-bottom: 2px; }
        .row span { display: block; font-size: 14.5px; line-height: 1.5; }
      </style>
      <div class="card">
        <div class="head"><span class="brand">EDGERUN</span><span class="v">${E.esc(result.verdict)}</span>
          <span class="count">${result.facts} fact(s) checked · ${result.unresolved} unresolved</span></div>
        <p class="lead">${E.esc(E.badgeLead(result))}</p>
        <div class="rows">${rows}</div>
      </div>`;
    return wrap;
  }

  async function run() {
    const m = location.pathname.match(PATH);
    if (!m) return;
    const address = m[1].toLowerCase();
    if (running || shown === address) return;
    running = true;
    shown = address;
    document.querySelectorAll('[data-edgerun="slot"],[data-edgerun="panel"]').forEach((n) => n.remove());

    const badge = E.makeBadge({
      onFull: async (a) => {
        try { badge.update(await E.ask({ type: "verdict", address: a, level: "full", fresh: true })); }
        catch (err) { badge.fail(err.message); }
      },
      onWatch: (a) => E.ask({ type: "watch:toggle", address: a }).catch(() => {}),
    });
    const heading = await E.waitFor(findHeading);
    if (location.pathname.match(PATH)?.[1].toLowerCase() !== address) { running = false; return; } // navigated away while waiting

    if (heading) {
      const slot = document.createElement("span");
      slot.setAttribute("data-edgerun", "slot");
      slot.style.cssText = "display:inline-flex;align-items:center;margin-left:10px;vertical-align:middle;";
      slot.appendChild(badge);
      heading.appendChild(slot);
    } else {
      E.log("no heading found - using the floating slot");
      floatingSlot(badge);
    }

    try {
      const result = await E.ask({ type: "verdict", address, level: "full" });
      badge.update(result);
      const panel = panelFor(result);
      const host = heading?.closest("main") || document.querySelector("main");
      if (host) host.prepend(panel);
      else floatingSlot(panel);
    } catch (err) {
      badge.fail(err.message);
      E.log("blockscout", err.message);
    } finally {
      running = false;
    }
  }

  // re-inject if the app's own re-render throws our node away
  E.watch(document.body, () => { if (!running && !document.querySelector('[data-edgerun="slot"]')) { shown = null; run(); } }, 400);
  E.onRouteChange(() => { shown = null; run(); });
  run();
})();
