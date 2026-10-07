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
import { exampleClaim } from "../lib/example-claim.js";
import { DEFAULT_TIMEFRAME, TIMEFRAMES as CHART_TFS, candleSvg } from "../lib/candles.js";
import { ALL as ALL_CHAINS, HOME } from "../lib/chains.js";
import { bindingCheck, launchChecks } from "../lib/jupiter.js";
import { outcomeText } from "../lib/outcome.js";

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
// Green is for a full check that found nothing. A mint scan that found nothing is grey, and
// reads "mint clean": a clean mint is a fact about the mint, not a verdict on the token.
const isMintPass = (e) => e.verdict === "PASS" && e.chainName === "Solana";
const rowTone = (e) => (isMintPass(e) ? "flat" : tone(e.verdict));
const rowVerdict = (e) => (isMintPass(e) ? "MINT CLEAN" : e.verdict);
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
const markets = new Map();       // address -> what the trades say, once asked for
const charts = new Map();        // address -> { key, data, busy }: price history, per timeframe
let watchChanges = [];           // verdicts that moved since the last time they were looked at
const drafts = new Map();        // address -> the reply being composed for it
let callers = [];                // the account graph, most flagged first
let graphTokens = {};            // address -> who posted it, and whether they arrived together
let graphPaused = false;
const openCallers = new Set();   // handles expanded on the callers tab
const callerCalls = new Map();   // handle -> that account's calls, fetched when its row opens
const pricing = new Map();       // handle -> what the last "what happened after" run reported
const holdersBy = new Map();     // mint -> who holds it, read from the chain when asked
const deepBy = new Map();        // mint -> the index's deeper record of the launch

const REPO = "https://github.com/L1vsun/EDGERUN";

