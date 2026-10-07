// What happened after the post.
//
// The pool numbers in the graduation cases are real, read live on 2026-10-07 for a token
// (KKK) that launched on a bonding curve at 22:07:50Z and graduated to an open pool at
// 00:17:59Z - the case that makes "which pool" a question at all.
import assert from "node:assert/strict";

globalThis.chrome = { storage: { session: { get: async () => ({}), set: async () => {} }, local: { get: async () => ({}), set: async () => {} } } };

const O = await import("../lib/outcome.js");
const { livePools } = await import("../lib/candles.js");
const { pickPair } = await import("../lib/market.js");

const T = (iso) => Date.parse(iso);
const bar = (iso, o, h, l, c) => ({ t: T(iso) / 1000, o, h, l, c, v: 1 });

// ---- the finest candle that still reaches the post ----
assert.deepEqual(O.pickFrame(10 * 60_000), { timeframe: "minute", aggregate: 1, barSec: 60, limit: 1000 });
assert.equal(O.pickFrame(15 * 3600_000).aggregate, 1, "fifteen hours still fits in 1000 one-minute bars");
assert.equal(O.pickFrame(17 * 3600_000).aggregate, 5);
assert.equal(O.pickFrame(5 * 86400_000).aggregate, 15);
assert.equal(O.pickFrame(30 * 86400_000).timeframe, "hour");
assert.equal(O.pickFrame(400 * 86400_000).aggregate, 12);
assert.equal(O.pickFrame(5 * 365 * 86400_000).timeframe, "day", "older than everything: the coarsest there is");

// ---- entry, last, peak ----
const bars = [
  bar("2026-10-06T22:00:00Z", 1, 1.2, 0.9, 1.0),
  bar("2026-10-06T22:01:00Z", 1.0, 2.5, 1.0, 2.0), // the post lands in this bar
  bar("2026-10-06T22:02:00Z", 2.0, 6.0, 1.9, 4.0),
  bar("2026-10-06T22:03:00Z", 4.0, 4.1, 0.4, 0.5),
];
let m = O.measure(bars, T("2026-10-06T22:01:30Z"));
assert.equal(m.entry, 2.0, "the CLOSE of the bar the post landed in - not its low, not its high");
assert.equal(m.last, 0.5);
assert.equal(m.peak, 6.0, "the highest high after the entry bar");
assert.equal(m.pct, -75);
assert.equal(m.peakPct, 200);
assert.equal(m.basis, "post");

// the high of the entry bar itself is BEFORE the entry, and is not the caller's peak
m = O.measure(bars.slice(0, 2), T("2026-10-06T22:01:30Z"));
assert.equal(m.peak, 2.0);
assert.equal(m.peakPct, 0);

// today's price comes from the pool the token trades in NOW, when that is a different pool
m = O.measure(bars, T("2026-10-06T22:01:30Z"), { last: 0.02 });
assert.equal(m.last, 0.02);
assert.equal(m.pct, -99);

// a post older than the pool: nothing existed to buy, so the first trade is the entry - and it says so
m = O.measure(bars, T("2026-10-06T20:00:00Z"), { complete: true });
assert.equal(m.basis, "first_trade");
assert.equal(m.entry, 1, "the OPEN of the first bar");
assert.equal(m.peak, 6.0, "and every bar counts as after it");

// history that merely ran out is not the same thing, and gets no number at all
assert.equal(O.measure(bars, T("2026-10-06T20:00:00Z"), { complete: false }), null);
assert.equal(O.measure([], T("2026-10-06T22:01:30Z")), null);
assert.equal(O.measure([bar("2026-10-06T22:00:00Z", 0, 0, 0, 0)], T("2026-10-06T22:00:30Z")), null, "a zero entry divides nothing");

// ---- which pool: the real graduation ----
const CURVE = { address: "92VwjqY7Bhza", liquidity: 0, volume: 187829, createdAt: T("2026-10-06T22:07:50Z"), price: 0.00004955 };
const OPEN = { address: "DiwVYEjbcxUT", liquidity: 17402, volume: 35411, createdAt: T("2026-10-07T00:17:59Z"), price: 0.00004413 };

