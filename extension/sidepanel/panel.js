// The side panel. The only surface the extension has, now that the popup is gone.
//
// It owns no data. The worker writes the ledger into chrome.storage.session and this
// subscribes to it, which matters more than it looks: MV3 kills the worker every ~30 s, so
// anything held in a long-lived port would die with it and take the panel's contents along.
// Storage plus an onChanged listener survives that without a reconnect dance.
//
// The panel also has to re-key itself constantly. It stays open across tab switches and
// navigations, so "which tab am I showing" is a moving target, not something read once.

const $ = (sel) => document.querySelector(sel);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ask = (message) =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (reply) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (!reply) return reject(new Error("no reply from the extension worker"));
      if (!reply.ok) return reject(new Error(reply.error));
      resolve(reply.data);
    });
  });

const ago = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
};

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const isAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(String(s || "").trim());

const TONE = { FAIL: "fail", CAUTION: "warn", OFFICIAL: "ok", PASS: "ok" };
const tone = (v) => TONE[v] || "flat";
const isFlagged = (e) => e.verdict === "FAIL" || e.verdict === "CAUTION";

const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

let tabId = null;
let rows = [];
let watching = [];       // addresses on the watchlist
let watchRows = [];      // their verdicts, resolved when the tab is opened
let filter = "all";
let focusAddress = null;
const open = new Set();          // addresses expanded by the reader, kept across re-renders
const dossiers = new Map();      // address -> deployer trail, once asked for

// ---- the deployer dossier ----
//
// The trail is the one thing here that is about a person rather than a contract, so it gets
// its own block instead of being flattened into check rows. What the wallet *calls on this
// token after launch* is the part worth the space: the fake TSLA's deployer spent 47 of its
// last 50 transactions blacklisting buyers, and that reads as a table, not a sentence.

function renderDossier(t) {
  if (!t || t.error) return `<div class="dossier"><p class="d-none">${esc(t?.error || "no record")}</p></div>`;
  const methods = (t.control || [])
    .map((c) => {
      const hot = /blacklist|blocklist|denylist|ban/i.test(c.method);
      return `<tr class="${hot ? "hot" : ""}"><td>${esc(c.method)}</td><td>${c.count}</td></tr>`;
    })
    .join("");
  const span = t.firstSeen ? `${esc(t.firstSeen)} to ${esc(t.lastSeen)}` : "";
  return `
    <div class="dossier">
      <div class="d-head">
        <span class="d-label">deployer</span>
        <code>${esc(t.deployer ? short(t.deployer) : "unknown")}</code>
        ${t.deployerIsFactoryFallback ? '<em title="the creation transaction could not be read, so this may be a factory">unconfirmed</em>' : ""}
      </div>
      <div class="d-stats">
        <div><b>${t.deployCount}${t.capped ? "+" : ""}</b><span>contracts launched</span></div>
        <div><b>${t.controlTotal}</b><span>owner calls on this token</span></div>
        <div><b>${t.sampled}</b><span>transactions read</span></div>
      </div>
      ${span ? `<p class="d-span">${span}</p>` : ""}
      ${
        methods
          ? `<table class="d-methods"><tbody>${methods}</tbody></table>
             <p class="d-note">What this wallet has been calling on this token since launch.</p>`
          : `<p class="d-none">No owner-only calls on this token in the transactions read.</p>`
      }
      ${t.deployer ? `<a class="d-link" href="https://robinhoodchain.blockscout.com/address/${esc(t.deployer)}" target="_blank" rel="noreferrer">open the wallet ↗</a>` : ""}
    </div>`;
}

// ---- rows ----

function renderRow(e) {
  const t = tone(e.verdict);
  const expanded = open.has(e.address);
  const checks = (e.checks || [])
    .map(
      (c) => `<div class="check"><i class="${esc(c.status)}"></i>
        <span><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></span></div>`,
    )
    .join("");
  const where = host(e.url);
  const watched = watching.includes(e.address);
  const dossier = dossiers.has(e.address) ? renderDossier(dossiers.get(e.address)) : "";
  return `
    <article class="row ${t}${e.address === focusAddress ? " focus" : ""}" data-address="${esc(e.address)}">
      <button class="head" data-act="toggle" aria-expanded="${expanded}">
        <span class="sym">${esc(e.symbol || short(e.address))}</span>
        <span class="verdict ${t}">${esc(e.verdict)}</span>
        <span class="say">${esc(e.say)}</span>
        <span class="meta">${esc(ago(e.at))}${where ? ` · ${esc(where)}` : ""}${
          e.seen > 1 ? ` · seen ${e.seen}×` : ""
        }${e.level === "identity" ? " · identity only" : ""}</span>
      </button>
      <div class="detail" ${expanded ? "" : "hidden"}>
        ${checks || '<div class="check"><i></i><span><span>nothing established yet</span></span></div>'}
        ${dossier}
        <div class="addr">${esc(e.address)}</div>
        <div class="acts">
          ${e.level !== "full" && e.verdict !== "FAIL" ? '<button data-act="full">run full check</button>' : ""}
          ${dossier ? "" : '<button data-act="trail">who launched it</button>'}
          <button data-act="copy">copy proof</button>
          <button data-act="watch">${watched ? "unwatch" : "watch"}</button>
          ${e.explorerUrl ? `<a href="${esc(e.explorerUrl)}" target="_blank" rel="noreferrer">explorer ↗</a>` : ""}
        </div>
      </div>
    </article>`;
}

