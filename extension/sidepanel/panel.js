// The side panel. The only surface the extension has, now that the popup is gone.
//
// It owns no data. The worker writes the ledger into chrome.storage.session and this
// subscribes to it, which matters more than it looks: MV3 kills the worker every ~30 s, so
// anything held in a long-lived port would die with it and take the panel's contents along.
// Storage plus an onChanged listener survives that without a reconnect dance.
//
// The ledger it shows is ONE list for the whole session, not one per tab. The panel still
// follows the active tab, but only to pick up the focus hint a badge leaves behind - switching
// tabs or walking from X to the explorer must never empty the list, which is what it did when
// the ledger was keyed by tab.

import { isSolanaAddress } from "../lib/base58.js";
import { claimsFor } from "../lib/claim-from.js";
import { validateClaim, verifyPlanText } from "../lib/claim.js";

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

// Solana rows come from a different provider and answer to different messages. The deep
// lookups below - deployer trail, exit sweep, cross-chain fan-out - are all EVM by
// construction, so offering them on a mint would be offering a button that cannot work.
const isEvmRow = (e) => isAddress(e.address);

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
const sweeps = new Map();        // address -> exit-size sweep, once asked for
const ranks = new Map();         // address -> ticker-collision ranking, once asked for
const elsewhere = new Map();     // address -> where else it is deployed, once asked for
let watchChanges = [];           // verdicts that moved since the last time they were looked at
const drafts = new Map();        // address -> the reply being composed for it
let callers = [];                // the account graph, most flagged first
let graphTokens = {};            // address -> who posted it, and whether they arrived together
let graphPaused = false;
const openCallers = new Set();   // handles expanded on the callers tab

const REPO = "https://github.com/L1vsun/EDGERUN";

// the contracts a ticker-collision result is carrying, if any
const candidatesOf = (e) =>
  (e?.checks || []).filter((c) => String(c.id).startsWith("cand:")).map((c) => String(c.id).slice(5));

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

// ---- claim against reality ----
//
// The whole product in two rows. A post names a ticker, the address next to it resolves to
// something else, and every other check is downstream of that one mismatch - so it is shown
// as a comparison rather than buried in prose, with both addresses side by side.

function renderClaim(e) {
  if (!e.impersonates) return "";
  const i = e.impersonates;
  return `
    <div class="claim">
      <div class="c-row">
        <span class="c-label">the post says</span>
        <b>$${esc(i.ticker)}</b>
        <code>${esc(short(i.officialAddress))}</code>
        <em>Robinhood's registry</em>
      </div>
      <div class="c-row bad">
        <span class="c-label">you are looking at</span>
        <b>${esc(e.symbol || "this contract")}</b>
        <code>${esc(short(e.address))}</code>
        <em>a different token</em>
      </div>
    </div>`;
}

// ---- the ticker collision ----
//
// A ticker is not an identity on this chain: seven contracts use $PEPE. Ranking them by
// holders is the only honest way to answer "which one do people actually own", and when the
// top two are close the answer is that there is no answer - which the table says out loud
// rather than quietly picking the biggest.

function renderRank(r) {
  if (!r) return "";
  const rows = (r.ranked || [])
    .map((c, i) => {
      const lead = i === 0 && r.verdict === "clear";
      return `<tr class="${lead ? "lead" : ""}">
        <td>${i + 1}</td>
        <td><b>${esc(c.name || c.symbol || "unnamed")}</b><code>${esc(short(c.address))}</code></td>
        <td>${c.holders == null ? "?" : c.holders.toLocaleString()}</td>
      </tr>`;
    })
    .join("");
  const note =
    r.verdict === "clear"
      ? "One contract holds the overwhelming majority of this ticker's holders. That is the one people own - it is not a statement that it is safe."
      : r.verdict === "contested"
        ? "No clear winner: two or more have comparable holder counts, so the ticker genuinely does not identify a token here."
        : "Holder counts could not be read for enough of these to rank them.";
  return `
    <div class="rank ${r.verdict === "clear" ? "ok" : "warn"}">
      <div class="s-head">
        <span class="d-label">who else uses this ticker</span>
        <span class="s-verdict ${r.verdict === "clear" ? "ok" : "warn"}">${esc(r.verdict)}</span>
      </div>
      <table class="r-grid"><thead><tr><th></th><th>contract</th><th>holders</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="s-note">${esc(note)}</p>
    </div>`;
}

