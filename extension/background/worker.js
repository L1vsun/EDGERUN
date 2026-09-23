// The only place that talks to the network.
//
// Content scripts never fetch anything themselves - they ask for a verdict and get one back,
// from cache where possible. That is what keeps a timeline with forty tickers on screen from
// turning into forty requests: identical addresses collapse into one in-flight promise, the
// whole batch resolves in a single JSON-RPC round trip, and everything is cached by address.
//
// MV3 kills this worker after ~30 s idle, so nothing important lives in a variable: the
// registry, the verdict cache, the watchlist and the spend budget are all in storage.

import { getBlocklist } from "../lib/blocklist.js";
import { remaining } from "../lib/budget.js";
import { deployerTrail, trailChecks } from "../lib/deployer.js";
import * as ledger from "../lib/ledger.js";
import { pruneMemory, rememberAndRecall } from "../lib/memory.js";
import { getRegistry } from "../lib/registry.js";
import { isAddress, lookupTicker, rankCandidates, resolveTicker, scan, scanMany } from "../lib/verdict.js";

const TTL = { identity: 15 * 60 * 1000, full: 5 * 60 * 1000 };
const TICKER_TTL = 6 * 60 * 60 * 1000; // which contracts claim a ticker barely changes
const cacheKey = (address, level) => `v:${level}:${address.toLowerCase()}`;
const inflight = new Map();

async function cacheGet(address, level) {
  try {
    const key = cacheKey(address, level);
    const got = await chrome.storage.local.get(key);
    const hit = got[key];
    if (hit && Date.now() - hit.scannedAt < TTL[level]) return hit;
  } catch {
    /* storage blocked: just re-scan */
  }
  return null;
}

const cachePut = (result) =>
  chrome.storage.local.set({ [cacheKey(result.address, result.level)]: result }).catch(() => {});

/** A full verdict outranks an identity one for display, so prefer it when it is still warm. */
async function bestCached(address) {
  return (await cacheGet(address, "full")) || (await cacheGet(address, "identity"));
}

