// Blockscout v2, called directly from the worker.
//
// Verified live: the explorer 403s a request that carries no Referer at all (any value
// satisfies it). A service worker's fetch sends none and scripts are forbidden from setting
// that header, so rules/referer.json puts one back via declarativeNetRequest. If that rule
// ever stops applying, every call here returns 403 — which surfaces as `unresolved`, never
// as a pass.

import { BudgetExceeded, spend } from "./budget.js";

export const BASE = "https://robinhoodchain.blockscout.com";
export const explorerUrl = (address) => `${BASE}/address/${address}`;

async function get(path) {
  if (!(await spend("blockscout"))) throw new BudgetExceeded("blockscout");
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: "application/json" } });
  if (res.status === 403) throw new Error("the explorer blocked this request (bot protection)");
  if (res.status === 429) throw new Error("the explorer is rate limiting");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`explorer HTTP ${res.status}`);
  return res.json();
}

/** is_contract, is_verified, the creation transaction and the creator. */
export const address = (a) => get(`/api/v2/addresses/${a}`);

/** name, symbol, decimals, total_supply, holders_count. */
export const token = (a) => get(`/api/v2/tokens/${a}`);

/**
 * Token search. Fuzzy and capped at 50 by the explorer, so the caller filters to exact
 * symbol matches and treats the count as a floor, never as a total.
 */
export async function search(q) {
  const data = await get(`/api/v2/search?q=${encodeURIComponent(q)}`);
  const items = (data?.items || []).filter((i) => i.type === "token" && i.address_hash);
  return { items, capped: (data?.items || []).length >= 50 };
}

/** Top holders. Their balances are a cached snapshot — read balanceOf live before using. */
export async function holders(a, limit = 6) {
  const data = await get(`/api/v2/tokens/${a}/holders`);
  const items = data?.items || [];
  return items.slice(0, limit).map((h) => ({
    address: h.address?.hash || h.address,
    value: h.value,
  })).filter((h) => h.address);
}