// ---- the exit sweep ----
//
// A grid, because the shape of the answer is the answer: a row of green that turns red
// partway along is a size limit, and a whole row of red is a wall. Reading that off a
// sentence takes a paragraph; reading it off five cells takes no time at all.

const SWEEP_TONE = { blocked: "fail", capped: "fail", selective: "warn", clear: "ok", unresolved: "flat" };

function renderSweep(s) {
  if (!s) return "";
  const t = SWEEP_TONE[s.verdict] || "flat";
  const grid = (s.holders || [])
    .map((h) => {
      const cells = h.steps
        .map((st) => `<i class="cell ${esc(st.status)}" title="${esc(st.label)}${st.reason ? ` - ${esc(st.reason)}` : ""}"></i>`)
        .join("");
      return `<tr><td><code>${esc(short(h.address))}</code></td><td class="cells">${cells}</td></tr>`;
    })
    .join("");
  const heads = (s.holders?.[0]?.steps || []).map((st) => `<th>${esc(st.label)}</th>`).join("");
  return `
    <div class="sweep ${t}">
      <div class="s-head">
        <span class="d-label">exit size test</span>
        <span class="s-verdict ${t}">${esc(s.verdict)}</span>
      </div>
      ${
        grid
          ? `<table class="s-grid"><thead><tr><th></th><th class="cells"><span class="s-steps">${heads}</span></th></tr></thead><tbody>${grid}</tbody></table>`
          : ""
      }
      <p class="s-note">${esc(s.note)}</p>
      <p class="s-fine">Simulated against the current block with eth_call. Nothing signed, nothing sent, no wallet involved.</p>
    </div>`;
}

// ---- the same address, everywhere else ----
//
// An 0x address exists on every EVM chain at once, and a post that pastes one rarely says
// which chain it meant. The table below is that ambiguity made visible: the rows are chains,
// and the thing to notice is when the symbol column disagrees with itself.

function renderElsewhere(x) {
  if (!x) return "";
  if (x.error) {
    return `<div class="xc"><div class="s-head"><span class="d-label">other chains</span></div>
      <p class="s-note">${esc(x.error)}</p></div>`;
  }

  const rows = (x.chains || [])
    .map((c) => {
      if (c.present === null) {
        return `<tr class="off"><td>${esc(c.name)}</td><td colspan="2">unreachable</td></tr>`;
      }
      if (!c.present) {
        return `<tr class="off"><td>${esc(c.name)}</td><td colspan="2">nothing deployed</td></tr>`;
      }
      const what = c.isToken ? esc(c.symbol || c.tokenName || "token") : "a contract, not a token";
      const note = c.list ? `<span class="xc-list ${esc(c.list.status)}">${esc(c.list.detail)}</span>` : "";
      const name = c.explorerUrl
        ? `<a href="${esc(c.explorerUrl)}" target="_blank" rel="noreferrer">${esc(c.name)} ↗</a>`
        : esc(c.name);
      return `<tr><td>${name}</td><td><b>${what}</b></td><td>${note}</td></tr>`;
    })
    .join("");

  return `
    <div class="xc ${x.conflict ? "fail" : "flat"}">
      <div class="s-head">
        <span class="d-label">other chains</span>
        ${x.conflict ? '<span class="s-verdict fail">SYMBOLS DISAGREE</span>' : ""}
      </div>
      <p class="s-note">${esc(x.say)}</p>
      <table class="xc-grid"><tbody>${rows}</tbody></table>
      <p class="s-fine">One batched call per chain. Only Robinhood Chain publishes an authoritative
        registry, so elsewhere a curated list is the strongest evidence available and absence from
        one is not a finding.</p>
    </div>`;
}

// ---- the reply, and the report ----
//
// Two different jobs that share one piece of text. The reply is what gets pasted under the
// post; the report is what turns a thing you scrolled past into a blocklist entry. There is
// no server to submit to, and there does not need to be - the blocklist lives in the repo,
// so a report is a prefilled issue. Zero infrastructure, full provenance in git.