// Which chain a ledger row is on, for the sources that need to be told.
//
// The chart must not depend on the trades having been loaded first, so this is derived from
// the row itself: a base58 address is a Solana mint by construction, an EVM row names its
// chain when it came from a cross-chain lookup, and everything else is the chain the EVM
// contract lane reads - which is where a row with no chain attached came from.
const chainKeyOf = (e) => {
  if (isSolanaAddress(e?.address)) return "solana";
  const named = String(e?.chainName || "").toLowerCase();
  return ALL_CHAINS.find((c) => c.name.toLowerCase() === named)?.key || HOME.key;
};

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
      ${t.deployer && HOME.explorer ? `<a class="d-link" href="${esc(HOME.explorer)}/address/${esc(t.deployer)}" target="_blank" rel="noreferrer">open the wallet ↗</a>` : ""}
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
        <em>the issuer's registry</em>
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
// A ticker is not an identity: on one chain alone seven contracts use $PEPE. Ranking them by
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
      <p class="s-fine">One batched call per chain. Only a chain whose issuer publishes an
        authoritative registry can prove a fake; everywhere else a curated list is the strongest
        evidence available and absence from one is not a finding.</p>
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
  if (e.dexUrl) lines.push(`Chart: ${e.dexUrl}`);
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
        <a href="${esc(reportUrl(e))}" target="_blank" rel="noreferrer">report to the blocklist ↗</a>
      </div>
    </div>`;
}

/* ---- the chart ----
 *
 * Hand-drawn SVG, because a charting library is 200KB to draw ninety rectangles and this
 * extension has no build step and no dependencies - both of which are load-bearing, since
 * what ships is a zip somebody unpacks and can read.
 *
 * Real candlesticks, from real OHLC: GeckoTerminal's on-chain API carries them where
 * Dexscreener does not, it is keyless, and it covers every chain read here - which was the part
 * that had to be checked rather than assumed.
 *
 * Wicks are drawn from high to low and bodies from open to close, so a doji stays a doji. A
 * body that would round to nothing still gets one pixel: a candle you cannot see reads as a
 * gap in the data, and there is no gap.
 */

const price = (p) =>
  p == null ? "-" : p >= 1 ? `$${p.toFixed(2)}` : p >= 0.01 ? `$${p.toFixed(4)}` : `$${p.toPrecision(3)}`;

function renderChart(entry) {
  const state = charts.get(entry.address);
  if (!state) return "";
  const tabs = CHART_TFS.map(
    (t) => `<button data-act="tf" data-tf="${t.key}" class="${state.key === t.key ? "on" : ""}">${esc(t.label)}</button>`,
  ).join("");

  const head = `<div class="ch-tabs">${tabs}</div>`;
  const d = state.data;

  if (state.busy) return `<div class="chart">${head}<p class="ch-none">drawing…</p></div>`;
  if (d?.limited) {
    return `<div class="chart">${head}<p class="ch-none">The chart source is rate limiting us - it is free and shared. Try again in a moment; this says nothing about the token.</p></div>`;
  }
  if (!d) return `<div class="chart">${head}<p class="ch-none">The chart source did not answer. That is a fact about the source, not about this token - try again.</p></div>`;
  if (d.unsupported) {
    return `<div class="chart">${head}<p class="ch-none">No price history for ${esc(d.chain || "this chain")}: the chart source does not cover it. Every other check on this row still applies.</p></div>`;
  }
  if (d.none) {
    return `<div class="chart">${head}<p class="ch-none">No pool with price history for this token, on any pool the chart source knows. For something that traded and then stopped, that is often the whole story - but it can also just mean the pool is not indexed, so it is not being treated as a finding.</p></div>`;
  }

  const s = d.stats;
  const tf = CHART_TFS.find((t) => t.key === state.key);
  const dir = s.changePct > 0 ? "up" : s.changePct < 0 ? "down" : "";

  // The reason this block can be louder than the verdict above it. A contract that passes
  // every check can still sit on a pool that is down 99% with nobody left in it - both true
  // at once, and a bare PASS next to a chart like that is the thing that reads as broken.
  const flags = d.flags || [];
  const rug = flags.some((f) => f.id === "collapsed");
  const findings = flags.length
    ? `<div class="ch-flags">
         ${rug ? '<p class="ch-lede">The contract checks above and this chart are both right. A rug does not need a malicious contract - usually somebody just sold all of it.</p>' : ""}
         ${flags.map((f) => `<div class="check"><i class="warn"></i><span><b>${esc(f.id.replace(/_/g, " "))}</b><br />${esc(f.detail)}</span></div>`).join("")}
       </div>`
    : "";

  return `
    <div class="chart${rug ? " rug" : ""}">
      ${head}
      <div class="ch-head">
        <b>${esc(price(s.close))}</b>
        <span class="ch-chg ${dir}">${s.changePct == null ? "" : `${s.changePct > 0 ? "+" : ""}${s.changePct.toFixed(1)}%`}</span>
        <em>${esc(tf?.span || "")} · ${s.bars} bars</em>
      </div>
      ${candleSvg(d.candles)}
      <div class="ch-foot"><span>low ${esc(price(s.low))}</span><span>high ${esc(price(s.high))}</span><span class="ch-log">log</span></div>
      ${findings}
    </div>`;
}

/* ---- what the trades say ----
 *
 * A second witness, and a different kind of one. Every other block in this row asks the
 * contract a question; this one asks the market, and the interesting case is when the two
 * disagree: clean bytecode on a pool where four hundred people bought and three sold is
 * telling you something the code did not.
 *
 * Not a price readout. The price is the least useful number here and Dexscreener is one tap
 * away for it. What earns the space is the shape of the flow across the windows the API
 * actually carries - and there are no candles in that API, so there is no chart here
 * pretending otherwise.
 */

const fmtUsd = (n) =>
  n == null ? "-" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;

function renderMarket(m) {
  if (!m) return '<div class="market"><p class="m-none">Dexscreener did not answer. Nothing follows from that about the token.</p></div>';
  if (m.none) {
    return '<div class="market"><p class="m-none">No pool for this token on Dexscreener. That is not the same as no pool existing - it may simply not be indexed - but a token being pushed hard with nowhere to trade it is worth noticing.</p></div>';
  }

  const rows = m.windows
    .map((w) => {
      const flow = w.buys == null && w.sells == null ? "-" : `${w.buys ?? 0}/${w.sells ?? 0}`;
      // the bar is buys as a share of all trades in the window: half and half sits centred
      const total = (w.buys || 0) + (w.sells || 0);
      const pct = total ? Math.round(((w.buys || 0) / total) * 100) : 50;
      const chg = w.change == null ? "" : `${w.change > 0 ? "+" : ""}${w.change}%`;
      return `<tr>
        <td class="m-w">${esc(w.label)}</td>
        <td>${w.volume == null ? "-" : fmtUsd(w.volume)}</td>
        <td class="${w.change > 0 ? "up" : w.change < 0 ? "down" : ""}">${esc(chg)}</td>
        <td class="m-flow">${esc(flow)}</td>
        <td class="m-bar"><i style="width:${total ? pct : 0}%"></i></td>
      </tr>`;
    })
    .join("");

  const flags = m.flags
    .map((f) => `<div class="check"><i class="warn"></i><span><b>${esc(f.id.replace(/_/g, " "))}</b><br />${esc(f.detail)}</span></div>`)
    .join("");

  const age = m.createdAt ? `${Math.max(1, Math.round((Date.now() - m.createdAt) / 86400000))}d old` : "";

  // What somebody has bought on the token's Dexscreener page. Stated, never scored: a paid
  // profile says a person spent money, not who, and a rug costs the same to dress as a project.
  // Positives only - the source has been seen to list an order and later return nothing for
  // the same token, so an empty answer is not allowed to become "no paid profile".
  const day = (ts) => new Date(ts).toISOString().slice(0, 10);
  const p = m.paid;
  const bought = !p
    ? ""
    : [
        p.profileAt ? `profile paid for on ${day(p.profileAt)}` : "",
        p.takeoverAt ? `community takeover filed ${day(p.takeoverAt)}` : "",
        p.ads ? `${p.ads} advert${p.ads === 1 ? "" : "s"} bought` : "",
        p.boosts ? `${p.boosts} boost${p.boosts === 1 ? "" : "s"} active` : "",
      ].filter(Boolean).join(" · ");

  return `
    <div class="market">
      <div class="m-head">
        <span class="m-label">the trades</span>
        <span>${esc(m.symbol || "")}/${esc(m.quote || "")} on ${esc(m.dex || "?")}${m.chain ? ` · ${esc(m.chain)}` : ""}</span>
        <em>${fmtUsd(m.liquidityUsd)} liquidity${age ? ` · ${esc(age)}` : ""}</em>
      </div>
      <table class="m-tbl">
        <thead><tr><th></th><th>volume</th><th>change</th><th>buys/sells</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${flags || ""}
      ${bought ? `<p class="m-paid"><b>Dexscreener</b> ${esc(bought)}</p>` : ""}
      <p class="m-note">Buy and sell counts, not price history - the public API carries no candles. A one-sided tape is the shape a token has when holders cannot get out, which is the exit test's question asked of the money instead of the code.</p>
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
  const list = callerCalls.get(c.handle);
  const calls = (list || [])
    .slice(0, 40)
    .map((x) => {
      const after = outcomeText(x.out);
      const down = Number.isFinite(x.out?.pct) && x.out.pct <= -50;
      const link = x.post ? ` · <a href="https://x.com/${esc(c.handle)}/status/${esc(x.post)}" target="_blank" rel="noreferrer">the post ↗</a>` : "";
      return `<div class="check"><i class="${esc(tone(x.verdict))}"></i><span>
        <b>${esc(x.symbol || short(x.address))}${x.own ? ' <em class="own" title="this token\'s own metadata names this account as its X account">its own account</em>' : ""}</b>
        <span>${esc(x.verdict)} · ${esc(ago(x.posted || x.last || x.at))}${x.n > 1 ? ` · ${x.n}×` : ""}${link}</span>
        ${after ? `<span class="after ${down ? "down" : ""}">${esc(after)}</span>` : ""}
      </span></div>`;
    })
    .join("");

  // The price half of the record. It is asked for, never automatic - each call priced is a
  // request against the tightest limit in the product - and it describes rather than judges:
  // an account warning about a contract has posted it too, and its price falling afterwards
  // is them being right.
  const o = c.outcomes;
  const run = pricing.get(c.handle);
  const summary = o
    ? `<p class="c-after">${esc(c.outcomeSay || `${o.priced} call${o.priced === 1 ? "" : "s"} priced so far - too few for a pattern.`)}</p>`
    : "";
  const note = run
    ? `<p class="c-run">${esc(
        run.error
          ? "The price source could not be reached. Nothing follows from that about these tokens."
          : run.limited
            ? `Priced ${run.priced}. The price source limits how often it can be asked - try the rest in a minute.`
            : run.asked === 0
              ? "Every recent call is already priced."
              : `Priced ${run.priced} of ${run.asked}.${run.left ? ` ${run.left} more to go.` : ""}`,
      )}</p>`
    : "";
  const owned = c.owned
    ? `<p class="c-run">${c.owned} of these tokens name${c.owned === 1 ? "s" : ""} this account as ${c.owned === 1 ? "its" : "their"} own X account.</p>`
    : "";

  return `
    <article class="row ${c.tone === "bad" ? "fail" : c.tone === "mixed" ? "warn" : "flat"}" data-handle="${esc(c.handle)}">
      <button class="head" data-act="caller" aria-expanded="${expanded}">
        <span class="sym">@${esc(c.handle)}</span>
        <span class="verdict ${c.tone === "bad" ? "fail" : c.tone === "mixed" ? "warn" : "flat"}">${c.flagged}/${c.tokens}</span>
        <span class="say">${esc(c.say)}</span>
        <span class="meta">${esc(c.display || "")}${c.display ? " · " : ""}last ${esc(ago(c.last))}</span>
      </button>
      <div class="detail" ${expanded ? "" : "hidden"}>
        ${summary}
        ${owned}
        ${calls || `<div class="check"><i></i><span><span>${list ? "no contracts recorded" : "reading the record…"}</span></span></div>`}
        ${note}
        <div class="acts">
          ${c.tokens ? `<button class="go-act" data-act="after">${o ? "price more calls" : "what happened after"}</button>` : ""}
          <a href="https://x.com/${esc(c.handle)}" target="_blank" rel="noreferrer">open profile ↗</a>
        </div>
      </div>
    </article>`;
}

