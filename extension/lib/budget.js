// A spend limit per upstream, so a fast scroll can never turn into a flood.
//
// Blockscout answers with `x-ratelimit-limit: 150` per window and 403s a request that
// carries no Referer at all (both measured live 2026-09-21 — the Referer is put back by
// the declarativeNetRequest rule in rules/referer.json, since a service worker cannot set
// that header from fetch). The caps here sit well under the upstream's, because the limit
// is now spent from the *user's* IP, not a server's, and a badge is never worth burning
// someone's explorer access.
//
// State lives in chrome.storage.session so that a service-worker restart — which MV3 does
// aggressively, after ~30 s idle — cannot hand out a fresh allowance mid-window.

// Counted in HTTP requests, not in calls: a JSON-RPC batch of forty eth_calls is one
// request to the node, and budgeting it as forty would starve a single timeline scan.
const LIMITS = {
  blockscout: { max: 40, windowMs: 60_000 },
  rpc: { max: 60, windowMs: 60_000 },
  dexscreener: { max: 30, windowMs: 60_000 },
  registry: { max: 6, windowMs: 60_000 },
};

const KEY = "budget";
let state = null; // { [name]: { start, n } }

async function load() {
  if (state) return state;
  try {
    const got = await chrome.storage.session.get(KEY);
    state = got[KEY] || {};
  } catch {
    state = {};
  }
  return state;
}

function persist() {
  chrome.storage.session.set({ [KEY]: state }).catch(() => {});
}

/** True when this upstream still has room in the current window. Spends one on success. */
export async function spend(name, n = 1) {
  const limit = LIMITS[name];
  if (!limit) return true;
  const s = await load();
  const now = Date.now();
  const slot = s[name];
  if (!slot || now - slot.start > limit.windowMs) {
    s[name] = { start: now, n };
    persist();
    return true;
  }
  if (slot.n + n > limit.max) return false;
  slot.n += n;
  persist();
  return true;
}

export async function remaining(name) {
  const limit = LIMITS[name];
  if (!limit) return Infinity;
  const s = await load();
  const slot = s[name];
  if (!slot || Date.now() - slot.start > limit.windowMs) return limit.max;
  return Math.max(0, limit.max - slot.n);
}

export class BudgetExceeded extends Error {
  constructor(name) {
    super(`out of ${name} budget for this minute`);
    this.upstream = name;
  }
}