function proofText(e) {
  const lines = [e.say];
  const evidence = (e.checks || [])
    .filter((c) => c.status === "fail" || c.status === "warn")
    .slice(0, 2)
    .map((c) => `- ${c.detail}`);
  if (evidence.length) lines.push("", ...evidence);
  if (e.explorerUrl) lines.push("", `Check it yourself: ${e.explorerUrl}`);
  lines.push("Checked with EDGERUN - runs in your own browser, against the chain.");
  return lines.join("\n");
}

function shortProof(e) {
  const first = (e.checks || []).find((c) => c.status === "fail");
  return [
    e.impersonates ? `that is not $${e.impersonates.ticker}` : e.say,
    first && e.impersonates ? first.detail : "",
    e.explorerUrl || "",
  ]
    .filter(Boolean)
    .join("\n");
}

const TONES = { full: proofText, short: shortProof };

/**
 * The machine-checkable half of a report.
 *
 * Only claims that pass validation are attached. A claim that cannot be re-run is worse than
 * no claim: it looks like evidence and is not, and the whole point of the format is that a
 * maintainer should never have to take the reporter's word for anything.
 */
function claimBlock(e) {
  let claims = [];
  try {
    claims = claimsFor(e).filter((c) => validateClaim(c).ok);
  } catch {
    return [];
  }
  if (!claims.length) return [];
  return claims.flatMap((c) => [
    "**Claim**",
    "```json",
    JSON.stringify(c, null, 2),
    "```",
    "",
    "**How to check it without trusting me**",
    "```",
    verifyPlanText(c),
    "```",
    "",
  ]);
}