// The finished curve still shows five times the 24h volume and holds nothing.
assert.deepEqual(livePools([OPEN, CURVE]), [OPEN], "a pool the token has left is not where it trades");
// ...and a rug is the opposite case: drained to a few dollars, no successor, and it must still lead
const RUGGED = { address: "rug", liquidity: 3.4, volume: 84000, createdAt: T("2026-09-20T00:00:00Z") };
const DUST = { address: "dust", liquidity: 17, volume: 0, createdAt: T("2026-09-25T00:00:00Z") };
assert.deepEqual(livePools([DUST, RUGGED]).length, 2, "a few dollars left is not nothing, and dust supersedes no one");
const DRAINED = { ...RUGGED, liquidity: 0 };
assert.deepEqual(livePools([DUST, DRAINED]).length, 2, "even drained to zero: a $17 pool beside it is not a successor");
assert.deepEqual(livePools([CURVE]), [CURVE], "the only pool there is stays, whatever it holds");

// posted on the curve: priced on the curve, present read from the open pool
let pick = O.pickPools([OPEN, CURVE], T("2026-10-06T22:47:50Z"));
assert.equal(pick.entry.address, CURVE.address);
assert.equal(pick.live.address, OPEN.address);
// posted after graduation: one pool does both
pick = O.pickPools([OPEN, CURVE], T("2026-10-07T00:30:00Z"));
assert.equal(pick.entry.address, OPEN.address);
// posted before the token existed: its FIRST pool, so "first trade" means the token's first trade
pick = O.pickPools([OPEN, CURVE], T("2026-10-06T20:00:00Z"));
assert.equal(pick.entry.address, CURVE.address, "not the second pool's first trade, which is the graduation price");
assert.deepEqual(O.pickPools([], T("2026-10-06T20:00:00Z")), { live: null, entry: null });

// the tape's own picker has the same hole and the same fix, in Dexscreener's shapes
const dsCurve = { pairAddress: "92Vw", chainId: "solana", liquidity: null, volume: { h24: 187943.3 }, pairCreatedAt: 1791324470000 };
const dsOpen = { pairAddress: "DiwV", chainId: "solana", liquidity: { usd: 17257.22 }, volume: { h24: 39251.94 }, pairCreatedAt: 1791332279000 };
assert.equal(pickPair([dsCurve, dsOpen]).pairAddress, "DiwV", "the pool it trades in now, not the larger number");
assert.equal(pickPair([dsCurve]).pairAddress, "92Vw", "still on the curve: the curve is the pool");

// ---- one call, end to end, against stubbed sources ----
const dexBody = (pairs) => ({ pairs });
const dsPair = (p) => ({ chainId: "solana", pairAddress: p.address, liquidity: p.liquidity ? { usd: p.liquidity } : null, volume: { h24: p.volume }, pairCreatedAt: p.createdAt, priceUsd: String(p.price) });
const gt = (list) => ({ data: { attributes: { ohlcv_list: list.map((c) => [c.t, c.o, c.h, c.l, c.c, 1]) } } });
const KKK = "BTQ1RdUxu5LakcJGgpv2oJVWGz1sXR5z2iXcWJGQyX3F";
let asked = [];
const sources = ({ pairs = [dsPair(OPEN), dsPair(CURVE)], candles = bars, gtStatus = 200, dsStatus = 200 } = {}) => async (url) => {
  const u = String(url);
  asked.push(u);
  if (u.includes("dexscreener")) return { ok: dsStatus === 200, status: dsStatus, json: async () => dexBody(pairs) };
  return { ok: gtStatus === 200, status: gtStatus, json: async () => gt(candles) };
};
const NOW = T("2026-10-07T00:40:00Z");

asked = [];
let out = await O.readOutcome({ address: KKK, posted: T("2026-10-06T22:01:30Z") }, { fetchImpl: sources(), now: NOW });
assert.equal(out.status, "priced");
assert.equal(out.entry, 2.0);
assert.equal(out.last, OPEN.price, "the present is the open pool's price, not the dead curve's last bar");
assert.equal(out.peakFloor, true, "highs made in the newer pool were not read, and the peak says it is a floor");
assert.equal(asked.length, 2, "one request to each source - the candle source allows very few");
assert.match(asked[1], /networks\/solana\/pools\/92VwjqY7Bhza\/ohlcv\/minute\?aggregate=1&limit=1000/, "candles for the pool that was live at the post, at the finest size that reaches it");
assert.match(O.outcomeText(out), /since the post, peaked at least \+200%/);