// ---- who holds it ----
//
// The twenty largest accounts, read from the chain: who owns each, whether a program rather
// than a person controls that owner, and whether the account is frozen. Pools and curves are
// drawn as what they are, because counting them as holders is how every launch becomes "one
// wallet owns 80%".

function renderHolders(h) {
  if (!h) return "";
  const head = '<div class="d-head"><span class="d-label">who holds it</span></div>';
  if (h.status !== "read") {
    const why = {
      limited: "The endpoint that lists holders limits how often it can be asked. Try again in a moment - nothing follows from that about the token.",
      none: "The chain lists no holder accounts for this mint.",
      unreachable: "The holder list could not be read. Nothing follows from that about the token.",
    }[h.status] || "The holder list could not be read.";
    return `<div class="dossier">${head}<p class="d-none">${esc(why)}</p></div>`;
  }
  const rows = h.rows.slice(0, 10).map((r) => {
    const who = r.kind === "program" ? "a program's account" : r.kind === "unknown" ? "owner not read" : esc(short(r.owner));
    return `<tr class="${r.frozen ? "hot" : ""}"><td>${who}${r.frozen ? " · frozen" : ""}</td><td>${r.pct >= 10 ? r.pct.toFixed(1) : r.pct.toFixed(2)}%</td></tr>`;
  }).join("");
  const checks = (h.checks || []).map((c) => `<div class="check"><i class="${esc(c.status === "unresolved" ? "" : c.status)}"></i>
    <span><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></span></div>`).join("");
  return `
    <div class="dossier">
      ${head}
      ${checks}
      <table class="d-methods"><tbody>${rows}</tbody></table>
      <p class="d-note">Read from the chain: the ${h.listed} largest token accounts, who owns each, and which program controls the owner.</p>
    </div>`;
}