function reportUrl(e) {
  const title = `blocklist: ${e.symbol || e.address} (${e.verdict})`;
  const body = [
    `**Address:** \`${e.address}\``,
    `**Verdict:** ${e.verdict}`,
    "",
    "**Evidence**",
    ...(e.checks || [])
      .filter((c) => c.status === "fail" || c.status === "warn")
      .map((c) => `- ${c.label}: ${c.detail}`),
    "",
    e.explorerUrl ? `Explorer: ${e.explorerUrl}` : "",
    "",
    // The claim is the part a maintainer acts on: prose says what was found, the plan below
    // says how to find it again without believing any of the prose. See docs/CLAIMS.md.
    ...claimBlock(e),
    "_Filed from the EDGERUN side panel._",
  ]
    .filter(Boolean)
    .join("\n");
  return `${REPO}/issues/new?labels=blocklist&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

function renderComposer(e) {
  const d = drafts.get(e.address);
  if (!d) return "";
  return `
    <div class="composer">
      <div class="k-tabs">
        <button data-act="tone" data-tone="full" class="${d.tone === "full" ? "on" : ""}">full</button>
        <button data-act="tone" data-tone="short" class="${d.tone === "short" ? "on" : ""}">short</button>
      </div>
      <textarea data-act="draft" rows="6" spellcheck="false">${esc(d.text)}</textarea>
      <div class="k-acts">
        <button class="go" data-act="copy-draft">copy reply</button>
        ${claimsFor(e).some((c) => validateClaim(c).ok) ? '<button data-act="copy-claim">copy claim</button>' : ""}
        <a href="${esc(reportUrl(e))}" target="_blank" rel="noreferrer">report to the blocklist ↗</a>
      </div>
    </div>`;
}

// ---- who put this in front of you ----
//
// The other half of every check. A contract arrives attached to a person, and the question
// after "is this real" is "who handed it to me, and what else have they handed me".

const mins = (ms) => {
  const m = Math.round(ms / 60000);
  if (m < 1) return "under a minute";
  if (m < 90) return `${m} minute${m === 1 ? "" : "s"}`;
  return `${Math.round(m / 60)} hours`;
};

const at = (h) => `<a class="who" data-act="who" data-handle="${esc(h)}" href="https://x.com/${esc(h)}" target="_blank" rel="noreferrer">@${esc(h)}</a>`;

/**
 * The coordination line.
 *
 * Deliberately phrased as what was observed rather than as a conclusion: "six accounts in
 * your feed inside eleven minutes" is a fact this extension witnessed, and "this is a paid
 * push" is a guess about people it cannot see. The reader can draw the second one.
 */
function renderCluster(g) {
  if (!g) return "";
  const rows = [];
  if (g.cluster) {
    rows.push(`<div class="check"><i class="warn"></i><span>
      <b>arrived together</b>
      <span>${g.cluster.count} accounts posted this in your feed inside ${esc(mins(g.cluster.spanMs))} - ${g.cluster.handles.slice(0, 6).map(at).join(" ")}</span>
    </span></div>`);
  }
  if (g.first) {
    rows.push(`<div class="check"><i></i><span>
      <b>first from</b>
      <span>${at(g.first.handle)}, ${esc(ago(g.first.at))}${g.callers.length > 1 ? ` · ${g.callers.length} accounts in total` : ""}</span>
    </span></div>`);
  }
  return rows.join("");
}

function renderCallerRow(c) {
  const expanded = openCallers.has(c.handle);
  const calls = (c.calls || [])
    .slice(0, 40)
    .map(
      (x) => `<div class="check"><i class="${esc(tone(x.verdict))}"></i><span>
        <b>${esc(x.symbol || short(x.address))}</b>
        <span>${esc(x.verdict)} · ${esc(ago(x.last || x.at))}${x.n > 1 ? ` · ${x.n}×` : ""}</span>
      </span></div>`,
    )
    .join("");
  return `
    <article class="row ${c.tone === "bad" ? "fail" : c.tone === "mixed" ? "warn" : "flat"}" data-handle="${esc(c.handle)}">
      <button class="head" data-act="caller" aria-expanded="${expanded}">
        <span class="sym">@${esc(c.handle)}</span>
        <span class="verdict ${c.tone === "bad" ? "fail" : c.tone === "mixed" ? "warn" : "flat"}">${c.flagged}/${c.tokens}</span>
        <span class="say">${esc(c.say)}</span>
        <span class="meta">${esc(c.display || "")}${c.display ? " · " : ""}last ${esc(ago(c.last))}</span>
      </button>
      <div class="detail" ${expanded ? "" : "hidden"}>
        ${calls || '<div class="check"><i></i><span><span>no contracts recorded</span></span></div>'}
        <div class="acts">
          <a href="https://x.com/${esc(c.handle)}" target="_blank" rel="noreferrer">open profile ↗</a>
        </div>
      </div>
    </article>`;
}

// ---- rows ----

/**
 * One row.
 *
 * The rule here is that findings get space and non-findings do not. A scan runs six or seven
 * checks and most of them resolve nothing - "LP lock cannot be established on this chain" is
 * two lines of prose saying we do not know, and five of those stacked above the thing that
 * actually matters is how a panel becomes unreadable. So checks that found something are
 * shown, and the rest fold into one line you can open.
 */
function renderRow(e) {
  const t = tone(e.verdict);
  const expanded = open.has(e.address);

  const all = e.checks || [];
  const found = all.filter((c) => c.status === "fail" || c.status === "warn");
  const passed = all.filter((c) => c.status === "ok");
  const quiet = all.filter((c) => c.status !== "fail" && c.status !== "warn" && c.status !== "ok");

  const checkRow = (c) => `<div class="check"><i class="${esc(c.status)}"></i>
    <span><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></span></div>`;

  const shown = [...found, ...passed].map(checkRow).join("");
  const folded = quiet.length
    ? `<details class="quiet"><summary>${quiet.length} check${quiet.length === 1 ? "" : "s"} could not be resolved</summary>${quiet.map(checkRow).join("")}</details>`
    : "";

  const where = host(e.url);
  const watched = watching.includes(e.address);
  const dossier = dossiers.has(e.address) ? renderDossier(dossiers.get(e.address)) : "";
  const sweep = sweeps.has(e.address) ? renderSweep(sweeps.get(e.address)) : "";
  const rank = ranks.has(e.address) ? renderRank(ranks.get(e.address)) : "";
  const xchain = elsewhere.has(e.address) ? renderElsewhere(elsewhere.get(e.address)) : "";
  const moved = watchChanges.find((c) => c.address === e.address);
  const cluster = graphTokens[e.address]?.cluster;
  const deep = dossier || sweep || xchain;
  const evm = isEvmRow(e);

  return `
    <article class="row ${t}${e.address === focusAddress ? " focus" : ""}" data-address="${esc(e.address)}">
      <button class="head" data-act="toggle" aria-expanded="${expanded}">
        <span class="who-what">
          <span class="sym">${esc(e.symbol || short(e.address))}</span>
          <span class="chain">${esc(e.chainName || "Robinhood Chain")}</span>
        </span>
        <span class="verdict ${t}">${esc(e.verdict)}</span>
        <span class="say">${esc(e.say)}</span>
        ${moved ? `<span class="moved">was ${esc(moved.from)} &rarr; now ${esc(moved.to)}</span>` : ""}
        ${cluster ? `<span class="moved">${cluster.count} accounts, ${esc(mins(cluster.spanMs))}</span>` : ""}
        <span class="meta">${esc(ago(e.at))}${where ? ` · ${esc(where)}` : ""}${
          e.seen > 1 ? ` · seen ${e.seen}×` : ""
        }${e.level === "identity" ? " · identity only" : ""}</span>
      </button>
      <div class="detail" ${expanded ? "" : "hidden"}>
        ${renderClaim(e)}
        ${renderCluster(graphTokens[e.address])}
        ${shown || '<div class="check"><i></i><span><span>nothing established yet</span></span></div>'}
        ${folded}
        ${rank}
        ${dossier}
        ${sweep}
        ${xchain}
        ${renderComposer(e)}
        <div class="addr">${esc(e.address)}</div>
        <div class="acts">
          ${evm && e.level !== "full" && e.verdict !== "FAIL" ? '<button class="go-act" data-act="full">run full check</button>' : ""}
          ${evm && !deep ? '<button class="go-act" data-act="deep">dig deeper</button>' : ""}
          ${evm && !rank && candidatesOf(e).length ? '<button data-act="rank">which is real</button>' : ""}
          ${evm ? "" : '<button data-act="recheck">re-check</button>'}
          <button data-act="reply">reply</button>
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
  $("#n-callers").textContent = callers.length;
  const nf = $("#n-flagged");
  nf.textContent = flagged.length;
  nf.dataset.hot = flagged.length ? "1" : "0";

  const list = $("#list");
  $("#privacy").hidden = filter !== "callers";

  // The callers tab lists accounts, not tokens, so it does not share the row renderer.
  if (filter === "callers") {
    if (!callers.length) {
      list.replaceChildren($(graphPaused ? "#empty-paused" : "#empty-callers").content.cloneNode(true));
      return;
    }
    list.innerHTML = callers.map(renderCallerRow).join("");
    return;
  }

  const shown = filter === "flagged" ? flagged : filter === "watch" ? watchRows : rows;

  if (!shown.length) {
    const tpl = filter === "watch" ? "#empty-watch" : filter === "flagged" && rows.length ? "#empty-clean" : "#empty-none";
    list.replaceChildren($(tpl).content.cloneNode(true));
    return;
  }
  list.innerHTML = shown.map(renderRow).join("");
}

