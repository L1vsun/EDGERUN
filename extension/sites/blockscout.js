// Blockscout.
//
// The address is in the path here, which makes this the simplest surface. Someone on an
// explorer page is already reading detail, so this renders the full check as a standing
// panel rather than hiding it behind a hover — the badge goes next to the heading, the
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
  // guess at a container — putting a security badge in the wrong row is worse than putting
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

  function panelFor(result) {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-edgerun", "panel");
    wrap.style.cssText = "margin:12px 0;padding:12px 14px;border:1px solid #2b3529;background:#0b0f0a;color:#cbd2ba;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;";
    const rows = (result.checks || []).map((c) => {
      const color = { ok: "#cfff04", warn: "#ffd682", fail: "#ff6b6b", unresolved: "#7e8a6d" }[c.status] || "#7e8a6d";
      return `<div style="display:grid;grid-template-columns:8px 1fr;gap:9px;padding:5px 0;">
        <i style="width:7px;height:7px;border-radius:50%;background:${color};margin-top:6px;"></i>
        <span><b style="display:block;color:#eef0e4;font-size:10px;letter-spacing:.08em;text-transform:uppercase;">${E.esc(c.label)}</b>
        <span style="color:#a3ab91;">${E.esc(c.detail)}</span></span></div>`;
    }).join("");
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px;">
        <b style="color:#eef0e4;letter-spacing:.06em;">EDGERUN</b>
        <span style="font-size:10px;letter-spacing:.14em;padding:2px 6px;border:1px solid currentColor;color:${result.verdict === "FAIL" ? "#ff6b6b" : result.verdict === "CAUTION" ? "#ffd682" : result.verdict === "UNRESOLVED" ? "#7e8a6d" : "#cfff04"};">${E.esc(result.verdict)}</span>
        <span style="margin-left:auto;font-size:10px;color:#6d7760;">${result.facts} fact(s) checked · ${result.unresolved} unresolved</span>
      </div>
      <div style="color:#eef0e4;margin-bottom:6px;">${E.esc(E.badgeLead(result))}</div>
      ${rows}`;
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
      E.log("no heading found — using the floating slot");
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