// a record with no post time is measured from when it crossed the feed, and worded that way
out = await O.readOutcome({ address: KKK, at: T("2026-10-06T22:01:30Z") }, { fetchImpl: sources(), now: NOW });
assert.equal(out.since, "seen");
assert.match(O.outcomeText(out), /since it crossed your feed/);

// ---- every way it can have no number, kept apart ----
out = await O.readOutcome({ address: KKK, posted: NOW - 3600_000 }, { fetchImpl: sources({ pairs: [] }), now: NOW });
assert.equal(out.status, "none");
out = await O.readOutcome({ address: KKK, posted: NOW - 3600_000 }, { fetchImpl: sources({ gtStatus: 429 }), now: NOW });
assert.equal(out.status, "limited", "a rate limit is about us");
out = await O.readOutcome({ address: KKK, posted: NOW - 3600_000 }, { fetchImpl: sources({ dsStatus: 500 }), now: NOW });
assert.equal(out.status, "unreachable");
out = await O.readOutcome({ address: KKK, posted: NOW - 3600_000 }, { fetchImpl: sources({ gtStatus: 404 }), now: NOW });
assert.equal(out.status, "none", "the two sources disagreeing about a pool is not a finding");
// a full window that still starts after the post: history ran out
const full = Array.from({ length: 1000 }, (_, i) => ({ t: T("2026-10-06T23:00:00Z") / 1000 + i * 60, o: 1, h: 1, l: 1, c: 1 }));
out = await O.readOutcome({ address: KKK, posted: T("2026-10-06T22:30:00Z") }, { fetchImpl: sources({ pairs: [dsPair(CURVE)], candles: full }), now: NOW });
assert.equal(out.status, "early");
// a Solana mint that was folded to lowercase is not that mint any more
asked = [];
out = await O.readOutcome({ address: KKK.toLowerCase(), posted: NOW - 3600_000 }, { fetchImpl: sources(), now: NOW });
assert.equal(out.status, "unusable");
assert.equal(asked.length, 0, "and nothing is spent finding that out");
// an EVM call asks about its own chain, and other chains' pools are not its pools
asked = [];
out = await O.readOutcome({ address: "0x047d4c0b00000000000000000000000000000001", posted: NOW - 3600_000 }, { fetchImpl: sources(), now: NOW });
assert.equal(out.status, "none", "the stub only has Solana pairs");
assert.equal(O.chainOfCall({ address: KKK }), "solana");
assert.equal(O.chainOfCall({ address: KKK, chain: "base" }), "base", "a recorded chain wins");

// ---- the record's price half ----
const calls = (...pcts) => pcts.map((pct) => ({ out: pct === null ? { status: "none" } : { pct, peakPct: Math.max(0, pct) + 50 } }));
assert.equal(O.summarizeOutcomes(calls(null, null)), null, "nothing priced, nothing claimed");
let sum = O.summarizeOutcomes(calls(-95, -80, -60, 40, null));
assert.deepEqual(sum, { priced: 4, down50: 3, down90: 1, up: 1, doubled: 0, median: -70 });
assert.equal(O.sayOutcomes(sum), "3 of 4 priced calls are down more than half since the post, 1 is up. Median -70%.");
// two priced calls are two anecdotes
assert.equal(O.sayOutcomes(O.summarizeOutcomes(calls(-95, -99))), null, "below three there is no sentence");
assert.equal(O.sayOutcomes(O.summarizeOutcomes(calls(-10, -20, -30))), "0 of 3 priced calls are down more than half since the post. Median -20%.");

assert.equal(O.pctText(537.4), "+537%");
assert.equal(O.pctText(-39.84), "-39.8%");
assert.equal(O.pctText(0), "0%");
assert.equal(O.outcomeText({ status: "limited" }), "the price source is rate limiting - try again in a minute");
assert.equal(O.outcomeText({ pct: -40, peakPct: 5, basis: "first_trade" }), "-40% since its first trade");
assert.equal(O.outcomeText(null), "");

console.log("outcome: ok");