function renderWhere() {
  const hosts = [...new Set(rows.map((e) => host(e.url)).filter(Boolean))];
  $("#where").textContent = hosts.length
    ? `this session · ${hosts.slice(0, 3).join(", ")}${hosts.length > 3 ? ` +${hosts.length - 3}` : ""}`
    : "";
}

// ---- data ----

async function load() {
  try {
    rows = (await ask({ type: "ledger:get" })) || [];
  } catch {
    rows = [];
  }
  await loadGraphTokens();
  renderWhere();
  render();
}

/**
 * Who posted the contracts currently in the ledger.
 *
 * One storage read for the whole list rather than a lookup per row: this runs on every
 * repaint of a panel that repaints whenever the worker writes, and a per-row round trip
 * would turn a scrolling timeline into a message storm.
 */
async function loadGraphTokens() {
  const addresses = rows.map((e) => e.address);
  if (!addresses.length) return void (graphTokens = {});
  try {
    graphTokens = (await ask({ type: "graph:tokens", addresses })) || {};
  } catch {
    graphTokens = {};
  }
}

async function loadCallers() {
  try {
    const [top, stats] = await Promise.all([ask({ type: "graph:top", limit: 60 }), ask({ type: "graph:stats" })]);
    callers = top || [];
    graphPaused = Boolean(stats?.paused);
    $("#graph-pause").textContent = graphPaused ? "resume" : "pause";
    $("#privacy-say").textContent = graphPaused
      ? `paused · ${stats.accounts} accounts held, never uploaded`
      : `${stats.accounts} accounts, ${stats.tokens} contracts. stays on this machine - there is no server to send it to.`;
  } catch {
    callers = [];
  }
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
    const out = await ask({ type: "verdicts", addresses: watching });
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
    // ask the worker what moved since these were last looked at, and remember the new state
    try {
      watchChanges = await ask({
        type: "watch:sync",
        verdicts: Object.fromEntries(watchRows.map((r) => [r.address, r.verdict])),
      });
    } catch {
      watchChanges = [];
    }
  } catch {
    /* leave whatever was there rather than blanking the list */
  }
}

