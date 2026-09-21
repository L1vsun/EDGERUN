// The badge. One visual unit, used by every surface.
//
// Light on purpose. This sits on other people's pages - X in dark mode, Dexscreener's near
// black, Blockscout's grey - and a dark chip on a dark page is something you have to go
// looking for. A bright card reads instantly against all three, and the status colour does
// the talking before any text is read.
//
// Everything lives in a shadow root, because Dexscreener and X both ship aggressive global
// CSS and a badge that breaks visually reads as unmaintained - which for a security tool is
// the same as untrustworthy. `all: initial` on the host blocks inheritance the other way.
//
// The panel is NOT a child of the badge. X puts `transform` on timeline containers, and a
// `position: fixed` element inside a transformed ancestor positions against that ancestor
// rather than the viewport - which is why the panel used to open half off the right edge.
// It is appended to the document root instead and positioned from the chip's own rect.

(() => {
  const E = (globalThis.EDGERUN = globalThis.EDGERUN || {});
  if (E.makeBadge) return;

  const TONE = {
    OFFICIAL: { label: "verified official", glyph: "✓", cls: "ok" },
    PASS: { label: "checks pass", glyph: "✓", cls: "ok" },
    CAUTION: { label: "caution", glyph: "!", cls: "warn" },
    FAIL: { label: "not the real one", glyph: "✕", cls: "bad" },
    UNRESOLVED: { label: "unverified", glyph: "?", cls: "flat" },
  };

  const ago = (ts) => {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    return `${Math.round(m / 60)}h ago`;
  };

  // One palette, light, shared by the chip and the panel.
  const TOKENS = `
    --ink: #151a11;
    --muted: #5d6752;
    --line: #e3e7d9;
    --card: #ffffff;
    --soft: #f6f8f0;
    --bad: #c62828;
    --bad-soft: #fdecec;
    --warn: #a15c07;
    --warn-soft: #fdf3e0;
    --ok: #4a7c0f;
    --ok-soft: #f0f8e2;
    --signal: #cfff04;
    --radius: 12px;
    --shadow: 0 6px 24px rgba(12, 18, 6, 0.18), 0 1px 3px rgba(12, 18, 6, 0.12);
  `;

  const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif`;
  const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

  const CHIP_CSS = `
    :host { all: initial; ${TOKENS} display: inline-block; vertical-align: middle; font-family: ${FONT}; }
    * { box-sizing: border-box; }

    /* The host page's own rules outrank :host rules on the host element, so its font
       leaks in through inheritance. Declared again here, where nothing outside can reach. */
    .chip, .strip { font-family: ${FONT}; }

    /* compact pill - used where there is a row to sit in */
    .chip { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px 7px 10px;
      border-radius: 999px; cursor: pointer; border: 1px solid var(--line); background: var(--card);
      color: var(--ink); font-size: 13px; font-weight: 600; line-height: 18px; white-space: nowrap;
      box-shadow: var(--shadow); transition: transform .12s ease, box-shadow .12s ease; }
    .chip:hover { transform: translateY(-1px); box-shadow: 0 10px 28px rgba(12,18,6,.22); }
    .chip:active { transform: none; }
    .g { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;
      border-radius: 50%; font-size: 12px; font-weight: 800; color: #fff; background: var(--muted); flex: none; }
    .mark { font-size: 12px; font-weight: 600; color: var(--muted); }
    .sym { font-weight: 800; letter-spacing: -0.01em; }

    .chip.bad { background: var(--bad); border-color: var(--bad); color: #fff; }
    .chip.bad .g { background: #fff; color: var(--bad); }
    .chip.bad .mark { color: rgba(255,255,255,.88); }
    .chip.ok .g { background: var(--ok); }
    .chip.ok { border-color: #d5e7b4; background: var(--ok-soft); }
    .chip.warn .g { background: var(--warn); }
    .chip.warn { border-color: #f0dcb4; background: var(--warn-soft); }
    .chip.flat .g { background: var(--muted); }

    /* the loud form - a strip in the reading flow, so a fake cannot be scrolled past */
    .strip { display: flex; align-items: flex-start; gap: 11px; width: 100%; text-align: left;
      padding: 12px 14px; border-radius: var(--radius); cursor: pointer; border: 1px solid var(--line);
      background: var(--card); color: var(--ink); font-size: 14px; line-height: 1.45;
      box-shadow: var(--shadow); transition: box-shadow .12s ease; }
    .strip:hover { box-shadow: 0 12px 30px rgba(12,18,6,.24); }
    .strip .g { width: 24px; height: 24px; font-size: 14px; margin-top: 1px; }
    .strip .body { flex: 1; min-width: 0; }
    .strip .title { display: block; font-weight: 800; font-size: 14.5px; letter-spacing: -0.01em; margin-bottom: 2px; }
    .strip .say { display: block; color: var(--muted); font-size: 13px; }
    .strip .more { font-size: 12px; font-weight: 700; color: var(--muted); white-space: nowrap; align-self: center; }
    /* only a fake gets the full-volume treatment - if every post shouted, none of them would */
    .strip:not(.bad) { padding: 10px 13px; font-size: 13px; box-shadow: 0 2px 10px rgba(12,18,6,.10); }
    .strip:not(.bad) .title { font-size: 13.5px; }
    .strip:not(.bad) .say { font-size: 12.5px; }
    .strip:not(.bad) .g { width: 21px; height: 21px; font-size: 12px; }
    .strip.bad { border-color: #f2c9c9; background: var(--bad-soft); border-left: 5px solid var(--bad); }
    .strip.bad .title { color: var(--bad); }
    .strip.bad .g { background: var(--bad); }
    .strip.ok { border-left: 5px solid var(--ok); }
    .strip.ok .g { background: var(--ok); }
    .strip.warn { border-left: 5px solid var(--warn); }
    .strip.warn .g { background: var(--warn); }
    .strip.flat { border-left: 5px solid var(--muted); }
    .strip.flat .g { background: var(--muted); }

    /* a fake gets two pulses on arrival, then stops. Anything that pulses forever gets muted. */
    .attn { animation: attn 1.1s ease-out 2; }
    @keyframes attn {
      0% { box-shadow: 0 0 0 0 rgba(198,40,40,.45), var(--shadow); }
      70% { box-shadow: 0 0 0 12px rgba(198,40,40,0), var(--shadow); }
      100% { box-shadow: 0 0 0 0 rgba(198,40,40,0), var(--shadow); }
    }
    .busy .g { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .attn, .busy .g { animation: none; } }
  `;

  const PANEL_CSS = `
    :host { all: initial; ${TOKENS} font-family: ${FONT}; }
    * { box-sizing: border-box; }
    .panel { font-family: ${FONT}; position: fixed; z-index: 2147483647; width: 400px; max-width: calc(100vw - 24px);
      background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: var(--radius);
      box-shadow: var(--shadow); overflow: hidden; font-size: 14px; line-height: 1.5; }
    .panel[hidden] { display: none; }
    .head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
    .head b { font-size: 17px; font-weight: 800; letter-spacing: -0.02em; }
    .v { margin-left: auto; font-size: 11.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
      padding: 5px 10px; border-radius: 999px; color: #fff; background: var(--muted); }
    .v.bad { background: var(--bad); } .v.ok { background: var(--ok); } .v.warn { background: var(--warn); }
    .lead { margin: 0; padding: 14px 16px; font-size: 14.5px; border-bottom: 1px solid var(--line); }
    .lead.bad { color: var(--bad); font-weight: 600; background: var(--bad-soft); }
    .rows { margin: 0; padding: 6px 0; max-height: 52vh; overflow-y: auto; border-bottom: 1px solid var(--line); }
    .rows::-webkit-scrollbar { width: 10px; }
    .rows::-webkit-scrollbar-thumb { background: #d7ddc8; border-radius: 99px; border: 3px solid var(--card); }
    .row { display: grid; grid-template-columns: 10px 1fr; gap: 11px; padding: 9px 16px; }
    .row i { width: 9px; height: 9px; border-radius: 50%; margin-top: 6px; background: var(--muted); }
    .row i.ok { background: var(--ok); } .row i.fail { background: var(--bad); }
    .row i.warn { background: var(--warn); } .row i.unresolved { background: #b9c0aa; }
    .row b { display: block; font-size: 11.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase;
      color: var(--muted); margin-bottom: 2px; }
    .row span { display: block; font-size: 13.5px; }
    .addr { padding: 4px 16px 14px; font-family: ${MONO}; font-size: 12px; color: var(--muted); word-break: break-all; }
    .foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 16px; border-top: 1px solid var(--line); background: var(--soft); }
    .foot a { font-size: 13px; font-weight: 700; color: var(--ok); text-decoration: none; }
    .foot a:hover { text-decoration: underline; }
    .when { margin-left: auto; font-size: 12px; color: var(--muted); }
    button { font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; padding: 10px 16px;
      border-radius: 9px; color: var(--ink); background: var(--card); border: 1px solid var(--line); }
    button:hover { background: #eef2e4; }
    button.go { background: var(--signal); border-color: #b9e604; color: #131a02; }
    button.go:hover { filter: brightness(1.04); }
    .x { margin-left: auto; padding: 4px 9px; font-size: 18px; line-height: 1; color: var(--muted);
      background: none; border: none; border-radius: 8px; }
  `;

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  E.esc = esc;

  function lead(r) {
    if (r.lead) return r.lead; // a surface that knows more than the verdict alone (the X cross-check)
    if (r.verdict === "FAIL" && r.impersonates) {
      return `$${r.impersonates.ticker} is an official Robinhood stock token at ${r.impersonates.officialAddress.slice(0, 10)}… - this is a different contract.`;
    }
    if (r.verdict === "FAIL") return (r.checks || []).find((c) => c.status === "fail")?.detail || "failed a check";
    if (r.verdict === "OFFICIAL") return "This address is in Robinhood's published registry of tokenised stocks.";
    if (r.verdict === "PASS") return "The full check ran and found nothing against it. Not advice, and not a price call.";
    if (r.verdict === "CAUTION") return (r.checks || []).find((c) => c.status === "fail")?.detail || "something in the contract lane needs a look";
    return "No claim on an official asset. The contract itself has not been checked yet.";
  }
  E.badgeLead = lead;

  // the contracts a ticker-collision result is carrying, if any
  const candidates = (r) =>
    (r?.checks || []).filter((c) => String(c.id).startsWith("cand:")).map((c) => String(c.id).slice(5));

  /**
   * A reply you can paste. Short enough for a post, specific enough to be checked: what was
   * claimed, what the address actually is, the two strongest measured facts, and the
   * explorer link so nobody has to take our word for it.
   */
  function receipt(r) {
    if (!r) return "";
    const lines = [lead(r)];
    const evidence = (r.checks || [])
      .filter((c) => c.status === "fail" || c.status === "warn")
      .slice(0, 2)
      .map((c) => `· ${c.detail}`);
    if (evidence.length) lines.push("", ...evidence);
    lines.push("", `Check it yourself: ${r.explorerUrl}`);
    lines.push("Checked with edgerun - runs in your own browser, against the chain.");
    return lines.join("\n");
  }
  E.badgeReceipt = receipt;

  // One panel element for the whole page, parked at the document root.
  let panelHost = null;
  let panelRoot = null;
  let openFor = null;

  function ensurePanel() {
    if (panelHost && panelHost.isConnected) return panelRoot;
    panelHost = document.createElement("div");
    panelHost.setAttribute("data-edgerun", "panel-root");
    panelHost.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;";
    panelRoot = panelHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.hidden = true;
    panelRoot.append(style, panel);
    (document.documentElement || document.body).appendChild(panelHost);
    return panelRoot;
  }

  function closePanel() {
    if (!panelRoot) return;
    panelRoot.querySelector(".panel").hidden = true;
    openFor = null;
  }
  E.closeBadgePanel = closePanel;

  function position(panel, chip) {
    const r = chip.getBoundingClientRect();
    const w = Math.min(400, window.innerWidth - 24);
    const gap = 8;
    panel.style.width = `${w}px`;
    // measure before deciding which way to open
    panel.style.top = "0px";
    panel.style.left = "0px";
    const h = panel.offsetHeight || 320;
    const below = window.innerHeight - r.bottom;
    const top = below >= h + gap || below >= r.top ? r.bottom + gap : Math.max(12, r.top - h - gap);
    // keep it fully on screen horizontally, anchored to the chip where there is room
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left));
    panel.style.top = `${Math.max(12, Math.min(window.innerHeight - h - 12, top))}px`;
    panel.style.left = `${left}px`;
  }

  window.addEventListener("resize", closePanel, true);
  // Follow the badge while the page scrolls - X scrolls constantly, and slamming the panel
  // shut on the first pixel of scroll makes it unreadable. It closes only once the badge
  // it belongs to is actually gone.
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (!openFor || ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (!openFor) return;
      const r = openFor.chip.getBoundingClientRect();
      if (!openFor.chip.isConnected || r.bottom < 0 || r.top > window.innerHeight) return closePanel();
      position(panelRoot.querySelector(".panel"), openFor.chip);
    });
  }, true);
  document.addEventListener("click", (e) => {
    if (!openFor) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (path.includes(openFor.chip) || (panelHost && path.includes(panelHost))) return;
    closePanel();
  }, true);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); }, true);

  /**
   * @param {object} opts
   * @param {"inline"|"block"} [opts.mode]  pill in a row, or a full-width strip in the flow
   * @param {(address: string) => void} [opts.onFull]
   * @param {(address: string) => void} [opts.onWatch]
   */
  E.makeBadge = function makeBadge(opts = {}) {
    const block = opts.mode === "block";
    const host = document.createElement(block ? "div" : "span");
    host.className = "edgerun-badge";
    host.setAttribute("data-edgerun", "badge");
    if (block) host.style.cssText = "display:block;width:100%;margin:10px 0;";
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CHIP_CSS;
    const chip = document.createElement(block ? "div" : "span");
    chip.className = block ? "strip flat busy" : "chip flat busy";
    chip.setAttribute("role", "button");
    chip.setAttribute("tabindex", "0");
    chip.innerHTML = block
      ? `<span class="g">·</span><span class="body"><span class="title">checking…</span></span>`
      : `<span class="g">·</span><span class="sym">checking…</span>`;
    root.append(style, chip);

    let current = null;

    const toggle = () => {
      const r = ensurePanel();
      const panel = r.querySelector(".panel");
      if (openFor?.chip === chip && !panel.hidden) return closePanel();
      if (!current) return;
      renderPanel(panel, current);
      panel.hidden = false;
      openFor = { chip };
      position(panel, chip);
    };
    chip.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggle(); });
    chip.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });

    host.update = function update(result) {
      current = result;
      if (!result) return;
      const tone = TONE[result.verdict] || TONE.UNRESOLVED;
      const ticker = result.symbol || (result.address ? `${result.address.slice(0, 8)}…` : "token");
      const base = block ? "strip" : "chip";
      chip.className = `${base} ${tone.cls}${result.verdict === "FAIL" ? " attn" : ""}`;
      chip.innerHTML = block
        ? `<span class="g">${tone.glyph}</span>
           <span class="body"><span class="title">${esc(ticker)} · ${esc(tone.label)}</span>
           <span class="say">${esc(lead(result))}</span></span>
           <span class="more">details</span>`
        : `<span class="g">${tone.glyph}</span><span class="sym">${esc(ticker)}</span><span class="mark">${esc(tone.label)}</span>`;
      chip.title = lead(result);
      if (openFor?.chip === chip && panelRoot) {
        const panel = panelRoot.querySelector(".panel");
        renderPanel(panel, result);
        position(panel, chip);
      }
    };

    host.fail = function fail(message) {
      current = null;
      const base = block ? "strip" : "chip";
      chip.className = `${base} flat`;
      chip.innerHTML = block
        ? `<span class="g">?</span><span class="body"><span class="title">check unavailable</span><span class="say">${esc(message || "")}</span></span>`
        : `<span class="g">?</span><span class="sym">unavailable</span>`;
      chip.title = message || "check unavailable";
    };

    function renderPanel(panel, r) {
      const tone = TONE[r.verdict] || TONE.UNRESOLVED;
      const rows = (r.checks || []).map((c) => `
        <div class="row"><i class="${esc(c.status)}"></i>
          <span><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></span></div>`).join("");
      const needsFull = r.level !== "full" && r.verdict !== "FAIL";
      panel.innerHTML = `
        <div class="head"><b>${esc(r.symbol || "unknown token")}</b>
          <span class="v ${tone.cls}">${esc(r.verdict)}</span>
          <button class="x" data-act="close" aria-label="close">×</button></div>
        <p class="lead ${r.verdict === "FAIL" ? "bad" : ""}">${esc(lead(r))}</p>
        <div class="rows">${rows || '<div class="row"><i></i><span><span>nothing established yet</span></span></div>'}</div>
        <div class="addr">${esc(r.address)}</div>
        <div class="foot">
          ${needsFull ? '<button class="go" data-act="full">run full check</button>' : ""}
          ${candidates(r).length ? '<button data-act="rank">which one is real?</button>' : ""}
          <button data-act="trail">who launched it</button>
          <button data-act="copy">copy proof</button>
          <button data-act="watch">watch</button>
          <a href="${esc(r.explorerUrl)}" target="_blank" rel="noreferrer">explorer ↗</a>
          <span class="when">${r.cached ? "cached · " : ""}${ago(r.scannedAt)}</span>
        </div>`;
      panel.querySelector('[data-act="close"]')?.addEventListener("click", (e) => { e.stopPropagation(); closePanel(); });
      panel.querySelector('[data-act="full"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        e.target.textContent = "checking…";
        e.target.disabled = true;
        opts.onFull?.(r.address);
      });
      panel.querySelector('[data-act="watch"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        opts.onWatch?.(r.address);
        e.target.textContent = "watching ✓";
      });

      // Who launched it, and what else they have launched. Costs ~4 explorer requests, so
      // it is never run automatically - only when someone asks this question.
      panel.querySelector('[data-act="trail"]')?.addEventListener("click", async (e) => {
        e.stopPropagation();
        const btn = e.target;
        btn.disabled = true;
        btn.textContent = "reading records…";
        try {
          const { checks } = await E.ask({ type: "deployer", address: r.address });
          current = { ...current, checks: [...current.checks.filter((c) => !String(c.id).startsWith("deployer") && c.id !== "production_line" && c.id !== "explorer_scam"), ...checks] };
          renderPanel(panel, current);
          position(panel, chip);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "records unavailable";
          btn.title = err.message;
        }
      });

      // Turn a ticker collision into an answer: which of these does anyone actually hold?
      panel.querySelector('[data-act="rank"]')?.addEventListener("click", async (e) => {
        e.stopPropagation();
        const btn = e.target;
        btn.disabled = true;
        btn.textContent = "counting holders…";
        try {
          const { ranked, verdict } = await E.ask({ type: "rank", addresses: candidates(r) });
          const rows = ranked.map((c, i) => ({
            id: `cand:${c.address}`,
            label: `${i + 1}. ${c.name || c.symbol || "unnamed"}`,
            status: i === 0 && verdict === "clear" ? "ok" : "unresolved",
            detail: `${c.address} · ${c.holders == null ? "holder count unreadable" : `${c.holders.toLocaleString()} holders`}`,
          }));
          const verdictRow = {
            id: "rank", label: "which one",
            status: verdict === "clear" ? "ok" : "warn",
            detail: verdict === "clear"
              ? `one contract holds the overwhelming majority of this ticker's holders - the rest are near-empty. That is the one people actually own; it is not a statement that it is safe.`
              : verdict === "contested"
                ? `no clear winner - two or more of these have comparable holder counts, so the ticker genuinely does not identify a token here.`
                : `holder counts could not be read for enough of these to rank them.`,
          };
          current = { ...current, checks: [...current.checks.filter((c) => !String(c.id).startsWith("cand:")), verdictRow, ...rows] };
          renderPanel(panel, current);
          position(panel, chip);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "could not rank";
          btn.title = err.message;
        }
      });

      // Something you can paste under the post as a reply.
      panel.querySelector('[data-act="copy"]')?.addEventListener("click", async (e) => {
        e.stopPropagation();
        const btn = e.target;
        try {
          await navigator.clipboard.writeText(receipt(current));
          btn.textContent = "copied ✓";
        } catch {
          btn.textContent = "press ⌘C";
          const ta = document.createElement("textarea");
          ta.value = receipt(current);
          ta.style.cssText = "position:fixed;top:-1000px";
          document.body.appendChild(ta);
          ta.select();
          setTimeout(() => ta.remove(), 8000);
        }
      });
    }

    return host;
  };
})();
