// Robinhood Chain (4663) read straight from the public RPC.
//
// The extension talks to the chain itself rather than to an edgerun backend. Measured
// 2026-09-21, the hosted backend cold-starts in 31.6 s and takes 14.1 s for an uncached
// scan at 12 requests/minute/IP - numbers that cannot support a badge on a scrolling feed.
// The RPC answers a batched call in well under a second and sends
// `access-control-allow-origin: *`, and a service worker with host_permissions is not
// subject to CORS at all.

export const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const CHAIN_ID = 4663;

// 4-byte selectors, the same table the Python engine verified against real deployed
// bytecode on this chain (edgerun/edgerun/selectors.py).
export const SEL = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
  balanceOf: "0x70a08231",
  transfer: "0xa9059cbb",
  owner: "0x8da5cb5b",
  uiMultiplier: "0xa60bf13d", // ERC-8056, the official stock tokens implement it
};

const pad = (h) => h.padStart(64, "0");
export const addrWord = (a) => pad(String(a).toLowerCase().replace(/^0x/, ""));
export const uintWord = (n) => pad(BigInt(n).toString(16));
export const callData = (selector, ...words) => selector + words.join("");

export function decodeUint(hex) {
  if (!hex || hex === "0x") return null;
  try { return BigInt(hex); } catch { return null; }
}

export function decodeAddress(hex) {
  if (!hex || hex.length < 42) return null;
  const a = "0x" + hex.slice(-40);
  return /^0x[0-9a-f]{40}$/i.test(a) ? a.toLowerCase() : null;
}

// Handles both shapes in the wild: the ABI dynamic string, and the old bytes32 symbol
// that predates it (some tokens on this chain still return one).
export function decodeString(hex) {
  if (!hex || hex === "0x") return null;
  const raw = hex.replace(/^0x/, "");
  try {
    if (raw.length === 64) return clean(bytes(raw, 32));
    if (raw.length < 128) return null;
    const len = parseInt(raw.slice(64, 128), 16);
    if (!Number.isFinite(len) || len <= 0 || len > 1024) return null;
    return clean(bytes(raw.slice(128), len));
  } catch {
    return null;
  }
}

// Decoded as UTF-8, not byte-by-byte: every official stock token is named
// "<Company> • Robinhood Token" and that bullet is three bytes. Reading it a byte at a time
// turns the name into mojibake and loses the exact string the impersonators copy.
function bytes(raw, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16) || 0;
  return new TextDecoder("utf-8", { fatal: false }).decode(out);
}

const clean = (s) => {
  const out = s.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return out || null;
};

/**
 * One HTTP round trip for many calls. `items` is [{method, params}, ...]; the result is a
 * same-length array of {result, error} in the order given - the node may reorder a batch
 * response, so entries are matched back by id rather than by position.
 */
export async function rpc(items, { signal } = {}) {
  if (!items.length) return [];
  const body = items.map((c, i) => ({ jsonrpc: "2.0", id: i, method: c.method, params: c.params || [] }));
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json) ? json : [json];
  const out = new Array(items.length).fill(null);
  for (const r of list) {
    const i = typeof r.id === "number" ? r.id : 0;
    out[i] = { result: r.result ?? null, error: r.error || null };
  }
  return out.map((r) => r || { result: null, error: { message: "no response" } });
}

export const ethCall = (to, data, from) => ({
  method: "eth_call",
  params: [from ? { from, to, data } : { to, data }, "latest"],
});

export const getCode = (address) => ({ method: "eth_getCode", params: [address, "latest"] });

// eth_call on this chain returns structured revert data on the error object, which is what
// makes the exit test possible at all.
export const revertData = (error) => {
  if (!error) return null;
  const d = error.data;
  if (typeof d === "string") return d;
  if (d && typeof d.data === "string") return d.data;
  return null;
};