function render() {
  const flagged = rows.filter(isFlagged);
  $("#n-all").textContent = rows.length;
  $("#n-watch").textContent = watching.length;
  const nf = $("#n-flagged");
  nf.textContent = flagged.length;
  nf.dataset.hot = flagged.length ? "1" : "0";

  const shown = filter === "flagged" ? flagged : filter === "watch" ? watchRows : rows;
  const list = $("#list");

  if (!shown.length) {
    const tpl = filter === "watch" ? "#empty-watch" : filter === "flagged" && rows.length ? "#empty-clean" : "#empty-none";
    list.replaceChildren($(tpl).content.cloneNode(true));
    return;
  }
  list.innerHTML = shown.map(renderRow).join("");
}

function renderWhere() {
  const urls = rows.map((e) => e.url).filter(Boolean);
  const h = urls.length ? host(urls[0]) : null;
  $("#where").textContent = h ? `this tab · ${h}` : "";
}

// ---- data ----

async function load() {
  if (tabId == null) return;
  try {
    rows = (await ask({ type: "ledger:get", tabId })) || [];
  } catch {
    rows = [];
  }
  renderWhere();
  render();
}

async function loadWatch({ resolve = false } = {}) {
  try {
    watching = ((await ask({ type: "watch:list" })) || []).map((w) => w.address);
  } catch {
    watching = [];
  }
  if (!resolve || !watching.length) {
    watchRows = watching.length ? watchRows.filter((r) => watching.includes(r.address)) : [];
    return;
  }
  // Opening the watch tab is the recheck: these are tokens somebody already decided to keep
  // an eye on, so a stale verdict is the one thing this list must not show.
  try {
    const out = await ask({ type: "verdicts", addresses: watching, tabId });
    watchRows = watching
      .map((a) => out[a])
      .filter(Boolean)
      .map((r) => ({
        address: r.address.toLowerCase(),
        symbol: r.symbol || null,
        verdict: r.verdict,
        level: r.level,
        say:
          (r.checks || []).find((c) => c.status === "fail")?.detail ||
          (r.checks || []).find((c) => c.status === "warn")?.detail ||
          (r.verdict === "OFFICIAL" ? "in Robinhood's published registry" : "no failing check"),
        checks: r.checks || [],
        explorerUrl: r.explorerUrl || null,
        url: null,
        at: r.scannedAt || Date.now(),
        seen: 1,
      }));
  } catch {
    /* leave whatever was there rather than blanking the list */
  }
}

async function bindTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const next = tab?.id ?? null;
  if (next === tabId) return;
  tabId = next;
  open.clear();
  dossiers.clear();
  focusAddress = null;
  await readFocus();
  await load();
}

async function readFocus() {
  if (tabId == null) return;
  try {
    const key = `focus:${tabId}`;
    const got = await chrome.storage.session.get(key);
    // only honour a focus that was set for this opening, not one left over from an hour ago
    const hit = got[key];
    if (hit && Date.now() - hit.at < 15000) {
      focusAddress = hit.address;
      open.add(hit.address);
    }
  } catch {}
}

async function stats() {
  const set = (sel, text, warn) => {
    const el = $(sel);
    el.textContent = text;
    el.classList.toggle("warn", Boolean(warn));
  };
  try {
    const r = await ask({ type: "registry" });
    set("#stat-registry", r.loaded ? `registry ${r.count}` : "registry unavailable", !r.loaded);
  } catch {
    set("#stat-registry", "registry unavailable", true);
  }
  try {
    const b = await ask({ type: "blocklist" });
    set("#stat-block", `blocklist ${b.count}`);
  } catch {
    set("#stat-block", "blocklist unavailable", true);
  }
  try {
    const b = await ask({ type: "budget" });
    set("#stat-budget", `budget ${b.blockscout}/${b.rpc}`, b.blockscout < 20);
  } catch {
    set("#stat-budget", "budget -");
  }
}