/**
 * Follow the active tab, without throwing the list away.
 *
 * The ledger is shared across tabs, so switching tabs is not a new session - it only changes
 * which row a badge might be asking us to open. Clearing the expanded rows and the fetched
 * dossiers here, as this used to, meant walking from X to the explorer emptied the panel.
 */
async function bindTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const next = tab?.id ?? null;
  if (next === tabId) return;
  tabId = next;
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
      await ask({ type: "verdict", address, level: "full" });
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

  if (btn.dataset.act === "exit") {
    btn.disabled = true;
    btn.textContent = "simulating…";
    try {
      sweeps.set(address, await ask({ type: "exit", address }));
      render();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "simulation failed";
      btn.title = err.message;
    }
    return;
  }

  /**
   * One button for the three expensive lookups, because nobody wants two of them.
   *
   * They used to be separate: "who launched it", "how much can leave", "other chains". Three
   * buttons meant three decisions about questions a reader does not yet know the value of,
   * stacked next to three more - and the row became a toolbar. They run in sequence rather
   * than in parallel so that a rate limit stops the rest instead of spending on all three at
   * once, and each one paints as it lands.
   */
  if (btn.dataset.act === "recheck") {
    btn.disabled = true;
    btn.textContent = "re-checking…";
    try {
      await ask({ type: "mints", candidates: [address], fresh: true });
      await load();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "re-check failed";
      btn.title = err.message;
    }
    return;
  }

  if (btn.dataset.act === "deep") {
    // render() replaces the DOM, so the button has to be found again after every repaint
    const button = () => document.querySelector(`.row[data-address="${CSS.escape(address)}"] [data-act="deep"]`);
    const say = (text) => {
      const b = button();
      if (b) {
        b.disabled = true;
        b.textContent = text;
      }
    };

    say("digging…");
    const failed = [];
    for (const [label, run] of [
      ["who launched it", () => ask({ type: "deployer", address }).then((d) => dossiers.set(address, d))],
      ["how much can leave", () => ask({ type: "exit", address }).then((d) => sweeps.set(address, d))],
      ["other chains", () => ask({ type: "crosschain", address }).then((d) => elsewhere.set(address, d))],
    ]) {
      say(`${label}…`);
      try {
        await run();
      } catch (err) {
        failed.push(`${label}: ${err.message}`);
      }
      render();
    }

    const b = button();
    if (b && failed.length) {
      b.disabled = false;
      b.textContent = `${failed.length} of 3 failed`;
      b.title = failed.join("\n");
    }
    return;
  }

  if (btn.dataset.act === "xchain") {
    btn.disabled = true;
    btn.textContent = "asking every chain…";
    try {
      elsewhere.set(address, await ask({ type: "crosschain", address }));
      render();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "lookup failed";
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

  if (btn.dataset.act === "rank") {
    btn.disabled = true;
    btn.textContent = "counting holders…";
    try {
      ranks.set(address, await ask({ type: "rank", addresses: candidatesOf(entry) }));
      render();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "could not rank";
      btn.title = err.message;
    }
    return;
  }

  if (btn.dataset.act === "reply") {
    if (drafts.has(address)) drafts.delete(address);
    else drafts.set(address, { tone: "full", text: proofText(entry) });
    return render();
  }

  if (btn.dataset.act === "tone") {
    const tone = btn.dataset.tone;
    drafts.set(address, { tone, text: (TONES[tone] || proofText)(entry) });
    return render();
  }

  // The claim plus the commands that check it, as one paste. Anyone can run these; that is
  // the entire point of the format.
  if (btn.dataset.act === "copy-claim") {
    const claims = claimsFor(entry).filter((c) => validateClaim(c).ok);
    const text = claims
      .map((c) => `${JSON.stringify(c, null, 2)}\n\nHow to check it:\n${verifyPlanText(c)}`)
      .join("\n\n---\n\n");
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "copied ✓";
    } catch {
      btn.textContent = "copy blocked";
    }
    return;
  }

  if (btn.dataset.act === "copy-draft") {
    const text = drafts.get(address)?.text ?? proofText(entry);
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "copied ✓";
    } catch {
      btn.textContent = "copy blocked";
    }
    return;
  }
});

