// Who put that contract in front of you.
//
// The extension is the only witness to your own timeline. Every contract it has ever checked,
// it checked because a specific account posted it - and until now that half was thrown away:
// `sites/twitter.js` read the post text out of the article and dropped the author standing
// next to it.
//
// Keeping it turns a stream of one-off token checks into a record of people. Not "is this
// contract real" but "this account has pushed 47 contracts into my feed in three weeks and
// nine of them failed", and "this address arrived from six accounts inside eleven minutes,
// which is not six people noticing the same thing".
//
// Neither question can be answered by a server that was not there. A scanner sees a contract;
// only the browser scrolling the feed sees who was holding it.
//
// LOCAL ONLY. This never leaves the machine and there is nowhere for it to go - the extension
// has no backend. It is wiped whole by one button in the panel, and `paused` stops recording
// without destroying what is already there.
//
// A ticker mention is recorded but is NEVER A CALL. "$TSLA earnings tomorrow" is not somebody
// putting a contract in front of you, and letting it feed the numbers that can mark an account
// would turn every finance account on the timeline into a caller. So mentions sit in their own
// field, `calls` and `flagged` never see them, and nothing that can accuse anybody reads them.
// They are there because a page of real timeline is mostly tickers, and an account that talks
// about them all day and never posts a contract is a known quantity rather than an empty file.

import { readOutcome, sayOutcomes, summarizeOutcomes } from "./outcome.js";
import { spend } from "./budget.js";

const ACCT = "acct:";
const CA = "ca:";
const SETTINGS = "graph:settings";

// A post remounts every time it scrolls back into view and a profile can be reopened all day.
// Re-seeing the same account on the same contract inside this window is the same sighting.
const DEDUPE_MS = 10 * 60 * 1000;

// What a coordinated push looks like: several distinct accounts, one contract, one window.
// Three is the floor where "two people saw the same thing" stops being the simpler story.
export const CLUSTER_WINDOW_MS = 60 * 60 * 1000;
export const CLUSTER_MIN = 3;

const MAX_ACCOUNTS = 1500;
const CALLS_PER_ACCOUNT = 80;
const CALLERS_PER_TOKEN = 40;

const acctKey = (h) => ACCT + String(h).toLowerCase();
const caKey = (a) => CA + String(a).toLowerCase();

// The KEY is folded so one contract is one record however it was written. The stored ADDRESS
// is not, unless it is hex: a Solana mint is base58 and lowercasing it produces a string that
// is not the address. This file folded everything until 2026-10-07, which was invisible while
// the record was only ever counted and became a bug the moment something needed to look a
// recorded mint up again - pricing a call, or matching a panel row to its callers.
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const keep = (a) => (/^0x[0-9a-fA-F]{40}$/.test(String(a)) ? String(a).toLowerCase() : String(a));

// A post's own timestamp, when the page gave one that can be believed.
const postTime = (s, now) => {
  const t = Number(s?.postedAt);
  return Number.isFinite(t) && t > 1_142_000_000_000 && t <= now + 60_000 ? t : null;
};

const FLAGGED = new Set(["FAIL", "CAUTION"]);

// ---- settings ----

export async function graphSettings() {
  try {
    const got = await chrome.storage.local.get(SETTINGS);
    return { paused: false, ...(got[SETTINGS] || {}) };
  } catch {
    return { paused: false };
  }
}

export async function setPaused(paused) {
  const next = { paused: !!paused };
  try {
    await chrome.storage.local.set({ [SETTINGS]: next });
  } catch {}
  return next;
}

// ---- recording ----

/**
 * Fold a batch of sightings into the graph in one read and one write.
 *
 * The batch matters: a scroll can surface eight posts at once, and calling this once per
 * post would race every other call on the same account key - the same read-modify-write
 * problem `ledger.recordMany` exists to avoid.
 *
 * `sightings` is [{ handle, display, address, symbol, verdict }]. Anything without both a
 * handle and an address is dropped rather than half-recorded.
 */
// One writer at a time, for the reason lib/ledger.js gives: two batches off the same scroll
// touching the same account would each read it, add their own call, and write it back - and
// the account would keep one of the two.
let tail = Promise.resolve();
const serial = (fn) => {
  const run = tail.then(fn, fn);
  tail = run.catch(() => {});
  return run;
};