async function getVerdict(address, level = "identity", { fresh = false } = {}) {
  if (!isAddress(address)) throw new Error("that is not a contract address");
  const addr = address.toLowerCase();
  if (!fresh) {
    const cached = level === "identity" ? await bestCached(addr) : await cacheGet(addr, level);
    if (cached) return { ...cached, cached: true };
  }
  const key = `${level}:${addr}`;
  if (inflight.has(key)) return inflight.get(key);
  const p = scan(addr, { level })
    .then(async (r) => {
      // recorded once, on the fresh scan - a cached read must not inflate "seen 9 times"
      const notes = await rememberAndRecall(r);
      const out = notes.length ? { ...r, checks: [...r.checks, ...notes] } : r;
      cachePut(out);
      return out;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function getVerdicts(addresses) {
  const wanted = [...new Set((addresses || []).filter(isAddress).map((a) => a.toLowerCase()))];
  const out = {};
  const missing = [];
  for (const addr of wanted) {
    const cached = await bestCached(addr);
    if (cached) out[addr] = { ...cached, cached: true };
    else missing.push(addr);
  }
  if (missing.length) {
    const fresh = await scanMany(missing);
    for (const [addr, r] of Object.entries(fresh)) {
      const notes = await rememberAndRecall(r);
      const withNotes = notes.length ? { ...r, checks: [...r.checks, ...notes] } : r;
      out[addr] = withNotes;
      cachePut(withNotes);
    }
  }
  return out;
}

// The deployer trail is slow and expensive, so it is asked for explicitly and cached for an
// hour - a wallet's launch history does not change minute to minute.
const trailCache = new Map();
async function getTrail(address) {
  const addr = String(address).toLowerCase();
  const hit = trailCache.get(addr);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.data;
  const trail = await deployerTrail(addr);
  const data = { trail, checks: trailChecks(trail) };
  trailCache.set(addr, { at: Date.now(), data });
  return data;
}

// Dexscreener puts the *pair* in the URL, not the token - and on this chain some of those
// are Uniswap v4 pool ids (32 bytes), not addresses. Resolving pair -> baseToken is the
// worker's job because it owns the network and the cache.
async function resolvePair(pairId) {
  const key = `pair:${pairId.toLowerCase()}`;
  try {
    const got = await chrome.storage.local.get(key);
    if (got[key]) return got[key];
  } catch {}
  const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/robinhood/${pairId}`);
  if (!res.ok) throw new Error(`dexscreener HTTP ${res.status}`);
  const pair = (await res.json())?.pairs?.[0];
  if (!pair) throw new Error("no such pair on this chain");
  const info = {
    baseToken: pair.baseToken?.address?.toLowerCase() || null,
    baseSymbol: pair.baseToken?.symbol || null,
    quoteSymbol: pair.quoteToken?.symbol || null,
    dex: pair.dexId || null,
    labels: pair.labels || [],
  };
  chrome.storage.local.set({ [key]: info }).catch(() => {});
  return info;
}

// ---- watchlist: local only, never synced anywhere ----

async function watchList() {
  try {
    const got = await chrome.storage.local.get("watch");
    return got.watch || [];
  } catch {
    return [];
  }
}

async function watchToggle(address) {
  const addr = String(address).toLowerCase();
  const list = await watchList();
  const next = list.some((w) => w.address === addr)
    ? list.filter((w) => w.address !== addr)
    : [...list, { address: addr, at: Date.now() }];
  await chrome.storage.local.set({ watch: next });
  return next;
}

// Every handler gets the sender, because a verdict is only half the story - which tab asked
// is what turns a stream of one-off checks into a readable session.
const HANDLERS = {
  // A check asked for by the side panel has no sender.tab - it is an extension page - so the
  // tab it belongs to is passed explicitly. Without this, anything typed into the panel would
  // run and then vanish from the very list it was typed into.
  verdict: async (m, sender) => {
    const r = await getVerdict(m.address, m.level || "identity", { fresh: m.fresh });
    await ledger.record(sender?.tab?.id ?? m.tabId, sender?.tab?.url ?? m.url, r);
    return r;
  },
  verdicts: async (m, sender) => {
    const out = await getVerdicts(m.addresses);
    await ledger.recordMany(sender?.tab?.id ?? m.tabId, sender?.tab?.url ?? m.url, Object.values(out));
    return out;
  },
  ticker: (m) => resolveTicker(m.ticker),
  tickers: async (m) => {
    // An official ticker costs nothing (the registry is already local). Anything else needs
    // one explorer search, so it is cached hard - a ticker's contract set barely moves, and
    // a timeline full of $PEPE must not spend a search per post.
    const out = {};
    for (const t of [...new Set(m.tickers || [])].slice(0, 12)) {
      const key = `tk:${t.toUpperCase()}`;
      try {
        const got = await chrome.storage.local.get(key);
        if (got[key] && Date.now() - got[key].at < TICKER_TTL) {
          if (got[key].hit) out[t] = got[key].hit;
          continue;
        }
      } catch {}
      const hit = await lookupTicker(t);
      chrome.storage.local.set({ [key]: { at: Date.now(), hit } }).catch(() => {});
      if (hit) out[t] = hit;
    }
    return out;
  },
  pair: (m) => resolvePair(m.pairId),
  deployer: (m) => getTrail(m.address),
  rank: (m) => rankCandidates(m.addresses),
  blocklist: () => getBlocklist().then((b) => ({ count: b.count, updated: b.updated, source: b.source })),
  registry: () => getRegistry().then((r) => ({ loaded: r.loaded, count: r.count || 0, error: r.error, fetchedAt: r.fetchedAt })),
  budget: async () => ({ blockscout: await remaining("blockscout"), rpc: await remaining("rpc") }),
  "watch:list": () => watchList(),
  "watch:toggle": (m) => watchToggle(m.address),

  // ---- the sidebar ----
  "ledger:get": (m, sender) => ledger.read(m.tabId ?? sender?.tab?.id),
  "ledger:clear": (m, sender) => ledger.clear(m.tabId ?? sender?.tab?.id).then(() => ({ cleared: true })),

  /**
   * Open the side panel beside the tab that asked.
   *
   * chrome.sidePanel.open() needs a user gesture, and the gesture here happened in a content
   * script (a click on the badge) rather than in an extension page. Whether that survives the
   * hop through sendMessage is not something we can rely on, so this is allowed to fail and
   * the badge falls back to its in-page panel when it does.
   */
  "panel:open": async (m, sender) => {
    const tabId = sender?.tab?.id ?? m.tabId;
    if (!tabId) throw new Error("no tab to open beside");
    if (m.address) await ledger.setFocus(tabId, m.address);
    if (!chrome.sidePanel?.open) throw new Error("this browser has no side panel");
    await chrome.sidePanel.open({ tabId });
    return { opened: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) return false;
  Promise.resolve(handler(msg, sender))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true; // keep the channel open for the async reply
});

// A closed tab's reading session is over. Session storage would clear on browser exit
// anyway, but a long-lived window should not accumulate ledgers for tabs that are gone.
chrome.tabs.onRemoved.addListener((tabId) => ledger.drop(tabId));

// The toolbar icon opens the side panel directly. There is no popup any more: two surfaces
// meant every feature had to be decided twice, and the sidebar is the one with room.
const useSidePanel = () =>
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

// Keep the registry warm so no badge ever waits on it.
chrome.runtime.onInstalled.addListener(() => {
  useSidePanel();
  chrome.alarms.create("registry", { periodInMinutes: 55 });
  chrome.alarms.create("upkeep", { periodInMinutes: 180 });
  getRegistry({ force: true }).catch(() => {});
  getBlocklist({ force: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  useSidePanel();
  getRegistry().catch(() => {});
  getBlocklist().catch(() => {});
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "registry") {
    getRegistry({ force: true }).catch(() => {});
    getBlocklist({ force: true }).catch(() => {});
  }
  if (a.name === "upkeep") pruneMemory().catch(() => {});
});
