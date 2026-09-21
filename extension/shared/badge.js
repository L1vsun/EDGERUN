// The badge. One visual unit, used by every surface.
//
// Everything lives in a shadow root: Dexscreener, Blockscout and X all ship aggressive
// global CSS, and a badge that breaks visually on a host-page update reads as unmaintained —
// which for a security tool is the same as untrustworthy. `all: initial` on the host blocks
// inherited styles going the other way.
//
// Deliberately not a custom element: a content script's customElements registry is not the
// page's, and nothing here needs upgrades of page-created nodes. A plain element with a
// shadow root and an `update()` method behaves the same and has no registry to collide in.

(() => {
  const E = (globalThis.EDGERUN = globalThis.EDGERUN || {});
  if (E.makeBadge) return;

  const TONE = {
    OFFICIAL: { dot: "#cfff04", label: "official", cls: "ok" },
    PASS: { dot: "#cfff04", label: "checks pass", cls: "ok" },
    CAUTION: { dot: "#ffd682", label: "caution", cls: "warn" },
    FAIL: { dot: "#ff6b6b", label: "not the real one", cls: "bad" },
    UNRESOLVED: { dot: "#7e8a6d", label: "unverified", cls: "flat" },
  };

  const STATUS_DOT = { ok: "#cfff04", warn: "#ffd682", fail: "#ff6b6b", unresolved: "#7e8a6d" };

  const ago = (ts) => {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    return `${Math.round(m / 60)}h ago`;
  };

  const CSS = `
    :host { all: initial; display: inline-block; vertical-align: middle; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    * { box-sizing: border-box; }
    .chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 7px; cursor: pointer;
      background: #10140c; border: 1px solid #2b3529; color: #d8dcc8; font-size: 11px; line-height: 17px;
      letter-spacing: 0.02em; white-space: nowrap; user-select: none; }
    .chip:hover { border-color: #55603f; }
    .chip .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
    .chip.bad { border-color: #6d2626; background: #1b0f0f; color: #ffb3b3; }
    .chip.warn { border-color: #5a4a1e; background: #191408; color: #ffd682; }
    .chip.ok { border-color: #3b4a10; background: #141a06; color: #cfff04; }
    .chip .mark { font-size: 9px; opacity: 0.65; letter-spacing: 0.1em; text-transform: uppercase; }
    .chip.busy .dot { animation: pulse 1s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.25 } }

    .panel { position: absolute; z-index: 2147483647; width: 330px; max-width: 86vw; margin-top: 6px;
      background: #0b0f0a; border: 1px solid #2b3529; box-shadow: 0 14px 40px rgba(0,0,0,0.6); color: #cbd2ba;
      font-size: 11.5px; line-height: 1.45; }
    .panel[hidden] { display: none; }
    .head { display: flex; align-items: center; gap: 8px; padding: 9px 11px; border-bottom: 1px solid #1d2417; }
    .head b { font-size: 12.5px; color: #eef0e4; font-weight: 700; }
    .head .v { margin-left: auto; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; padding: 2px 6px; border: 1px solid currentColor; }
    .lead { margin: 0; padding: 9px 11px; border-bottom: 1px solid #1d2417; color: #eef0e4; font-size: 12px; }
    .lead.bad { color: #ffb3b3; }
    .rows { margin: 0; padding: 4px 0; max-height: 260px; overflow-y: auto; }
    .row { display: grid; grid-template-columns: 8px 1fr; gap: 8px; padding: 6px 11px; }
    .row i { width: 7px; height: 7px; border-radius: 50%; margin-top: 5px; }
    .row b { display: block; color: #eef0e4; font-weight: 700; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; }
    .row span { display: block; color: #a3ab91; }
    .foot { display: flex; align-items: center; gap: 8px; padding: 8px 11px; border-top: 1px solid #1d2417; }
    .foot a { color: #cfff04; text-decoration: none; border-bottom: 1px solid rgba(207,255,4,0.35); }
    .foot .when { margin-left: auto; color: #6d7760; font-size: 10px; }
    button { font: inherit; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer;
      padding: 5px 8px; color: #cbd2ba; background: transparent; border: 1px solid #2b3529; }
    button:hover { color: #eef0e4; border-color: #55603f; }
    button.go { color: #0a0e04; background: #cfff04; border-color: #cfff04; font-weight: 700; }
    .addr { font-size: 10px; color: #7e8a6d; word-break: break-all; padding: 0 11px 9px; }
  `;

  /**
   * @param {object} opts
   * @param {(address: string) => void} [opts.onFull]  run the full check
   * @param {(address: string) => void} [opts.onWatch] toggle the local watchlist
   */
  E.makeBadge = function makeBadge(opts = {}) {
    const host = document.createElement("span");
    host.className = "edgerun-badge";
    host.setAttribute("data-edgerun", "badge");
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    const chip = document.createElement("span");
    chip.className = "chip busy";
    chip.innerHTML = `<span class="dot" style="background:#7e8a6d"></span><span class="txt">checking…</span>`;
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.hidden = true;
    root.append(style, chip, panel);

    let current = null;
    const close = () => { panel.hidden = true; };
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      if (!panel.hidden) place();
    });
    // a click anywhere else closes it, but never bubbles into the host page's own handlers
    document.addEventListener("click", (e) => { if (!host.contains(e.target)) close(); }, true);

    function place() {
      // the panel is positioned relative to the page, so it escapes any clipped container
      const r = chip.getBoundingClientRect();
      panel.style.position = "fixed";
      panel.style.top = `${Math.min(window.innerHeight - 40, r.bottom + 4)}px`;
      panel.style.left = `${Math.max(8, Math.min(window.innerWidth - 340, r.left))}px`;
    }

    host.update = function update(result) {
      current = result;
      if (!result) return;
      const tone = TONE[result.verdict] || TONE.UNRESOLVED;
      chip.className = `chip ${tone.cls}`;
      const ticker = result.symbol || (result.address ? `${result.address.slice(0, 6)}…` : "");
      chip.innerHTML = `<span class="dot" style="background:${tone.dot}"></span><span class="txt">${esc(ticker)}</span><span class="mark">${esc(tone.label)}</span>`;
      chip.title = lead(result);
      renderPanel(result);
    };

    host.fail = function fail(message) {
      chip.className = "chip flat";
      chip.innerHTML = `<span class="dot" style="background:#7e8a6d"></span><span class="txt">unavailable</span>`;
      chip.title = message || "check unavailable";
    };

    function renderPanel(r) {
      const tone = TONE[r.verdict] || TONE.UNRESOLVED;
      const rows = (r.checks || []).map((c) => `
        <div class="row"><i style="background:${STATUS_DOT[c.status] || "#7e8a6d"}"></i>
          <span><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></span></div>`).join("");
      const needsFull = r.level !== "full" && r.verdict !== "FAIL";
      panel.innerHTML = `
        <div class="head"><b>${esc(r.symbol || "unknown token")}</b>
          <span class="v" style="color:${tone.dot}">${esc(r.verdict)}</span></div>
        <p class="lead ${r.verdict === "FAIL" ? "bad" : ""}">${esc(lead(r))}</p>
        <div class="rows">${rows || '<div class="row"><i style="background:#7e8a6d"></i><span><span>nothing established yet</span></span></div>'}</div>
        <div class="addr">${esc(r.address)}</div>
        <div class="foot">
          ${needsFull ? '<button class="go" data-act="full">run full check</button>' : ""}
          <button data-act="watch">watch</button>
          <a href="${esc(r.explorerUrl)}" target="_blank" rel="noreferrer">explorer</a>
          <span class="when">${r.cached ? "cached · " : ""}${ago(r.scannedAt)}</span>
        </div>`;
      panel.querySelector('[data-act="full"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        chip.classList.add("busy");
        opts.onFull?.(r.address);
      });
      panel.querySelector('[data-act="watch"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        opts.onWatch?.(r.address);
        e.target.textContent = "watching";
      });
    }

    return host;
  };

  function lead(r) {
    if (r.lead) return r.lead; // a surface that knows more than the verdict alone (the X cross-check)
    if (r.verdict === "FAIL" && r.impersonates) {
      return `$${r.impersonates.ticker} is an official Robinhood stock token at ${r.impersonates.officialAddress.slice(0, 10)}… — this is a different contract.`;
    }
    if (r.verdict === "FAIL") return (r.checks || []).find((c) => c.status === "fail")?.detail || "failed a check";
    if (r.verdict === "OFFICIAL") return "This address is in Robinhood's published registry of tokenised stocks.";
    if (r.verdict === "PASS") return "The full check ran and found nothing against it. Not advice, and not a price call.";
    if (r.verdict === "CAUTION") return (r.checks || []).find((c) => c.status === "fail")?.detail || "something in the contract lane needs a look";
    return "No claim on an official asset. The contract itself has not been checked yet.";
  }

  E.badgeLead = lead;

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  E.esc = esc;
})();