// edits to a draft are kept as typed - re-rendering must not throw away a half-written reply
$("#list").addEventListener("input", (ev) => {
  const ta = ev.target.closest('[data-act="draft"]');
  if (!ta) return;
  const address = ta.closest(".row")?.dataset.address;
  if (!address) return;
  const d = drafts.get(address);
  if (d) d.text = ta.value;
});

// paste an address and check it without leaving the panel (this was the popup's one job)
$("#check").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const input = $("#q");
  const err = $("#err");
  const address = input.value.trim();
  err.hidden = true;
  // One box, both alphabets. An 0x address and a base58 mint are never ambiguous, so asking
  // the reader to pick a chain first would be asking them for something we can see.
  const solana = !isAddress(address) && isSolanaAddress(address);
  if (!isAddress(address) && !solana) {
    err.textContent = "that is not a contract address or a Solana mint";
    err.hidden = false;
    return;
  }
  const go = $("#check button");
  go.disabled = true;
  go.textContent = "…";
  try {
    if (solana) await ask({ type: "mints", candidates: [address] });
    else await ask({ type: "verdict", address, level: "full" });
    input.value = "";
    filter = "all";
    for (const t of document.querySelectorAll(".tab")) t.classList.toggle("on", t.dataset.filter === "all");
    open.add(solana ? address : address.toLowerCase());
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
    if (filter === "callers") await loadCallers();
    render();
  });
}

// The callers tab lists accounts, so its clicks never find a .row[data-address] and the
// main list handler ignores them.
$("#list").addEventListener("click", (ev) => {
  const btn = ev.target.closest('[data-act="caller"]');
  if (!btn) return;
  const handle = btn.closest(".row")?.dataset.handle;
  if (!handle) return;
  if (openCallers.has(handle)) openCallers.delete(handle);
  else openCallers.add(handle);
  render();
});

$("#graph-pause").addEventListener("click", async () => {
  graphPaused = !graphPaused;
  await ask({ type: "graph:pause", paused: graphPaused }).catch(() => {});
  await loadCallers();
  render();
});

// Destructive and unrecoverable, so it asks - and says what it is about to destroy.
$("#graph-wipe").addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  if (btn.dataset.armed !== "1") {
    btn.dataset.armed = "1";
    btn.textContent = `forget ${callers.length} accounts?`;
    setTimeout(() => {
      btn.dataset.armed = "0";
      btn.textContent = "forget everyone";
    }, 4000);
    return;
  }
  btn.dataset.armed = "0";
  btn.textContent = "forget everyone";
  await ask({ type: "graph:wipe" }).catch(() => {});
  openCallers.clear();
  graphTokens = {};
  await loadCallers();
  render();
});

$("#theme").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("edgerun.theme", next);
  } catch {}
});

$("#clear").addEventListener("click", async () => {
  await ask({ type: "ledger:clear" }).catch(() => {});
  rows = [];
  open.clear();
  dossiers.clear();
  sweeps.clear();
  ranks.clear();
  elsewhere.clear();
  drafts.clear();
  renderWhere();
  render();
});

// The worker writes, we repaint. Falls back to the generic listener, then to polling, so a
// browser missing the per-area event still gets a live panel rather than a frozen one.
const onLedgerChange = async (changes) => {
  const hit = changes.ledger;
  if (!hit) return;
  rows = hit.newValue || [];
  await loadGraphTokens();
  renderWhere();
  if (filter !== "watch" && filter !== "callers") render();
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
await loadCallers();
render();
stats();
setInterval(stats, 30000);