export function recordSightings(sightings, now = Date.now()) {
  return serial(() => recordSightingsNow(sightings, now));
}

async function recordSightingsNow(sightings, now) {
  const clean = (sightings || []).filter((s) => s?.handle && (s?.address || s?.ticker));
  if (!clean.length) return { recorded: 0 };
  if ((await graphSettings()).paused) return { recorded: 0, paused: true };

  const keys = [...new Set(clean.flatMap((s) => (s.address ? [acctKey(s.handle), caKey(s.address)] : [acctKey(s.handle)])))];
  let store = {};
  try {
    store = await chrome.storage.local.get(keys);
  } catch {
    return { recorded: 0 }; // storage blocked: the feature does not exist for this user
  }

  const next = {};
  const read = (k) => next[k] || store[k] || null;
  let recorded = 0;

  for (const s of clean) {
    const handle = String(s.handle).toLowerCase();

    /*
     * A ticker mention is recorded, and it is NOT a call.
     *
     * "A ticker mention is never a sighting" was right about the thing it was protecting and
     * wrong about throwing the information away. Reported from the field 2026-09-28: a whole
     * page of a real timeline, plenty of tickers, not one contract address - so the graph
     * recorded nothing at all and the scan reported reading 87 posts and finding nothing.
     *
     * The rule that mattered was never "ignore tickers". It was that a ticker must not feed a
     * number that can accuse somebody, because $TSLA in a post about earnings is not a call
     * and counting it turns every finance account on the timeline into a caller. So mentions
     * live in their own field, they never touch `calls` or `flagged`, and nothing that can
     * put a mark on an account reads them. They describe; they do not charge.
     */
    if (!s.address && s.ticker) {
      const ak = acctKey(handle);
      const acct = read(ak) || { handle, display: null, first: now, last: now, seen: 0, calls: [] };
      if (s.display) acct.display = s.display;
      acct.mentions = (acct.mentions || 0) + 1;
      acct.tickers = acct.tickers || {};
      const t = String(s.ticker).toUpperCase().slice(0, 12);
      acct.tickers[t] = (acct.tickers[t] || 0) + 1;
      // a handful of the most-used, so one account cannot grow an unbounded map
      const kept = Object.entries(acct.tickers).sort((a, b) => b[1] - a[1]).slice(0, 12);
      acct.tickers = Object.fromEntries(kept);
      acct.last = now;
      next[ak] = acct;
      continue;
    }
    if (!s.address) continue;

    const address = keep(s.address);
    const posted = postTime(s, now);

    const ak = acctKey(handle);
    const acct = read(ak) || { handle, display: null, first: now, last: now, seen: 0, calls: [] };
    if (s.display) acct.display = s.display;

    const prior = acct.calls.find((c) => same(c.address, address));
    if (prior) {
      // Filled in even inside the dedupe window, because they are facts about the call and
      // not a second sighting of it: a record written before these existed heals the first
      // time its post is seen again.
      prior.address = address; // an old lowercased mint gets its real casing back
      // the EARLIEST post is the call - a repost a week later is not when they called it
      if (posted && (!prior.posted || posted < prior.posted)) {
        prior.posted = posted;
        if (s.post) prior.post = String(s.post);
      }
      if (s.chain && !prior.chain) prior.chain = s.chain;
      if (s.own) prior.own = true;
    }
    if (prior && now - (prior.last || prior.at) < DEDUPE_MS) {
      acct.last = now;
      next[ak] = acct;
      continue; // the same post scrolled back into view, not a second call
    }

    recorded += 1;
    acct.last = now;
    acct.seen = (acct.seen || 0) + 1;
    if (prior) {
      prior.last = now;
      prior.n = (prior.n || 1) + 1;
      // the verdict at the latest sighting is the one worth keeping: a token that has since
      // turned is exactly what the record is for
      if (s.verdict) prior.verdict = s.verdict;
      if (s.symbol) prior.symbol = s.symbol;
    } else {
      acct.calls.push({
        address,
        symbol: s.symbol || null,
        verdict: s.verdict || "UNRESOLVED",
        at: now,
        last: now,
        n: 1,
        // when the post was WRITTEN, which is not when it was seen: a profile read today
        // surfaces posts from last month, and "what happened after" is measured from then
        ...(posted ? { posted } : {}),
        ...(s.post ? { post: String(s.post) } : {}),
        ...(s.chain ? { chain: s.chain } : {}),
        // the token's own metadata names this account as its X account
        ...(s.own ? { own: true } : {}),
      });
      // oldest calls fall off first - a caller's recent record is the one being asked about
      if (acct.calls.length > CALLS_PER_ACCOUNT) {
        acct.calls.sort((a, b) => (a.last || a.at) - (b.last || b.at));
        acct.calls = acct.calls.slice(-CALLS_PER_ACCOUNT);
      }
    }
    next[ak] = acct;

    const ck = caKey(address);
    const token = read(ck) || { address, first: now, callers: [] };
    token.address = address;
    // `at` is when they POSTED it, when the page said. Coordination is a claim about when
    // accounts acted, and the time a reader happened to scroll past is not that: reading
    // three profiles in one sitting used to make three posts written weeks apart look like
    // three accounts arriving inside the same hour.
    const mine = token.callers.find((c) => c.handle === handle);
    if (!mine) {
      token.callers.push({ handle, at: posted || now });
      if (token.callers.length > CALLERS_PER_TOKEN) token.callers = token.callers.slice(-CALLERS_PER_TOKEN);
    } else if (posted && posted < mine.at) {
      mine.at = posted;
    }
    next[ck] = token;
  }

  try {
    await chrome.storage.local.set(next);
  } catch {}
  return { recorded };
}