// ---- events ----

$("#list").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("[data-act]");
  if (!btn) return;
  const address = btn.closest(".row")?.dataset.address;
  if (!address) return;
  const entry = (filter === "watch" ? watchRows : rows).find((e) => e.address === address);
  if (!entry) return;

  if (btn.dataset.act === "toggle") {
    if (open.has(address)) open.delete(address);
    else open.add(address);
    focusAddress = null;
    return render();
  }

  if (btn.dataset.act === "full") {
    btn.disabled = true;
    btn.textContent = "checking…";
    try {
      await ask({ type: "verdict", address, level: "full", tabId });
      if (filter === "watch") {
        await loadWatch({ resolve: true });
        render();
      }
      // on the session list the worker records it and storage.onChanged repaints
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "check failed";
      btn.title = err.message;
    }
    return;
  }

  if (btn.dataset.act === "trail") {
    btn.disabled = true;
    btn.textContent = "reading records…";
    try {
      const { trail, checks } = await ask({ type: "deployer", address });
      dossiers.set(address, trail);
      entry.checks = [
        ...(entry.checks || []).filter(
          (c) => !String(c.id).startsWith("deployer") && c.id !== "production_line" && c.id !== "explorer_scam",
        ),
        ...checks,
      ];
      render();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "records unavailable";
      btn.title = err.message;
    }
    return;
  }

  if (btn.dataset.act === "watch") {
    await ask({ type: "watch:toggle", address }).catch(() => {});
    await loadWatch({ resolve: filter === "watch" });
    render();
    return;
  }

  if (btn.dataset.act === "copy") {
    const lines = [entry.say];
    const evidence = (entry.checks || [])
      .filter((c) => c.status === "fail" || c.status === "warn")
      .slice(0, 2)
      .map((c) => `· ${c.detail}`);
    if (evidence.length) lines.push("", ...evidence);
    if (entry.explorerUrl) lines.push("", `Check it yourself: ${entry.explorerUrl}`);
    lines.push("Checked with EDGERUN - runs in your own browser, against the chain.");
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      btn.textContent = "copied ✓";
    } catch {
      btn.textContent = "copy blocked";
    }
  }
});

// paste an address and check it without leaving the panel (this was the popup's one job)
$("#check").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const input = $("#q");
  const err = $("#err");
  const address = input.value.trim();
  err.hidden = true;
  if (!isAddress(address)) {
    err.textContent = "that is not a contract address";
    err.hidden = false;
    return;
  }
  const go = $("#check button");
  go.disabled = true;
  go.textContent = "…";
  try {
    await ask({ type: "verdict", address, level: "full", tabId });
    input.value = "";
    filter = "all";
    for (const t of document.querySelectorAll(".tab")) t.classList.toggle("on", t.dataset.filter === "all");
    open.add(address.toLowerCase());
    await load();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    go.disabled = false;
    go.textContent = "check";
  }
});

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", async () => {
    filter = tab.dataset.filter;
    for (const t of document.querySelectorAll(".tab")) t.classList.toggle("on", t === tab);
    if (filter === "watch") {
      $("#list").innerHTML = '<div class="empty"><b>rechecking…</b></div>';
      await loadWatch({ resolve: true });
    }
    render();
  });
}

$("#theme").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("edgerun.theme", next);
  } catch {}
});

$("#clear").addEventListener("click", async () => {
  if (tabId == null) return;
  await ask({ type: "ledger:clear", tabId }).catch(() => {});
  rows = [];
  open.clear();
  dossiers.clear();
  renderWhere();
  render();
});

// The worker writes, we repaint. Falls back to the generic listener, then to polling, so a
// browser missing the per-area event still gets a live panel rather than a frozen one.
const onLedgerChange = (changes) => {
  if (tabId == null) return;
  const hit = changes[`ledger:${tabId}`];
  if (!hit) return;
  rows = hit.newValue || [];
  renderWhere();
  if (filter !== "watch") render();
};

if (chrome.storage.session?.onChanged) {
  chrome.storage.session.onChanged.addListener(onLedgerChange);
} else if (chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => area === "session" && onLedgerChange(changes));
} else {
  setInterval(load, 2000);
}

chrome.tabs.onActivated.addListener(bindTab);
chrome.tabs.onUpdated.addListener((id, info) => {
  if (id === tabId && info.status === "complete") load();
});
chrome.windows?.onFocusChanged?.addListener(bindTab);

await bindTab();
await readFocus();
await loadWatch();
render();
stats();
setInterval(stats, 30000);
