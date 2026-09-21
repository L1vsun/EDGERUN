// The official Robinhood stock-token registry — the one check nothing else can do.
//
// Robinhood publishes the authoritative contract address for every tokenised security it
// deploys on chain 4663 at a public, keyless endpoint. That turns impersonation from a
// heuristic into a fact: not "2 edits from an established ticker" but "the official Tesla
// token is 0x322F0929…, and this is not it".
//
// It matters because the fakes are already everywhere: a ten-ticker sweep of this chain
// found 213 contracts using an official ticker that were not the official contract, six of
// them named exactly "NVIDIA • Robinhood Token". Every one is a structurally clean ERC-20 —
// verified source, no mint, ownership renounced — so a scanner that only reads the contract
// passes all of them.
//
// Cached in chrome.storage.local for an hour, and refreshed by an alarm rather than on
// demand, so a feed scan never waits on it. A registry that will not load must never let a
// token read as genuine: `loaded` is false and every check downgrades to unresolved.

import { spend } from "./budget.js";

export const REGISTRY_URL = "https://api.robinhood.com/rhj/assets";
export const ROBINHOOD_CHAIN_ID = 4663;
export const OFFICIAL_NAME_MARKER = "robinhood token";

const KEY = "registry";
const TTL_MS = 60 * 60 * 1000;

let mem = null;

/** Fold the bullet, accents and case so "Tesla • Robinhood Token" == "tesla robinhood token". */
export function normalizeName(name) {
  const folded = String(name || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[•·|\-–—]/g, " ");
  return folded.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

function index(payload) {
  const byTicker = {};
  const byAddress = {};
  for (const asset of payload?.assets || []) {
    const ticker = String(asset.tokenSymbol || "").toUpperCase();
    if (!ticker) continue;
    for (const dep of asset.deployments || []) {
      if (dep.chainId !== ROBINHOOD_CHAIN_ID) continue;
      const address = String(dep.contractAddress || "").toLowerCase();
      if (!address) continue;
      const entry = { ticker, name: asset.tokenName || "", address, status: asset.status || "" };
      byTicker[ticker] = entry;
      byAddress[address] = entry;
    }
  }
  return { byTicker, byAddress };
}

export async function getRegistry({ force = false } = {}) {
  if (!force && mem && Date.now() - mem.fetchedAt < TTL_MS) return mem;

  if (!force) {
    try {
      const got = await chrome.storage.local.get(KEY);
      const cached = got[KEY];
      if (cached && Date.now() - cached.fetchedAt < TTL_MS && cached.byTicker) {
        mem = cached;
        return mem;
      }
    } catch {
      /* storage blocked: fall through to a live fetch */
    }
  }

  if (!(await spend("registry"))) {
    return mem || { loaded: false, error: "registry refresh rate-limited locally", byTicker: {}, byAddress: {}, fetchedAt: 0 };
  }

  try {
    const res = await fetch(REGISTRY_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { byTicker, byAddress } = index(await res.json());
    if (!Object.keys(byTicker).length) throw new Error("no Robinhood Chain deployments in the response");
    mem = { loaded: true, error: null, byTicker, byAddress, fetchedAt: Date.now(), count: Object.keys(byTicker).length };
    chrome.storage.local.set({ [KEY]: mem }).catch(() => {});
    return mem;
  } catch (err) {
    // Keep serving a stale copy if we have one — a day-old registry is still authoritative
    // about which address is official, and the alternative is going blind.
    if (mem?.loaded) return { ...mem, error: `refresh failed: ${err.message} (serving cached)` };
    return { loaded: false, error: `registry unreachable: ${err.message}`, byTicker: {}, byAddress: {}, fetchedAt: 0 };
  }
}

export const officialForAddress = (reg, address) => reg.byAddress[String(address || "").toLowerCase()] || null;
export const officialForTicker = (reg, ticker) => reg.byTicker[String(ticker || "").toUpperCase().replace(/^\$/, "")] || null;