// ---- reading ----

/**
 * The tightest window containing the most distinct accounts, when that is enough of them.
 *
 * Pure and exported because this is the claim with teeth - "six accounts inside eleven
 * minutes" is an accusation of coordination, and it has to be right. The scan is O(n^2) over
 * a list capped at CALLERS_PER_TOKEN, which is small enough that the obvious correct version
 * is also the fast one.
 */
export function detectCluster(callers, { window = CLUSTER_WINDOW_MS, min = CLUSTER_MIN } = {}) {
  const list = [...(callers || [])].filter((c) => c?.handle && c.at).sort((a, b) => a.at - b.at);
  if (list.length < min) return null;

  let best = null;
  for (let i = 0; i < list.length; i++) {
    const handles = new Set();
    let j = i;
    for (; j < list.length && list[j].at - list[i].at <= window; j++) handles.add(list[j].handle);
    if (handles.size < min) continue;
    const span = list[j - 1].at - list[i].at;
    if (!best || handles.size > best.count || (handles.size === best.count && span < best.spanMs)) {
      best = { count: handles.size, spanMs: span, from: list[i].at, to: list[j - 1].at, handles: [...handles] };
    }
  }
  return best;
}

/**
 * A caller's record, reduced to the numbers a reader can act on.
 *
 * Two halves. The verdict reached at each sighting is always there, because the extension
 * holds it. What the price did afterwards is there only once it has been asked for
 * (`priceCalls`), and it is reported beside the first half rather than folded into it.
 */
export function summarizeCaller(acct, now = Date.now()) {
  if (!acct) return null;
  const calls = acct.calls || [];
  const flagged = calls.filter((c) => FLAGGED.has(c.verdict));
  const tokens = calls.length;
  const spanMs = Math.max(0, (acct.last || now) - (acct.first || now));
  const days = Math.max(1, Math.round(spanMs / 86_400_000));
  const ratio = tokens ? flagged.length / tokens : 0;
  return {
    handle: acct.handle,
    display: acct.display || null,
    tokens,
    sightings: acct.seen || tokens,
    flagged: flagged.length,
    first: acct.first || null,
    last: acct.last || null,
    days,
    ratio,
    // Context, never a charge: `tone` and every rule that can mark an account read `tokens`
    // and `flagged` only. These two exist so an account that talks about tickets all day and
    // never posts a contract is a KNOWN quantity rather than an empty record.
    // How many of these contracts name THIS account as their own X account in their
    // metadata. One is a project posting its own token. Several is an account that keeps
    // launching them, and it is a count of facts rather than a judgement.
    owned: calls.filter((c) => c.own).length,
    // The price half of the record, once somebody has asked for it. Describes; never feeds
    // `tone`, for the reason at the top of lib/outcome.js.
    outcomes: summarizeOutcomes(calls),
    // already a sentence, because the feed draws it from a content script that cannot import
    outcomeSay: sayOutcomes(summarizeOutcomes(calls)),
    mentions: acct.mentions || 0,
    tickers: Object.entries(acct.tickers || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => ({ ticker: t, n })),
    tone: !tokens || !flagged.length ? "clean" : ratio >= 1 / 3 ? "bad" : "mixed",
    say: sayCaller(tokens, flagged.length, days),
  };
}

