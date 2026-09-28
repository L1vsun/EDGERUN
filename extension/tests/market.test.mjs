// What the trades say.
//
// The flags here are accusations by another name, so they get the same treatment as every
// other accusation in this project: a floor under them, and silence below it. A buy/sell
// ratio computed from four trades is not evidence, and this codebase's characteristic bug is
// saying something confident about too little.
import assert from "node:assert/strict";
import { marketFlags, pickPair, readMarket, summarize, windows } from "../lib/market.js";

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const HOUR = 3600_000;

const pair = (over = {}) => ({
  pairAddress: "0xpool", chainId: "robinhood", dexId: "uniswap", url: "https://dexscreener.com/robinhood/0xpool",
  baseToken: { symbol: "TSLA" }, quoteToken: { symbol: "USDG" },
  priceUsd: "370.98", fdv: 4967707,
  liquidity: { usd: 372441.91 },
  volume: { m5: 0, h1: 29.03, h6: 41823.36, h24: 95795.39 },
  priceChange: { h1: 0.12, h6: -0.16, h24: -0.25 },
  txns: { m5: { buys: 0, sells: 0 }, h1: { buys: 2, sells: 2 }, h6: { buys: 122, sells: 103 }, h24: { buys: 332, sells: 327 } },
  pairCreatedAt: NOW - 80 * 24 * HOUR,
  ...over,
});

// ---- a healthy market says nothing ----
// This is the real TSLA pool, shape and numbers taken from the live API on 2026-09-28.
assert.deepEqual(marketFlags(pair(), NOW), [], "a two-sided market on a deep, old pool is not a finding");

// ---- the honeypot shape ----
let f = marketFlags(pair({ txns: { h24: { buys: 412, sells: 0 } } }), NOW);
assert.equal(f.length, 1);
assert.equal(f[0].id, "no_sells");
assert.match(f[0].detail, /412 buys and no sells/);
assert.match(f[0].detail, /a brand-new pool can look like this honestly/, "it states its own limit");

// ...but not on thin evidence. Twenty-four buys and no sells is a quiet morning.
assert.deepEqual(marketFlags(pair({ txns: { h24: { buys: 24, sells: 0 } } }), NOW), [],
  "below the floor it says nothing rather than guessing");

// ---- lopsided, which is weaker than no sells and reads that way ----
f = marketFlags(pair({ txns: { h24: { buys: 300, sells: 10 } } }), NOW);
assert.equal(f[0].id, "lopsided");
assert.match(f[0].detail, /300 buys against 10 sells/);

// a ratio under the bar is normal trading
assert.deepEqual(marketFlags(pair({ txns: { h24: { buys: 300, sells: 40 } } }), NOW), []);
// and a big ratio on tiny volume is still nothing
assert.deepEqual(marketFlags(pair({ txns: { h24: { buys: 30, sells: 1 } } }), NOW), []);

// the two never both fire - no sells is the stronger statement of the same thing
f = marketFlags(pair({ txns: { h24: { buys: 500, sells: 0 } } }), NOW);
assert.equal(f.filter((x) => x.id === "lopsided").length, 0);

// ---- a young pool ----
f = marketFlags(pair({ pairCreatedAt: NOW - 3 * HOUR }), NOW);
assert.equal(f.find((x) => x.id === "new_pair") !== undefined, true);
assert.match(f.find((x) => x.id === "new_pair").detail, /about 3 hours old/);
assert.equal(marketFlags(pair({ pairCreatedAt: NOW - 40 * HOUR }), NOW).length, 0, "two days old is not news");

// ---- thin liquidity ----
f = marketFlags(pair({ liquidity: { usd: 800 } }), NOW);
assert.equal(f.find((x) => x.id === "thin") !== undefined, true);
// a dead pool with no trades at all is not flagged as thin - there is nothing happening to warn about
assert.deepEqual(marketFlags(pair({ liquidity: { usd: 800 }, txns: { h24: { buys: 0, sells: 0 } } }), NOW), []);

// ---- missing data is never a finding ----
assert.deepEqual(marketFlags(null, NOW), []);
assert.deepEqual(marketFlags({}, NOW), [], "an empty pair says nothing at all");

// ---- the deepest pool leads: thirty pools, one answer ----
const pools = [
  pair({ pairAddress: "0xa", liquidity: { usd: 40 } }),
  pair({ pairAddress: "0xb", liquidity: { usd: 372441 } }),
  pair({ pairAddress: "0xc", liquidity: { usd: 9000 } }),
];
assert.equal(pickPair(pools).pairAddress, "0xb", "a lopsided flow in a $40 pool is not evidence of anything");
assert.equal(pickPair(pools, { chain: "robinhood" }).pairAddress, "0xb");
// asking for a chain with no pools falls back rather than returning nothing
assert.equal(pickPair(pools, { chain: "solana" }).pairAddress, "0xb");
assert.equal(pickPair([]), null);
assert.equal(pickPair(null), null);

// ---- ranked by volume, because a rugged pool is drained but still carries the record ----
const rugged = [
  pair({ pairAddress: "0xdrained", liquidity: { usd: 609 }, volume: { h24: 83959 } }),
  pair({ pairAddress: "0xdust", liquidity: { usd: 3.44 }, volume: { h24: 36 } }),
];
assert.equal(pickPair(rugged).pairAddress, "0xdrained");
// a deep pool with no trading loses to a drained one that carries the whole story
assert.equal(
  pickPair([pair({ pairAddress: "0xquiet", liquidity: { usd: 500000 }, volume: { h24: 0 } }), rugged[0]]).pairAddress,
  "0xdrained",
);
// liquidity still breaks a tie
assert.equal(
  pickPair([pair({ pairAddress: "0xa", liquidity: { usd: 10 }, volume: { h24: 5 } }), pair({ pairAddress: "0xb", liquidity: { usd: 99 }, volume: { h24: 5 } })]).pairAddress,
  "0xb",
);

// ---- the window table keeps nulls as nulls ----
const w = windows(pair({ volume: { h24: 95795.39 }, priceChange: {}, txns: {} }));
assert.equal(w.length, 4);
assert.equal(w[3].volume, 95795.39);
assert.equal(w[3].change, null, "a missing number is not a zero");
assert.equal(w[0].buys, null);

// ---- summarize ----
const s = summarize(pair(), NOW);
assert.equal(s.chain, "robinhood");
assert.equal(s.symbol, "TSLA");
assert.equal(s.priceUsd, 370.98);
assert.equal(s.windows.length, 4);
assert.deepEqual(s.flags, []);
assert.equal(summarize(null), null);

// ---- a corroborating source that is down must not take a verdict with it ----
assert.equal(await readMarket("0xa", { fetchImpl: async () => { throw new Error("offline"); } }), null);
assert.equal(await readMarket("0xa", { fetchImpl: async () => ({ ok: false, status: 429 }) }), null);
// "could not reach the source" and "the source knows of no pool" are different answers, and
// the second one is worth showing - a token pushed hard with nowhere to trade it is a fact
// about the push. Still unresolved, never a warning: not being indexed is not not existing.
assert.deepEqual(await readMarket("0xa", { fetchImpl: async () => ({ ok: true, json: async () => ({ pairs: [] }) }) }),
  { none: true });
assert.equal(await readMarket("0xa", { fetchImpl: async () => { throw new Error("dns"); } }), null,
  "unreachable stays null, so the panel can tell the two apart");

const got = await readMarket("0xa", {
  fetchImpl: async () => ({ ok: true, json: async () => ({ pairs: pools }) }),
  now: NOW,
});
assert.equal(got.pairAddress, "0xb");

console.log("market: ok");
