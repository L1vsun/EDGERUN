// The public blocklist.
//
// Every other extension in this category ships a blocklist you cannot read. This one is a
// JSON file in the repo, served from the same GitHub Pages site: the entries are visible,
// the evidence field says what was measured, and `git log` on the file says who added each
// one and when. A list nobody can audit is just a rumour with an API in front of it.
//
// Fetched hourly and cached. A listed address is reported as a separate check with its own
// evidence - it never silently changes another check's result, and a listing that cannot be
// fetched simply does not appear.

import { spend } from "./budget.js";

const URL = "https://edgerun.live/blocklist.json";
const KEY = "blocklist";
const TTL_MS = 60 * 60 * 1000;

let mem = null;

export async function getBlocklist({ force = false } = {}) {
  if (!force && mem && Date.now() - mem.fetchedAt < TTL_MS) return mem;
  if (!force) {
    try {
      const got = await chrome.storage.local.get(KEY);
      if (got[KEY] && Date.now() - got[KEY].fetchedAt < TTL_MS) {
        mem = got[KEY];
        return mem;
      }
    } catch {}
  }
  if (!(await spend("registry"))) return mem || { by: {}, fetchedAt: 0, count: 0 };

  try {
    const res = await fetch(URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const by = {};
    for (const e of data.entries || []) {
      if (!e.address) continue;
      by[String(e.address).toLowerCase()] = e;
    }
    mem = { by, fetchedAt: Date.now(), count: Object.keys(by).length, updated: data.updated, source: data.source };
    chrome.storage.local.set({ [KEY]: mem }).catch(() => {});
    return mem;
  } catch {
    // a stale list is still useful; no list at all simply contributes nothing
    return mem || { by: {}, fetchedAt: 0, count: 0 };
  }
}

export async function listedEntry(address) {
  const list = await getBlocklist();
  return list.by[String(address || "").toLowerCase()] || null;
}

export function listingCheck(entry) {
  return {
    id: "blocklist",
    label: "public blocklist",
    status: entry.severity === "fail" ? "fail" : "warn",
    detail: `listed ${entry.added} - ${entry.reason}. ${entry.evidence}`,
  };
}