function sayCaller(tokens, flagged, days) {
  if (!tokens) return "no contracts from this account yet";
  const span = days === 1 ? "today" : `over ${days} days`;
  const what = `${tokens} contract${tokens === 1 ? "" : "s"} ${span}`;
  if (!flagged) return `${what}, none flagged`;
  return `${what}, ${flagged} flagged`;
}

export async function callerRecord(handle) {
  try {
    const key = acctKey(handle);
    const got = await chrome.storage.local.get(key);
    const acct = got[key];
    if (!acct) return null;
    // newest call first: what this account has been posting lately is the question
    return { ...summarizeCaller(acct), calls: [...(acct.calls || [])].sort((a, b) => (b.last || b.at) - (a.last || a.at)) };
  } catch {
    return null;
  }
}

/** Every account this graph has seen post `address`, plus whether they arrived together. */
export async function tokenCallers(address) {
  try {
    const key = caKey(address);
    const got = await chrome.storage.local.get(key);
    const token = got[key];
    if (!token) return null;
    const callers = [...(token.callers || [])].sort((a, b) => a.at - b.at);
    return { address: token.address, first: callers[0] || null, callers, cluster: detectCluster(callers) };
  } catch {
    return null;
  }
}

/**
 * Several accounts' records in one storage read.
 *
 * The feed needs this, not `callerRecord`: a sweep renders a batch of posts at once, and one
 * message per author would be a dozen round trips to the worker for a single screen. The
 * per-account `calls` list is deliberately left out - the feed shows the count, and shipping
 * eighty call objects per author across the message boundary to render one line is waste.
 */
export async function callerRecords(handles) {
  const wanted = [...new Set((handles || []).map((h) => String(h).toLowerCase()).filter(Boolean))];
  if (!wanted.length) return {};
  try {
    const store = await chrome.storage.local.get(wanted.map(acctKey));
    const out = {};
    for (const handle of wanted) {
      const acct = store[acctKey(handle)];
      if (!acct) continue;
      out[handle] = summarizeCaller(acct);
    }
    return out;
  } catch {
    return {};
  }
}

/** The same, for a whole ledger's worth of addresses, in one storage read. */
export async function tokenCallersMany(addresses) {
  const wanted = [...new Set((addresses || []).map((a) => String(a).toLowerCase()))];
  if (!wanted.length) return {};
  try {
    const store = await chrome.storage.local.get(wanted.map(caKey));
    const out = {};
    for (const address of wanted) {
      const token = store[caKey(address)];
      if (!token) continue;
      const callers = [...(token.callers || [])].sort((a, b) => a.at - b.at);
      out[address] = { address, first: callers[0] || null, callers, cluster: detectCluster(callers) };
    }
    return out;
  } catch {
    return {};
  }
}

/** Accounts worth looking at first: most flagged, then most prolific. */
export async function topCallers(limit = 40) {
  try {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([k]) => k.startsWith(ACCT))
      .map(([, v]) => summarizeCaller(v))
      .filter(Boolean)
      .sort((a, b) => b.flagged - a.flagged || b.tokens - a.tokens || b.last - a.last)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function graphStats() {
  try {
    const all = await chrome.storage.local.get(null);
    let accounts = 0;
    let tokens = 0;
    let flagged = 0;
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith(ACCT)) {
        accounts += 1;
        flagged += (v?.calls || []).filter((c) => FLAGGED.has(c.verdict)).length;
      } else if (k.startsWith(CA)) {
        tokens += 1;
      }
    }
    return { accounts, tokens, flagged, ...(await graphSettings()) };
  } catch {
    return { accounts: 0, tokens: 0, flagged: 0, paused: false };
  }
}

