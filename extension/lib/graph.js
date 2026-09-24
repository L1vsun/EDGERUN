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
// without destroying what is already there. A ticker mention is never a sighting: "$TSLA
// earnings tomorrow" is not a call, and counting it would make every finance account a caller.

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
export async function recordSightings(sightings, now = Date.now()) {
  const clean = (sightings || []).filter((s) => s?.handle && s?.address);
  if (!clean.length) return { recorded: 0 };
  if ((await graphSettings()).paused) return { recorded: 0, paused: true };

  const keys = [...new Set(clean.flatMap((s) => [acctKey(s.handle), caKey(s.address)]))];
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
    const address = String(s.address).toLowerCase();

    const ak = acctKey(handle);
    const acct = read(ak) || { handle, display: null, first: now, last: now, seen: 0, calls: [] };
    if (s.display) acct.display = s.display;

    const prior = acct.calls.find((c) => c.address === address);
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
    if (!token.callers.some((c) => c.handle === handle)) {
      token.callers.push({ handle, at: now });
      if (token.callers.length > CALLERS_PER_TOKEN) token.callers = token.callers.slice(-CALLERS_PER_TOKEN);
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
 * Deliberately not a price claim. The extension stores the verdict it reached at each
 * sighting, not what the token did afterwards, so the honest metric is how many of the
 * contracts this account posted came back failing - a number that is checkable, from data
 * this extension actually holds.
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
