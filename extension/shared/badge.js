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

  /**
   * "Not the real one" is a claim about identity, and a verdict can fail for other reasons:
   * holders that cannot move the token, a mint that is paused. Printing the impersonation
   * label over those would be accusing a token of something nobody found.
   */
  const isFake = (r) =>
    Boolean(r?.impersonates) || r?.claimed === true ||
    (r?.checks || []).some((c) => c.status === "fail" && c.id === "stock_token");

  const isMint = (r) => r?.chainName === "Solana";

  /**
   * The colour a verdict is drawn in.
   *
   * Green is kept for a FULL check that found nothing. A mint scan that found nothing is
   * drawn grey, and that is a decision, not an oversight: on a real pair page, on the first
   * day this ran there, the chip sat in the header of a token that was sixteen minutes old
   * and down 91% - correctly reporting a clean mint, in green, with a tick. The mint WAS
   * clean. Green said more than that.
   */
  function toneOf(r) {
    if (r.verdict === "PASS" && isMint(r)) return { ...TONE.PASS, cls: "flat" };
    return TONE[r.verdict] || TONE.UNRESOLVED;
  }

  function labelOf(r) {
    const tone = TONE[r.verdict] || TONE.UNRESOLVED;
    // a line about a ticker is not a verdict on a contract, so it does not borrow one's label
    if (r.ticker) return `${r.count} mints`;
    if (r.verdict === "FAIL" && !isFake(r)) return "failed a check";
    // A mint scan reads the mint and nothing else. "Checks pass" over a token that launched
    // four minutes ago would be read as "safe", and all it means is that the mint itself
    // cannot be turned against a holder.
    if (r.verdict === "PASS" && isMint(r)) return "mint is clean";
    return tone.label;
  }

  const ago = (ts) => {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    return `${Math.round(m / 60)}h ago`;
  };

  // One palette, light, shared by the chip and the panel.
  //
  // The neutrals are the same cool steel the panel and the site use, sampled off the mark,
  // so the chip reads as part of the product even though it is the one surface that stays
  // light in every theme (see the note at the top of this file).
  const TOKENS = `
    --ink: #12171a;
    --muted: #59646a;
    --line: #e0e5e7;
    --card: #ffffff;
    --soft: #f4f7f8;
    --bad: #c62828;
    --bad-soft: #fdecec;
    --warn: #a15c07;
    --warn-soft: #fdf3e0;
    --ok: #4a7c0f;
    --ok-soft: #f0f8e2;
    --signal: #ff3d9a;
    --radius: 12px;
    --shadow: 0 6px 24px rgba(10, 16, 20, 0.18), 0 1px 3px rgba(10, 16, 20, 0.12);
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
    .chip:hover { transform: translateY(-1px); box-shadow: 0 10px 28px rgba(10,16,20,.22); }
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
    .strip:hover { box-shadow: 0 12px 30px rgba(10,16,20,.24); }
    .strip .g { width: 24px; height: 24px; font-size: 14px; margin-top: 1px; }
    .strip .body { flex: 1; min-width: 0; }
    .strip .title { display: block; font-weight: 800; font-size: 14.5px; letter-spacing: -0.01em; margin-bottom: 2px; }
    .strip .say { display: block; color: var(--muted); font-size: 13px; }
    /* launch facts from an index: context, set apart from the sentence the checks produced */
    .strip .facts { display: block; margin-top: 4px; font-family: ${MONO}; font-size: 11px; color: var(--muted); opacity: .9; }
    .strip .more { font-size: 12px; font-weight: 700; color: var(--muted); white-space: nowrap; align-self: center; }

    /* Window mode. The sidebar is the default because it carries the whole session, but the
       panel sometimes needs to sit right next to the post it is talking about - so the escape
       hatch stays one click away rather than buried. Deliberately quiet: it is the exception. */
    .win { display: inline-flex; align-items: center; justify-content: center; flex: none;
      width: 23px; height: 23px; margin-left: 2px; padding: 0; font: inherit; font-size: 12px;
      line-height: 1; cursor: pointer; color: var(--muted); background: transparent;
      border: none; border-radius: 7px; align-self: center; }
    .win:hover { background: rgba(18, 23, 26, .09); color: var(--ink); }
    .chip.bad .win, .strip.bad .win { color: rgba(255,255,255,.82); }
    .strip.bad .win { color: var(--bad); }
    .chip.bad .win:hover { background: rgba(255,255,255,.2); color: #fff; }
    .strip.bad .win:hover { background: rgba(198,40,40,.12); }
    /* only a fake gets the full-volume treatment - if every post shouted, none of them would */
    .strip:not(.bad) { padding: 10px 13px; font-size: 13px; box-shadow: 0 2px 10px rgba(10,16,20,.10); }
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
    .panel { font-family: ${FONT}; position: fixed; z-index: 2147483647; width: 340px; max-width: calc(100vw - 24px);
      background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: var(--radius);
      box-shadow: var(--shadow); overflow: hidden; font-size: 13px; line-height: 1.5; }
    .panel[hidden] { display: none; }
    .head { display: flex; align-items: center; gap: 9px; padding: 11px 13px; border-bottom: 1px solid var(--line); }
    .head b { font-size: 15px; font-weight: 800; letter-spacing: -0.02em; }
    .v { margin-left: auto; font-size: 11.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
      padding: 5px 10px; border-radius: 999px; color: #fff; background: var(--muted); }
    .v.bad { background: var(--bad); } .v.ok { background: var(--ok); } .v.warn { background: var(--warn); }
    .lead { margin: 0; padding: 11px 13px; font-size: 13.5px; border-bottom: 1px solid var(--line); }
    .lead.bad { color: var(--bad); font-weight: 600; background: var(--bad-soft); }
    .rows { margin: 0; padding: 4px 0; max-height: 40vh; overflow-y: auto; border-bottom: 1px solid var(--line); }
    .rows::-webkit-scrollbar { width: 8px; }
    .more-rows { display: block; width: 100%; text-align: left; padding: 7px 13px; border: none;
      border-radius: 0; background: none; color: var(--muted); font-size: 12px; font-weight: 700; }
    .more-rows:hover { background: var(--soft); color: var(--ink); }
    .rows::-webkit-scrollbar-thumb { background: #d7dcde; border-radius: 99px; border: 3px solid var(--card); }
    .row { display: grid; grid-template-columns: 9px 1fr; gap: 9px; padding: 7px 13px; }
    .row i { width: 9px; height: 9px; border-radius: 50%; margin-top: 6px; background: var(--muted); }
    .row i.ok { background: var(--ok); } .row i.fail { background: var(--bad); }
    .row i.warn { background: var(--warn); } .row i.unresolved { background: #aab3b6; }
    .row b { display: block; font-size: 11.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase;
      color: var(--muted); margin-bottom: 2px; }
    .row span { display: block; font-size: 12.5px; }
    .addr { padding: 3px 13px 10px; font-family: ${MONO}; font-size: 11px; color: var(--muted); word-break: break-all; }
    .foot { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; padding: 9px 13px; border-top: 1px solid var(--line); background: var(--soft); }
    .foot a { font-size: 12px; font-weight: 700; color: var(--ok); text-decoration: none; }
    .foot a:hover { text-decoration: underline; }
    .when { margin-left: auto; font-size: 11px; color: var(--muted); }
    button { font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; padding: 7px 11px;
      border-radius: 8px; color: var(--ink); background: var(--card); border: 1px solid var(--line); }
    button:hover { background: #e9eef0; }
    button.go { background: var(--signal); border-color: #ed398f; color: #1d0812; }
    button.go:hover { filter: brightness(1.04); }
    .x { margin-left: auto; padding: 4px 9px; font-size: 18px; line-height: 1; color: var(--muted);
      background: none; border: none; border-radius: 8px; }
  `;

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  E.esc = esc;

  function lead(r) {
    if (r.lead) return r.lead; // a surface that knows more than the verdict alone (the X cross-check)
    const first = (status) => (r.checks || []).find((c) => c.status === status)?.detail;
    if (r.verdict === "FAIL" && r.impersonates) {
      return `$${r.impersonates.ticker} is a registered stock token at ${r.impersonates.officialAddress.slice(0, 10)}… - this is a different contract.`;
    }
    if (r.verdict === "FAIL") return first("fail") || "failed a check";
    if (r.verdict === "OFFICIAL") return "This address is in its issuer's published registry of tokenised stocks.";
    if (r.verdict === "PASS" && isMint(r)) {
      return "Nothing in the mint can be used against a holder: supply is fixed and no key can freeze or block a transfer. That is all this says - it is not who holds it, and not a price call.";
    }
    if (r.verdict === "PASS") return "The full check ran and found nothing against it. Not advice, and not a price call.";
    // a warning is a finding too: saying "needs a look" over a live freeze authority hides
    // the one sentence the reader came for
    if (r.verdict === "CAUTION") return first("fail") || first("warn") || "something in the contract lane needs a look";
    if (isMint(r)) return first("unresolved") || "Nothing has been established about this mint yet.";
    return "No claim on a registered asset. The contract itself has not been checked yet.";
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
    if (r.dexUrl) lines.push(`Chart: ${r.dexUrl}`);
    lines.push("Checked with EDGERUN - runs in your own browser, against the chain.");
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

  /**
   * Beside the post, not on top of it.
   *
   * Opening underneath the badge covered the very post the reader is trying to judge, which
   * is backwards for a panel whose whole job is to comment on it. So it goes into the gutter
   * next to the post first - right if there is room, then left - and only drops below when
   * the window is too narrow for either, which is the one case where there is no gutter to
   * use. Vertically it lines up with the badge rather than the post, so the eye does not
   * have to travel.
   */
  function position(panel, chip, anchor) {
    const c = chip.getBoundingClientRect();
    const a = (anchor || chip).getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(340, vw - 24);
    const gap = 14;
    panel.style.width = `${w}px`;
    panel.style.top = "0px";
    panel.style.left = "0px";
    const h = panel.offsetHeight || 300;

    let left;
    let top = c.top - 6;
    if (vw - a.right >= w + gap + 12) left = a.right + gap;          // gutter on the right
    else if (a.left >= w + gap + 12) left = a.left - w - gap;        // gutter on the left
    else {
      // no room either side: fall back to under the badge, flipping up when short of space
      left = Math.max(12, Math.min(vw - w - 12, c.left));
      const below = vh - c.bottom;
      top = below >= h + 8 || below >= c.top ? c.bottom + 8 : c.top - h - 8;
    }
    panel.style.left = `${Math.max(12, Math.min(vw - w - 12, left))}px`;
    panel.style.top = `${Math.max(12, Math.min(vh - h - 12, top))}px`;
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
      position(panelRoot.querySelector(".panel"), openFor.chip, openFor.anchor);
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
    let expanded = false;
    // the post this badge belongs to - the panel opens beside it, never over it
    const anchorOf = () => host.closest('article, [data-testid="tweet"]') || host;

    const openInPage = () => {
      const r = ensurePanel();
      const panel = r.querySelector(".panel");
      if (openFor?.chip === chip && !panel.hidden) return closePanel();
      if (!current) return;
      expanded = false;
      renderPanel(panel, current);
      panel.hidden = false;
      openFor = { chip, anchor: anchorOf() };
      position(panel, chip, anchorOf());
    };

    // The sidebar is the real surface: it carries the whole reading session, not just the one
    // token this chip belongs to. It is allowed to refuse - chrome.sidePanel.open() wants a
    // user gesture and this one has to survive the hop into the worker - so the in-page panel
    // stays behind it as a fallback. A click is never a no-op.
    const toggle = async () => {
      if (!current) return;
      try {
        await E.ask({ type: "panel:open", address: current.address });
      } catch {
        openInPage();
      }
    };
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // the small button is the only way to the in-page window; everything else goes to the sidebar
      if (e.target?.closest?.(".win")) return openInPage();
      toggle();
    });
    chip.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });

    host.update = function update(result) {
      current = result;
      if (!result) return;
      const tone = toneOf(result);
      const label = labelOf(result);
      const ticker = result.symbol || (result.address ? `${result.address.slice(0, 8)}…` : "token");
      const base = block ? "strip" : "chip";
      chip.className = `${base} ${tone.cls}${result.verdict === "FAIL" ? " attn" : ""}`;
      const win = `<button class="win" data-win title="open as a window on this page" aria-label="open as a window on this page">⧉</button>`;
      // every verdict says which chain it is about: the same ticker, and the same 0x address,
      // exist on more than one
      const where = result.chainName ? ` · ${esc(result.chainName)}` : "";
      const facts = E.launchLine ? E.launchLine(result.context) : "";
      chip.innerHTML = block
        ? `<span class="g">${tone.glyph}</span>
           <span class="body"><span class="title">${esc(ticker)}${where} · ${esc(label)}</span>
           <span class="say">${esc(lead(result))}</span>${facts ? `<span class="facts">${esc(facts)}</span>` : ""}</span>
           <span class="more">details</span>${win}`
        : `<span class="g">${tone.glyph}</span><span class="sym">${esc(ticker)}</span><span class="mark">${esc(label)}</span>${win}`;
      chip.title = lead(result);
      if (openFor?.chip === chip && panelRoot) {
        const panel = panelRoot.querySelector(".panel");
        renderPanel(panel, result);
        position(panel, chip, anchorOf());
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
      const tone = toneOf(r);
      // The checks that decided the verdict first, and only those, until asked for the rest.
      // A panel that opens with eight rows is a wall; the fail and warn lines are the answer.
      const all = r.checks || [];
      const loud = all.filter((c) => c.status === "fail" || c.status === "warn");
      const shown = expanded || loud.length === 0 ? all : loud.slice(0, 3);
      const hidden = all.length - shown.length;
      const rows = shown.map((c) => `
        <div class="row"><i class="${esc(c.status)}"></i>
          <span><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></span></div>`).join("")
        + (hidden > 0 ? `<button class="more-rows" data-act="expand">+ ${hidden} more check${hidden === 1 ? "" : "s"}</button>` : "");
      const evm = E.isAddress(r.address);
      const needsFull = evm && r.level !== "full" && r.verdict !== "FAIL";
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
          ${r.dexUrl ? `<a href="${esc(r.dexUrl)}" target="_blank" rel="noreferrer">chart ↗</a>` : ""}
          <span class="when">${r.cached ? "cached · " : ""}${ago(r.scannedAt)}</span>
        </div>`;
      // no explorer link to offer (a ticker count on a chain with no explorer wired)
      if (!r.explorerUrl) panel.querySelector('.foot a[href=""]')?.remove();
      panel.querySelector('[data-act="close"]')?.addEventListener("click", (e) => { e.stopPropagation(); closePanel(); });
      panel.querySelector('[data-act="expand"]')?.addEventListener("click", (e) => {
        e.stopPropagation();
        expanded = true;
        renderPanel(panel, current);
        position(panel, chip, anchorOf());
      });
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
          // Two different questions behind one button. On an EVM chain the wallet's own
          // transactions are read; for a Solana mint the launch comes from an index, and each
          // row says so.
          const { checks } = evm
            ? await E.ask({ type: "deployer", address: r.address })
            : await E.ask({ type: "launch", address: r.address });
          const LAUNCH = new Set(["production_line", "explorer_scam", "launch", "holders", "creator", "x_binding"]);
          current = { ...current, checks: [...current.checks.filter((c) => !String(c.id).startsWith("deployer") && !LAUNCH.has(c.id)), ...checks] };
          renderPanel(panel, current);
          position(panel, chip, anchorOf());
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
          position(panel, chip, anchorOf());
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

  /* ---- the account strip ----
   *
   * Deliberately NOT a makeBadge with a different colour. A badge is about a contract and its
   * whole panel is built for one - "who launched it", "copy proof", "watch" all take an
   * address. An account is a different object and answering it through the token panel would
   * have meant a synthetic address threaded through code that assumes addresses are real.
   *
   * It is also quieter than a badge on purpose. The contract verdict is the thing to act on
   * right now; the record is context for it, and context that shouts competes with the
   * warning it is supposed to support.
   */
  const ACCOUNT_CSS = `
    :host { all: initial; ${TOKENS} display: block; width: 100%; margin: 8px 0 0; font-family: ${FONT}; }
    * { box-sizing: border-box; }
    .acct { display: flex; align-items: flex-start; gap: 9px; width: 100%; text-align: left;
      padding: 8px 12px; border-radius: 10px; cursor: pointer; border: 1px solid var(--line);
      border-left: 4px solid var(--muted); background: var(--card); color: var(--ink);
      font-size: 12.5px; line-height: 1.45; font-family: ${FONT}; }
    .acct:hover { background: var(--soft); }
    .acct.bad { border-left-color: var(--bad); }
    .acct.warn { border-left-color: var(--warn); }
    .acct.ok { border-left-color: var(--ok); }
    .who { font-family: ${MONO}; font-weight: 700; white-space: nowrap; }
    .acct.bad .who { color: var(--bad); }
    .say { color: var(--muted); }
    .with { display: block; margin-top: 2px; font-family: ${MONO}; font-size: 11.5px; color: var(--muted); }
  `;

  /**
   * @param account the shape `E.decideAccount` returns, or null for nothing at all
   * @param onOpen  called with the handle - opens the record in the side panel
   */
  E.makeAccountStrip = function makeAccountStrip(account, { onOpen } = {}) {
    if (!account || !account.lead) return null;
    const host = document.createElement("div");
    host.className = "edgerun-account";
    host.setAttribute("data-edgerun", "account");
    host.style.cssText = "display:block;width:100%;";
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = ACCOUNT_CSS;

    const row = document.createElement("div");
    row.className = `acct ${account.tone || "flat"}`;
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");

    // Handles come from the page, so they are escaped like any other host-page string.
    const who = account.handle ? `<span class="who">@${esc(account.handle)}</span>` : "";
    const together = account.cluster?.handles?.length
      ? `<span class="with">${account.cluster.handles.slice(0, 6).map((h) => `@${esc(h)}`).join("  ")}</span>`
      : "";
    row.innerHTML = `${who}<span class="body"><span class="say">${esc(account.lead)}</span>${together}</span>`;

    const open = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (account.handle) onOpen?.(account.handle);
    };
    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") open(e);
    });

    root.append(style, row);
    return host;
  };

  /* ---- the profile card ----
   *
   * The whole record, on the one page where the reader has already decided they want it. A
   * profile is a question - "who is this" - and this is the half of the answer that nothing
   * else on the page can give: not the follower count, which is purchasable, but what this
   * account has actually put in front of YOU, and how it turned out.
   *
   * It shows on every profile, including the ones with nothing recorded, and that is not the
   * same inconsistency as badging every post. Here the empty state IS the answer to the
   * question the reader asked by navigating here, and it is also the only honest place to
   * say "this is empty because I have not read their posts yet" and offer to go and read them.
   */
  const PROFILE_CSS = `
    :host { all: initial; ${TOKENS} display: block; width: 100%; margin: 10px 0; font-family: ${FONT}; }
    * { box-sizing: border-box; }
    .card { border: 1px solid var(--line); border-left: 4px solid var(--muted); border-radius: var(--radius);
      background: var(--card); color: var(--ink); padding: 12px 14px; box-shadow: var(--shadow); }
    .card.bad { border-left-color: var(--bad); }
    .card.warn { border-left-color: var(--warn); }
    .card.ok { border-left-color: var(--ok); }
    .h { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .h b { font-size: 13.5px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
    .h .who { font-family: ${MONO}; font-size: 13px; font-weight: 700; }
    .nums { display: flex; gap: 18px; margin: 10px 0 2px; }
    .nums div { display: flex; flex-direction: column; }
    .nums b { font-size: 19px; font-weight: 800; line-height: 1.1; }
    .nums.bad b.hot { color: var(--bad); }
    .nums span { font-size: 11px; color: var(--muted); }
    .say { margin-top: 8px; font-size: 12.5px; line-height: 1.5; color: var(--muted); }
    .calls { margin: 10px 0 0; padding: 8px 0 0; border-top: 1px solid var(--line); }
    .call { display: flex; align-items: baseline; gap: 8px; font-size: 12px; padding: 3px 0; }
    .call code { font-family: ${MONO}; font-size: 11px; color: var(--muted); }
    .call .v { margin-left: auto; font-size: 10px; font-weight: 800; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--muted); }
    .call .v.fail { color: var(--bad); }
    .call .v.warn { color: var(--warn); }
    .acts { display: flex; gap: 7px; margin-top: 11px; }
    .acts button { font: inherit; font-size: 12px; font-weight: 700; padding: 6px 11px; cursor: pointer;
      color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
    .acts button:hover { background: var(--soft); }
    .acts button.go { color: #1d0812; background: var(--signal); border-color: var(--signal); }
    .acts button:disabled { opacity: .6; cursor: default; }
    .acts.running { align-items: center; }
    .prog { font-size: 12.5px; color: var(--muted); }
    .prog b { color: var(--ink); font-variant-numeric: tabular-nums; }
    .warn-box { margin-top: 11px; padding: 10px 12px; border-radius: 10px;
      background: var(--warn-soft); border: 1px solid #f0dcb4; }
    .warn-box b { display: block; font-size: 12.5px; margin-bottom: 4px; }
    .warn-box span { display: block; font-size: 12px; line-height: 1.5; color: var(--muted); }
    .summary { margin: 9px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--ink); }
    .call .px { font-family: ${MONO}; font-size: 11px; font-weight: 700; color: var(--muted); }
    .call .px.down { color: var(--bad); }
    .call .px.up { color: var(--ok); }
    .after { margin: 9px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--ink); }
    .after small { display: block; margin-top: 3px; font-size: 11.5px; color: var(--muted); }
    .talk { margin: 8px 0 0; font-size: 12px; line-height: 1.5; color: var(--muted); }
    .talk b { color: var(--ink); }
  `;

  const VTONE = { FAIL: "fail", CAUTION: "warn" };

  /**
   * @param handle  whose profile this is
   * @param record  what `graph:caller` returned, or null for an account never seen posting one
   * @param onScan  called to read this profile's recent posts into the record
   * @param onOpen  called to open the side panel on this account
   */
  const pct = (n) => {
    const r = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
    return `${r > 0 ? "+" : ""}${r}%`;
  };

  /**
   * @param onAfter  called to price this account's recent calls; resolves to the new record
   */
  E.makeProfileCard = function makeProfileCard(handle, record, { onScan, onOpen, onAfter } = {}) {
    const host = document.createElement("div");
    host.className = "edgerun-profile";
    host.setAttribute("data-edgerun", "profile");

    /*
     * Inline, and `!important`, which is not decoration.
     *
     * A `:host` rule inside the shadow root is the WEAKEST thing that can style this element:
     * the host page's own rules outrank it, as the note at the top of this file already says
     * about fonts. On a profile page the card lands among X's own layout children, where a
     * single inherited `height: 0`, `overflow: hidden` or `display: flex` on the parent is
     * enough to collapse it to nothing while it sits there in the DOM, present and invisible.
     *
     * An inline declaration with `!important` is the one thing an author stylesheet cannot
     * outrank, so the card survives whatever it is dropped into.
     */
    host.style.cssText = [
      "display:block!important",
      "width:100%!important",
      "max-width:100%!important",
      "height:auto!important",
      "min-height:0!important",
      "max-height:none!important",
      "flex:none!important",
      "position:relative!important",
      "visibility:visible!important",
      "opacity:1!important",
      "overflow:visible!important",
      "z-index:2147483000",
      "margin:10px 0!important",
      "box-sizing:border-box",
    ].join(";");

    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PROFILE_CSS;
    const card = document.createElement("div");

    // idle -> confirm -> running -> idle, with a summary once something has been read
    let stage = "idle";
    let progress = 0;
    let summary = null;
    let stopFlag = false;
    let pricing = false;
    let priceNote = null;

    const draw = (rec, busy) => {
      const tokens = rec?.tokens || 0;
      const flagged = rec?.flagged || 0;
      const ratio = tokens ? flagged / tokens : 0;
      card.className = `card ${!tokens ? "" : flagged && ratio >= 1 / 3 ? "bad" : flagged ? "warn" : "ok"}`;

      // what the price did after each one, where it has been asked for and could be read
      const px = (c) => {
        const o = c.out;
        if (!o || !Number.isFinite(o.pct)) return "";
        return `<span class="px ${o.pct <= -50 ? "down" : o.pct > 0 ? "up" : ""}" title="${
          o.basis === "first_trade" ? "since its first trade - the post is older than the pool" : o.since === "seen" ? "since it crossed your feed" : "since the post"
        }">${esc(pct(o.pct))}</span>`;
      };
      const calls = (rec?.calls || []).slice(0, 6).map((c) => `
        <div class="call"><span>${esc(c.symbol || "unnamed")}</span>
        <code>${esc(String(c.address).slice(0, 10))}…</code>
        ${px(c)}
        <span class="v ${VTONE[c.verdict] || ""}">${esc(c.verdict || "unresolved")}</span></div>`).join("");

      const o = rec?.outcomes;
      const after = o
        ? `<p class="after">${
            rec.outcomeSay
              ? esc(rec.outcomeSay)
              : `${o.priced} call${o.priced === 1 ? "" : "s"} priced so far - too few for a pattern.`
          }<small>Price since each post, from public pool candles. It describes what happened; an account warning about a contract has posted it too.</small></p>`
        : "";
      const owned = rec?.owned
        ? `<p class="talk"><b>${rec.owned}</b> of these tokens name${rec.owned === 1 ? "s" : ""} this account as ${rec.owned === 1 ? "its" : "their"} own X account in ${rec.owned === 1 ? "its" : "their"} metadata.</p>`
        : "";

      // Mentions are context and sit apart from the numbers that can mark an account.
      const mentions = rec?.mentions || 0;
      const topTickers = (rec?.tickers || []).slice(0, 5);
      const talk = mentions
        ? `<p class="talk"><b>${mentions}</b> ticker mention${mentions === 1 ? "" : "s"}${
            topTickers.length ? ` \u00b7 mostly ${topTickers.map((t) => `$${esc(t.ticker)}`).join(", ")}` : ""
          }. Naming a ticker is not posting a contract, so this is not counted against anyone.</p>`
        : "";

      const body = tokens
        ? `<div class="nums ${flagged ? "bad" : ""}">
             <div><b class="${flagged ? "hot" : ""}">${flagged}</b><span>flagged</span></div>
             <div><b>${tokens}</b><span>contracts</span></div>
             <div><b>${rec.days || 1}</b><span>day${(rec.days || 1) === 1 ? "" : "s"}</span></div>
           </div>
           <p class="say">${esc(rec.say || "")}. Counted only from posts you have actually scrolled past - this is your record of them, not a public score.</p>
           ${after}
           ${owned}
           ${talk}
           ${calls ? `<div class="calls">${calls}</div>` : ""}`
        : mentions
          ? `<p class="say">No contracts from this account yet - but it does talk about tokens.</p>${talk}`
          : `<p class="say">Nothing recorded from this account yet. The record only fills with posts you have scrolled past, so a profile you have never opened is empty rather than clean.</p>`;

      /*
       * The scan takes the page over for ten seconds, so it asks first.
       *
       * Not a formality. It scrolls the timeline out from under the reader, and somebody who
       * did not expect that reasonably concludes the page has broken or that something is
       * running away with their browser. A sentence saying what will happen, what it costs
       * and where it goes turns the same ten seconds into a thing they chose.
       */
      const acts =
        stage === "confirm"
          ? `<div class="warn-box">
               <b>This will scroll their timeline for about 10 seconds.</b>
               <span>It reads their recent posts the same way you would by scrolling, and records which
               contracts they put in front of you. It returns to the top when it is done. Leave the page
               alone while it runs, and nothing leaves this machine.</span>
             </div>
             <div class="acts">
               <button class="go" data-act="start">start</button>
               <button data-act="cancel">cancel</button>
             </div>`
          : stage === "running"
            ? `<div class="acts running">
                 <span class="prog">reading… <b>${progress}</b> post${progress === 1 ? "" : "s"}</span>
                 <button data-act="stop">stop</button>
               </div>`
            : `<div class="acts">
                 <button class="go" data-act="scan"${busy ? " disabled" : ""}>${tokens ? "read more posts" : "read their recent posts"}</button>
                 ${tokens && onAfter ? `<button data-act="after"${pricing ? " disabled" : ""}>${pricing ? "pricing…" : o ? "price more calls" : "what happened after"}</button>` : ""}
                 ${tokens ? '<button data-act="open">open the record</button>' : ""}
               </div>`;

      card.innerHTML = `
        <div class="h"><b>Edgerun</b><span class="who">@${esc(handle)}</span></div>
        ${body}
        ${summary ? `<p class="summary">${esc(summary)}</p>` : ""}
        ${priceNote ? `<p class="summary">${esc(priceNote)}</p>` : ""}
        ${acts}`;

      card.querySelector('[data-act="open"]')?.addEventListener("click", () => onOpen?.(handle));
      card.querySelector('[data-act="after"]')?.addEventListener("click", async () => {
        pricing = true;
        priceNote = null;
        draw(rec, false);
        let next = rec;
        try {
          const out = await onAfter?.(handle);
          if (out) {
            next = out;
            const r = out.run || {};
            priceNote = r.limited
              ? `Priced ${r.priced}. The price source limits how often it can be asked - try the rest in a minute.`
              : r.asked === 0
                ? "Every recent call is already priced."
                : `Priced ${r.priced} of ${r.asked}.${r.left ? ` ${r.left} more to go.` : ""}`;
          }
        } catch {
          priceNote = "The price source could not be reached. Nothing follows from that about these tokens.";
        }
        pricing = false;
        draw(next, false);
      });
      card.querySelector('[data-act="cancel"]')?.addEventListener("click", () => {
        stage = "idle";
        draw(rec, false);
      });
      card.querySelector('[data-act="scan"]')?.addEventListener("click", () => {
        stage = "confirm";
        draw(rec, false);
      });
      card.querySelector('[data-act="stop"]')?.addEventListener("click", () => {
        stopFlag = true;
      });
      card.querySelector('[data-act="start"]')?.addEventListener("click", async () => {
        stage = "running";
        progress = 0;
        stopFlag = false;
        summary = null;
        draw(rec, false);
        try {
          const out = await onScan?.({
            onProgress: ({ posts }) => {
              progress = posts;
              // only the counter is repainted: a full redraw every 450ms would steal focus
              // from the stop button, which is the one control that has to stay clickable
              const el = card.querySelector(".prog b");
              if (el) el.textContent = String(posts);
            },
            stopped: () => stopFlag,
          });
          stage = "idle";
          const read = out?.posts || 0;
          const after = out?.record || rec;
          const found = (after?.tokens || 0) - (rec?.tokens || 0);
          summary = read
            ? `Read ${read} post${read === 1 ? "" : "s"}. ${found > 0 ? `${found} new contract${found === 1 ? "" : "s"} recorded.` : "No contracts in them - which is itself worth knowing."}`
            : "Nothing could be read from this timeline.";
          draw(after, false);
        } catch {
          stage = "idle";
          draw(rec, false);
        }
      });
    };

    draw(record, false);
    root.append(style, card);
    host.update = (rec) => draw(rec, false);
    return host;
  };
})();