/** One button, everything gone. The settings survive: pausing then wiping must stay paused. */
export async function wipeGraph() {
  try {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(ACCT) || k.startsWith(CA));
    if (keys.length) await chrome.storage.local.remove(keys);
    return { wiped: keys.length };
  } catch {
    return { wiped: 0 };
  }
}

/** Bounded like the rest of local storage: the quietest accounts fall off first. */
export async function pruneGraph() {
  try {
    const all = await chrome.storage.local.get(null);
    const accounts = Object.entries(all).filter(([k]) => k.startsWith(ACCT));
    if (accounts.length <= MAX_ACCOUNTS) return;
    accounts.sort((a, b) => (a[1]?.last || 0) - (b[1]?.last || 0));
    const drop = accounts.slice(0, accounts.length - MAX_ACCOUNTS).map(([k]) => k);
    await chrome.storage.local.remove(drop);
  } catch {}
}

// ---- what happened after ----

const PRICED_TTL_MS = 30 * 60 * 1000;      // a price moves; a call priced half an hour ago is stale
const UNPRICED_TTL_MS = 6 * 60 * 60 * 1000; // "no pool" rarely changes inside an afternoon
// The candle source allows very few requests a minute and each call costs one. Four keeps a
// run inside it with room for somebody to open a chart, and the button can be pressed again:
// results are stored, so a second press continues where the first stopped.
export const PRICE_PER_RUN = 4;

const stale = (c, now) => {
  const o = c.out;
  if (!o) return true;
  return now - (o.at || 0) > (Number.isFinite(o.pct) ? PRICED_TTL_MS : UNPRICED_TTL_MS);
};

/**
 * Price an account's most recent calls and store the result on the record.
 *
 * Newest first, because what an account has been posting lately is the question. Stops at
 * the first rate limit and reports it rather than spending the rest of the budget failing -
 * and a call that was rate limited is NOT stored, because "we were limited" is about this
 * extension and must not be remembered as a fact about a token.
 *
 * Returns the refreshed record in the same shape `callerRecord` gives, plus `run`.
 */
export async function priceCalls(handle, { now = Date.now(), fetchImpl = fetch, limit = PRICE_PER_RUN } = {}) {
  const key = acctKey(handle);
  let acct;
  try {
    acct = (await chrome.storage.local.get(key))[key];
  } catch {
    return null;
  }
  if (!acct) return null;

  const queue = [...(acct.calls || [])]
    .sort((a, b) => (b.last || b.at) - (a.last || a.at))
    .filter((c) => stale(c, now))
    .slice(0, limit);

  const run = { asked: queue.length, priced: 0, limited: false, left: 0 };
  const results = new Map();
  for (const call of queue) {
    if (!(await spend("candles"))) {
      run.limited = true;
      break;
    }
    const out = await readOutcome(call, { fetchImpl, now });
    if (out.status === "limited") {
      run.limited = true;
      break;
    }
    if (out.status === "unreachable") continue; // nothing learned, nothing stored
    results.set(call.address, { ...out, at: now });
    if (out.status === "priced") run.priced += 1;
  }

  // Re-read before writing: pricing takes seconds, and a scroll in another tab may have
  // recorded new sightings on this same account while it ran.
  try {
    const fresh = (await chrome.storage.local.get(key))[key] || acct;
    for (const c of fresh.calls || []) {
      const out = results.get(c.address);
      if (out) c.out = out;
    }
    await chrome.storage.local.set({ [key]: fresh });
    acct = fresh;
  } catch {
    /* storage blocked: the answer is still returned, it just will not be remembered */
  }

  run.left = (acct.calls || []).filter((c) => stale(c, now)).length;
  return {
    ...summarizeCaller(acct, now),
    calls: [...(acct.calls || [])].sort((a, b) => (b.last || b.at) - (a.last || a.at)),
    run,
  };
}
