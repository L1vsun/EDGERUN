// The side panel.
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
let filter = "all";
let focusAddress = null;
const open = new Set(); // addresses expanded by the reader, kept across re-renders

// ---- rendering ----

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
  return `
    <article class="row ${t}${e.address === focusAddress ? " focus" : ""}" data-address="${esc(e.address)}">
      <button class="head" data-act="toggle" aria-expanded="${expanded}">
        <span class="sym">${esc(e.symbol || `${e.address.slice(0, 10)}…`)}</span>
        <span class="verdict ${t}">${esc(e.verdict)}</span>
        <span class="say">${esc(e.say)}</span>
        <span class="meta">${esc(ago(e.at))}${where ? ` · ${esc(where)}` : ""}${
          e.seen > 1 ? ` · seen ${e.seen}×` : ""
        }${e.level === "identity" ? " · identity only" : ""}</span>
      </button>
      <div class="detail" ${expanded ? "" : "hidden"}>
        ${checks || '<div class="check"><i></i><span><span>nothing established yet</span></span></div>'}
        <div class="addr">${esc(e.address)}</div>
        <div class="acts">
          ${e.level !== "full" && e.verdict !== "FAIL" ? '<button data-act="full">run full check</button>' : ""}
          <button data-act="trail">who launched it</button>
          <button data-act="copy">copy proof</button>
          ${e.explorerUrl ? `<a href="${esc(e.explorerUrl)}" target="_blank" rel="noreferrer">explorer ↗</a>` : ""}
        </div>
      </div>
    </article>`;
}

function render() {
  const flagged = rows.filter(isFlagged);
  $("#n-all").textContent = rows.length;
  const nf = $("#n-flagged");
  nf.textContent = flagged.length;
  nf.dataset.hot = flagged.length ? "1" : "0";

  const shown = filter === "flagged" ? flagged : rows;
  const list = $("#list");

  if (!shown.length) {
    const tpl = rows.length && filter === "flagged" ? "#empty-clean" : "#empty-none";
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

async function bindTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const next = tab?.id ?? null;
  if (next === tabId) return;
  tabId = next;
  open.clear();
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
    const low = b.blockscout < 20;
    set("#stat-budget", `budget ${b.blockscout}/${b.rpc}`, low);
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
  const entry = rows.find((e) => e.address === address);

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
      // the worker records it, storage.onChanged repaints - nothing to do here
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
      const { checks } = await ask({ type: "deployer", address });
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

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    filter = tab.dataset.filter;
    for (const t of document.querySelectorAll(".tab")) t.classList.toggle("on", t === tab);
    render();
  });
}

// Light is the default; theme.js has already applied whatever was stored before first paint.
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
  renderWhere();
  render();
});

// The worker writes, we repaint. Covers both a fresh scan and a full check run from here.
// Falls back to the generic listener, and then to polling, so a browser missing the
// per-area event still gets a live panel rather than a frozen one.
const onLedgerChange = (changes) => {
  if (tabId == null) return;
  const hit = changes[`ledger:${tabId}`];
  if (!hit) return;
  rows = hit.newValue || [];
  renderWhere();
  render();
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
  // a navigation in the tab we are showing keeps the same ledger, but the location line moves
  if (id === tabId && info.status === "complete") load();
});
chrome.windows?.onFocusChanged?.addListener(bindTab);

await bindTab();
await readFocus();
render();
stats();
setInterval(stats, 30000);