function renderDeep(d) {
  if (!d) return "";
  const head = '<div class="d-head"><span class="d-label">the launch, closer</span></div>';
  if (!d.checks?.length) {
    return `<div class="dossier">${head}<p class="d-none">Nothing more is recorded for this mint, or the record did not answer. Nothing follows from that about the token.</p></div>`;
  }
  return `
    <div class="dossier">
      ${head}
      ${d.checks.map((c) => `<div class="check"><i class="${esc(c.status === "unresolved" ? "" : c.status)}"></i>
        <span><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></span></div>`).join("")}
      <p class="d-note">From the data behind Jupiter's own token pages - its counts and its classifications, none of it read from the chain here.</p>
    </div>`;
}

// ---- the launch ----
//
// A Solana mint's verdict comes from the mint account. Everything else a reader asks first -
// where it launched, how long ago, how widely it is held, whose wallet made it - comes from
// an index, and is drawn here as its own block so it can never be mistaken for a check. It
// costs nothing to show: the context arrived with the scan.
//
// The last line is the only one that is not the index's. A token names an X account by
// writing a link into its own metadata, and the test of that link is whether the account has
// ever posted the contract - which this panel knows, because it kept the feed.

function renderLaunch(e) {
  const ctx = e.context;
  if (!ctx) return "";
  const callers = graphTokens[String(e.address).toLowerCase()]?.callers || [];
  const posted = Boolean(ctx.x?.handle) && callers.some((c) => c.handle === ctx.x.handle);
  const rows = [...launchChecks(ctx), bindingCheck(ctx.x, posted)].filter(Boolean);
  if (!rows.length) return "";
  return `
    <div class="dossier">
      <div class="d-head"><span class="d-label">the launch</span></div>
      ${rows.map((c) => `<div class="check"><i class="${esc(c.status === "unresolved" ? "" : c.status)}"></i>
        <span><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></span></div>`).join("")}
      <p class="d-note">From Jupiter's index, not read from the chain - except the X account line, which is checked against your own feed.</p>
    </div>`;
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
  const t = rowTone(e);
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
  const market = markets.has(e.address) ? renderMarket(markets.get(e.address)) : "";
  const chart = charts.has(e.address) ? renderChart(e) : "";
  const moved = watchChanges.find((c) => c.address === e.address);
  // The graph keys by the FOLDED address, and a Solana row carries its real casing - looked
  // up as written, a mint never found its callers and no cluster ever showed on a Solana row.
  const graphFor = graphTokens[String(e.address).toLowerCase()];
  const cluster = graphFor?.cluster;
  const deep = dossier || sweep || xchain;
  const evm = isEvmRow(e);

  return `
    <article class="row ${t}${e.address === focusAddress ? " focus" : ""}" data-address="${esc(e.address)}">
      <button class="head" data-act="toggle" aria-expanded="${expanded}">
        <span class="who-what">
          <span class="sym">${esc(e.symbol || short(e.address))}</span>
          <span class="chain">${esc(e.chainName || HOME.name)}</span>
        </span>
        <span class="verdict ${t}">${esc(rowVerdict(e))}</span>
        <span class="say">${esc(e.say)}</span>
        ${moved ? `<span class="moved">was ${esc(moved.from)} &rarr; now ${esc(moved.to)}</span>` : ""}
        ${cluster ? `<span class="moved">${cluster.count} accounts, ${esc(mins(cluster.spanMs))}</span>` : ""}
        <span class="meta">${esc(ago(e.at))}${where ? ` · ${esc(where)}` : ""}${
          e.seen > 1 ? ` · seen ${e.seen}×` : ""
        }${e.level === "identity" ? " · identity only" : ""}</span>
      </button>
      <div class="detail" ${expanded ? "" : "hidden"}>
        ${renderClaim(e)}
        ${renderCluster(graphFor)}
        ${shown || '<div class="check"><i></i><span><span>nothing established yet</span></span></div>'}
        ${folded}
        ${rank}
        ${dossier}
        ${evm ? "" : renderLaunch(e)}
        ${evm ? "" : renderHolders(holdersBy.get(e.address))}
        ${evm ? "" : renderDeep(deepBy.get(e.address))}
        ${sweep}
        ${xchain}
        ${chart}
        ${market}
        ${renderComposer(e)}
        <div class="addr">${esc(e.address)}</div>
        <div class="acts">
          ${evm && e.level !== "full" && e.verdict !== "FAIL" ? '<button class="go-act" data-act="full">run full check</button>' : ""}
          ${evm && !deep ? '<button class="go-act" data-act="deep">dig deeper</button>' : ""}
          ${evm && !rank && candidatesOf(e).length ? '<button data-act="rank">which is real</button>' : ""}
          ${!evm && !(holdersBy.has(e.address) && deepBy.has(e.address)) ? '<button class="go-act" data-act="sol-deep">dig deeper</button>' : ""}
          ${evm ? "" : '<button data-act="recheck">re-check</button>'}
          ${market ? "" : '<button data-act="market">the trades</button>'}
          ${chart ? "" : '<button data-act="chart">chart</button>'}
          <button data-act="reply">reply</button>
          ${claimsFor(e).some((c) => validateClaim(c).ok) ? '<button data-act="copy-claim">copy claim</button>' : ""}
          <button data-act="watch">${watched ? "unwatch" : "watch"}</button>
          ${e.explorerUrl ? `<a href="${esc(e.explorerUrl)}" target="_blank" rel="noreferrer">explorer ↗</a>` : ""}
          ${e.dexUrl ? `<a href="${esc(e.dexUrl)}" target="_blank" rel="noreferrer">chart ↗</a>` : ""}
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
  maybeIntro();
  $("#privacy").hidden = filter !== "callers";
  $("#claimcheck").hidden = filter !== "claims";

  // The claims tab is not a list of anything this session found - it is a box you put
  // somebody else's accusation into - so it owns the whole panel body and the ledger
  // renderer sits this one out.
  if (filter === "claims") {
    list.replaceChildren();
    return;
  }

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
  // Opening straight onto the callers tab (a click on an account strip in the feed) needs the
  // account list fetched before the first paint, or the tab renders empty and then fills.
  if (filter === "callers") {
    await loadCallers();
    for (const handle of openCallers) if (!callerCalls.has(handle)) loadCalls(handle);
  }
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
    // Two providers, so two questions. A watched Solana mint used to be sent to the EVM
    // batch, which drops anything that is not 0x - so it was never re-checked and never shown.
    const evm = watching.filter(isAddress);
    const sol = watching.filter((a) => !isAddress(a) && isSolanaAddress(a));
    const [out, mints] = await Promise.all([
      evm.length ? ask({ type: "verdicts", addresses: evm }) : {},
      sol.length ? ask({ type: "mints", candidates: sol, limit: "watch" }) : [],
    ]);
    const byMint = new Map((mints || []).map((r) => [r.address, r]));
    watchRows = watching
      .map((a) => out[a] || byMint.get(a))
      .filter(Boolean)
      .map((r) => ({
        address: isAddress(r.address) ? r.address.toLowerCase() : r.address,
        symbol: r.symbol || null,
        chainName: r.chainName || null,
        verdict: r.verdict,
        level: r.level,
        say:
          (r.checks || []).find((c) => c.status === "fail")?.detail ||
          (r.checks || []).find((c) => c.status === "warn")?.detail ||
          (r.verdict === "OFFICIAL" ? "in the issuer's published registry" : "no failing check"),
        checks: r.checks || [],
        context: r.context || null,
        explorerUrl: r.explorerUrl || null,
        dexUrl: r.dexUrl || null,
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
      // An account strip was clicked rather than a badge: the answer is on the callers tab,
      // so open there with that record already expanded instead of on the ledger.
      if (hit.handle) {
        filter = "callers";
        openCallers.add(hit.handle);
        for (const t of document.querySelectorAll(".tab")) t.classList.toggle("on", t.dataset.filter === "callers");
        return;
      }
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
  // The Solana "dig deeper": who holds it (read from the chain) and the index's closer look
  // at the launch. In sequence, each painting as it lands, for the same reason the EVM one
  // does: a limit on the first should not be spent on by the second.
  if (btn.dataset.act === "sol-deep") {
    btn.disabled = true;
    btn.textContent = "reading holders…";
    const vouched = (entry.checks || []).some((c) => c.id === "listed" && c.status === "ok");
    try {
      holdersBy.set(address, await ask({ type: "holders", address, vouched }));
    } catch {
      holdersBy.set(address, { status: "unreachable" });
    }
    open.add(address);
    render();
    try {
      deepBy.set(address, await ask({ type: "deep", address }));
    } catch {
      deepBy.set(address, { checks: [] });
    }
    return render();
  }

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

  // The chart, and switching its timeframe. Both go through one loader so a tab click and a
  // first open behave identically - and the pool address from the market read is passed
  // through when we have it, which saves a call against a tight free rate limit.
  if (btn.dataset.act === "chart" || btn.dataset.act === "tf") {
    const key = btn.dataset.act === "tf" ? btn.dataset.tf : charts.get(address)?.key || DEFAULT_TIMEFRAME;
    const market = markets.get(address);
    charts.set(address, { key, data: charts.get(address)?.data || null, busy: true });
    open.add(address);
    render();
    let data = null;
    try {
      data = await ask({
        type: "candles:get",
        address,
        chain: market && !market.none ? market.chain : chainKeyOf(entry),
        pool: market && !market.none ? market.pairAddress : undefined,
        key,
      });
    } catch {
      data = null;
    }
    charts.set(address, { key, data, busy: false });
    return render();
  }

  if (btn.dataset.act === "market") {
    btn.disabled = true;
    btn.textContent = "reading…";
    try {
      // null is a real answer here (the source was unreachable) and renderMarket says so,
      // so it is stored rather than treated as a failure to retry.
      markets.set(address, await ask({ type: "market:get", address }));
    } catch {
      markets.set(address, null);
    }
    open.add(address);
    return render();
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
      // The worker answers { trail, checks }. Storing the whole envelope where the renderer
      // expects the trail is what put "undefined contracts launched" on screen.
      ["who launched it", () => ask({ type: "deployer", address }).then(({ trail, checks }) => {
        dossiers.set(address, trail);
        entry.checks = [
          ...(entry.checks || []).filter(
            (c) => !String(c.id).startsWith("deployer") && c.id !== "production_line" && c.id !== "explorer_scam",
          ),
          ...checks,
        ];
      })],
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

/* ---- checking somebody else's claim ----
 *
 * The one place in this panel where the subject is not something this browser found. A claim
 * arrives from outside, and the answer comes from the endpoints the claim itself names -
 * never from the reporter, and never from us. A reader ends up believing the chain or not
 * believing it, which is the only kind of belief this format was built to produce.
 */

const CLAIM_TONE = { reproduced: "ok", contradicted: "fail", partial: "warn", unproven: "" };

function renderClaimCheck(entry) {
  const { claim, valid, errors, result } = entry;
  const head = `${esc(claim.type || "claim")}${claim.subject?.address ? ` · ${esc(String(claim.subject.address).slice(0, 12))}…` : ""}`;

  if (!valid) {
    // Not "we could not read it" - a specific, quotable reason it is not checkable. Somebody
    // is spreading this accusation, and "it carries no evidence anyone can run" is the most
    // useful thing that can be said about it.
    return `<article class="row fail">
      <div class="head"><div class="who-what"><span class="sym">${head}</span></div>
      <span class="verdict fail">not checkable</span>
      <span class="say">${esc(claim.says || "")}</span></div>
      <div class="detail">${errors.map((e) => `<div class="check"><i class="fail"></i><span>${esc(e)}</span></div>`).join("")}</div>
    </article>`;
  }

  const tone = CLAIM_TONE[result.verdict] || "";
  const rows = result.checks
    .map((c) => {
      const dot = c.status === "reproduced" ? "ok" : c.status === "contradicted" ? "fail" : "unresolved";
      const got = c.got ? ` <b>got:</b> ${esc(String(c.got).slice(0, 120))}` : "";
      const weak = c.weak ? " (found in the document, not selected from a field - weaker)" : "";
      const why = c.why ? ` - ${esc(c.why)}` : "";
      return `<div class="check"><i class="${dot}"></i><span>
        <b>${esc(c.status)}</b>${esc(weak)}${why}<br />${esc(c.means || c.expect || "")}${got}
      </span></div>`;
    })
    .join("");

  return `<article class="row ${tone}">
    <div class="head"><div class="who-what"><span class="sym">${head}</span></div>
    <span class="verdict ${tone}">${esc(result.verdict)}</span>
    <span class="say">${esc(sayClaimResult(result))}</span></div>
    <div class="detail">${rows}</div>
  </article>`;
}

// Kept here rather than imported so the panel says it in the panel's voice, and so a change
// of wording never has to travel through the worker.
function sayClaimResult(r) {
  if (r.verdict === "contradicted") return `Does not hold: ${r.contradicted} check(s) came back different from what it says.`;
  if (r.verdict === "reproduced") return `Reproduced here, ${r.reproduced} of ${r.reproduced} checks, without trusting the reporter.`;
  if (r.verdict === "partial") {
    const rest = [r.unreachable ? `${r.unreachable} unreachable` : null, r.manual ? `${r.manual} to read by hand` : null].filter(Boolean).join(", ");
    return `${r.reproduced} reproduced; ${rest}.`;
  }
  if (r.unreachable) return "Could not be reached. That is not evidence against it.";
  return "Nothing here can be checked automatically; the evidence is written for a human.";
}

$("#claim-run").addEventListener("click", async () => {
  const text = $("#claim-in").value.trim();
  const out = $("#claim-out");
  if (!text) return void (out.innerHTML = "");
  out.innerHTML = '<div class="empty"><b>running it…</b><span>against the endpoints the claim names</span></div>';
  let data;
  try {
    data = await ask({ type: "claim:check", text });
  } catch (err) {
    out.innerHTML = `<div class="empty"><b>could not run it</b><span>${esc(String(err?.message || err))}</span></div>`;
    return;
  }
  if (!data?.claims?.length) {
    out.innerHTML = '<div class="empty"><b>no claim found in that</b><span>A claim is a JSON object with a type and a list of evidence. Paste the whole message if you are not sure which part it is.</span></div>';
    return;
  }
  out.innerHTML = data.claims.map(renderClaimCheck).join("");
});

// The tab is useless until somebody sends you a claim, and on a fresh install nobody has.
// This loads a real one - the project's own blocklist entry, rewritten in the format - so the
// whole loop is one click away instead of waiting on a stranger.
$("#claim-example").addEventListener("click", () => {
  $("#claim-in").value = JSON.stringify(exampleClaim(), null, 2);
  $("#claim-out").innerHTML = "";
  $("#claim-in").scrollTop = 0;
});

$("#claim-clear").addEventListener("click", () => {
  $("#claim-in").value = "";
  $("#claim-out").innerHTML = "";
});

/* ---- first run ----
 *
 * The panel opens empty, and empty reads as broken rather than new. It also hides the two
 * things here that a scanner cannot do - the account record and checking somebody else's
 * claim - because both are invisible until you know they exist.
 *
 * Shown once, dismissed for good, and never again after any real activity: somebody who
 * already has a ledger does not need to be told what this is.
 */
const INTRO_KEY = "edgerun.intro";

function introDone() {
  try {
    localStorage.setItem(INTRO_KEY, "done");
  } catch {
    /* private window: it will show again, which is better than not showing */
  }
  $("#intro").hidden = true;
}

function maybeIntro() {
  let seen = false;
  try {
    seen = localStorage.getItem(INTRO_KEY) === "done";
  } catch {
    seen = false;
  }
  // A ledger with anything in it means they are already using it, so the introduction is
  // noise - and it quietly marks itself done so it never appears later either.
  if (seen || rows.length || callers.length) {
    if (!seen && (rows.length || callers.length)) introDone();
    $("#intro").hidden = true;
    return;
  }
  $("#intro").hidden = filter !== "all";
}

$("#intro-x").addEventListener("click", introDone);
$("#intro-claims").addEventListener("click", () => {
  introDone();
  filter = "claims";
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("on", t.dataset.filter === "claims");
  render();
  $("#claim-in").value = JSON.stringify(exampleClaim(), null, 2);
  $("#claim-out").innerHTML = "";
  $("#claim-run").click();
});

// The callers tab lists accounts, so its clicks never find a .row[data-address] and the
// main list handler ignores them.
$("#list").addEventListener("click", async (ev) => {
  const row = ev.target.closest(".row[data-handle]");
  const handle = row?.dataset.handle;
  if (!handle) return;

  // What the price did after each of this account's calls.
  const after = ev.target.closest('[data-act="after"]');
  if (after) {
    after.disabled = true;
    after.textContent = "pricing…";
    try {
      const rec = await ask({ type: "graph:outcomes", handle });
      if (rec) {
        callerCalls.set(handle, rec.calls || []);
        pricing.set(handle, rec.run || null);
        callers = callers.map((c) => (c.handle === handle ? { ...c, ...rec, calls: undefined, run: undefined } : c));
      }
    } catch {
      pricing.set(handle, { error: true });
    }
    return render();
  }

  if (!ev.target.closest('[data-act="caller"]')) return;
  if (openCallers.has(handle)) openCallers.delete(handle);
  else openCallers.add(handle);
  render();
  // The list of accounts carries counts, not calls - eighty call objects per account across
  // the message boundary to draw one line each would be waste. So the calls are fetched when
  // a row is opened. (They were never fetched at all before, and every opened account read
  // "no contracts recorded" beside a count that said otherwise.)
  if (openCallers.has(handle) && !callerCalls.has(handle)) await loadCalls(handle);
});

async function loadCalls(handle) {
  try {
    const rec = await ask({ type: "graph:caller", handle });
    callerCalls.set(handle, rec?.calls || []);
  } catch {
    callerCalls.set(handle, []);
  }
  render();
}

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
  callerCalls.clear();
  pricing.clear();
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
