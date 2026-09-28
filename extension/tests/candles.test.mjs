// Price history, and the arithmetic under the chart.
//
// The assertions that matter here are about GAPS and about RATE LIMITS. A candle with no
// close drawn as a zero is a crash that never happened - the chart equivalent of a false
// accusation - and a 429 must read as "ask again in a moment", never as a fact about the
// token.
import assert from "node:assert/strict";
import {
  DEFAULT_TIMEFRAME, TIMEFRAMES, gtNetwork, normalize, ohlcv, readCandles, summarizeCandles, topPool,
} from "../lib/candles.js";

// ---- network slugs: theirs, not ours ----
// Verified against their live /networks listing on 2026-09-28.
assert.equal(gtNetwork("ethereum"), "eth", "their id for Ethereum is eth, not ethereum");
assert.equal(gtNetwork("robinhood"), "robinhood");
assert.equal(gtNetwork("solana"), "solana");
assert.equal(gtNetwork("base"), "base");
assert.equal(gtNetwork("arbitrum"), "arbitrum");
assert.equal(gtNetwork("bsc"), "bsc");
assert.equal(gtNetwork("Solana"), "solana", "case does not matter");
// Dexscreener reports the chain by its own slug, and the market read is where chain comes from
assert.equal(gtNetwork("eth"), "eth");
assert.equal(gtNetwork("nonsuch"), null);
assert.equal(gtNetwork(null), null);
assert.equal(gtNetwork(""), null);

// ---- every timeframe is one that was actually run against the API ----
assert.equal(TIMEFRAMES.length, 4);
assert.ok(TIMEFRAMES.every((t) => t.limit > 0 && t.aggregate > 0));
assert.ok(TIMEFRAMES.some((t) => t.key === DEFAULT_TIMEFRAME));
assert.deepEqual(TIMEFRAMES.map((t) => t.key), ["15m", "1h", "4h", "1d"]);

// ---- normalize: newest-first in, oldest-first out ----
const raw = [
  [3000, 2, 3, 1, 2.5, 100],
  [2000, 1, 2, 0.5, 2, 80],
  [1000, 1, 1.5, 0.9, 1, 60],
];
let n = normalize(raw);
assert.deepEqual(n.map((c) => c.t), [1000, 2000, 3000], "sorted oldest first so a chart draws left to right");
assert.equal(n[2].c, 2.5);
assert.equal(n[0].v, 60);

// a candle with no close is DROPPED, never zero-filled
n = normalize([[1000, 1, 1, 1, null, 5], [2000, 1, 1, 1, 2, 5]]);
assert.equal(n.length, 1, "a gap is a gap; drawing it as zero invents a crash");
assert.equal(n[0].t, 2000);
assert.deepEqual(normalize(null), []);
assert.deepEqual(normalize([]), []);
assert.deepEqual(normalize([[null, 1, 1, 1, 1, 1]]), [], "a candle with no timestamp cannot be placed");

// ---- summarize is arithmetic, not a price call ----
let s = summarizeCandles(normalize(raw));
assert.equal(s.open, 1);
assert.equal(s.close, 2.5);
assert.equal(s.high, 3);
assert.equal(s.low, 0.5);
assert.equal(Math.round(s.changePct), 150);
assert.equal(s.bars, 3);
assert.equal(summarizeCandles([]), null);
assert.equal(summarizeCandles(null), null);
// a zero open must not produce Infinity
assert.equal(summarizeCandles([{ t: 1, o: 0, h: 0, l: 0, c: 0 }]).changePct, null);

// ---- fakes ----
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const poolsBody = {
  data: [
    { id: "solana_aaa", attributes: { address: "aaa", reserve_in_usd: "1000", name: "A/B" } },
    { id: "solana_bbb", attributes: { address: "bbb", reserve_in_usd: "24676549", name: "PUMP/SOL" } },
  ],
};
const candleBody = { data: { attributes: { ohlcv_list: raw } } };

// ---- the deepest pool wins, and the network prefix is stripped ----
let p = await topPool("solana", "mint", { fetchImpl: async () => ok(poolsBody) });
assert.equal(p.address, "bbb");
assert.equal(p.name, "PUMP/SOL");
// ids arrive prefixed; the OHLCV route wants the bare address
p = await topPool("solana", "mint", {
  fetchImpl: async () => ok({ data: [{ id: "solana_ccc", attributes: { reserve_in_usd: "5" } }] }),
});
assert.equal(p.address, "ccc", "solana_ccc -> ccc");
assert.equal(await topPool("solana", "mint", { fetchImpl: async () => ok({ data: [] }) }), null);

// ---- the request carries the aggregate the timeframe asked for ----
let seen = null;
await ohlcv("robinhood", "0xpool", "4h", { fetchImpl: async (u) => { seen = u; return ok(candleBody); } });
assert.match(seen, /\/networks\/robinhood\/pools\/0xpool\/ohlcv\/hour\?aggregate=4&limit=84$/);
await ohlcv("solana", "bbb", "15m", { fetchImpl: async (u) => { seen = u; return ok(candleBody); } });
assert.match(seen, /ohlcv\/minute\?aggregate=15&limit=96$/);
// an unknown key falls back to the default rather than building a bad url
await ohlcv("solana", "bbb", "nonsense", { fetchImpl: async (u) => { seen = u; return ok(candleBody); } });
assert.match(seen, /ohlcv\/hour\?aggregate=1&limit=72$/);

// ---- readCandles: this source picks its own pool ----
//
// An earlier version took the pool id from the market read to save a call. The token that
// broke it has FOURTEEN pools on one chain: the two services rank them differently, so the
// chart drew whichever near-empty one Dexscreener called deepest - one bar, no history -
// while the pool holding the whole rug sat a lookup away with $84k of volume in it.
const urlFake = (pools, candles) => async (u) => (u.includes("/pools?") ? ok(pools) : ok(candles));

let r = await readCandles("mint", { chain: "solana", fetchImpl: urlFake(poolsBody, candleBody) });
assert.equal(r.candles.length, 3);
assert.equal(r.pool, "bbb");
assert.equal(r.stats.close, 2.5);

// the hint is IGNORED when this source has its own answer
r = await readCandles("mint", { chain: "solana", pool: "some-other-pool", fetchImpl: urlFake(poolsBody, candleBody) });
assert.equal(r.pool, "bbb", "the lookup wins over a hint from another service");

// ---- ranked by VOLUME, not by what is left in the pool ----
//
// After a rug the pool that holds the story has been drained to a few dollars. Ranking by
// liquidity hands back some other near-empty pool with two bars in it.
const ruggedPools = {
  data: [
    { id: "robinhood_drained", attributes: { address: "drained", reserve_in_usd: "608.96", volume_usd: { h24: "83959.76" }, name: "PAID / WETH 1%" } },
    { id: "robinhood_dust", attributes: { address: "dust", reserve_in_usd: "3.44", volume_usd: { h24: "36.31" }, name: "PAID / USDG 20%" } },
  ],
};
p = await topPool("robinhood", "0xpaid", { fetchImpl: async () => ok(ruggedPools) });
assert.equal(p.address, "drained", "the pool with the volume, not the one with the leftovers");

// liquidity only breaks a tie
p = await topPool("robinhood", "0xpaid", {
  fetchImpl: async () => ok({ data: [
    { id: "robinhood_a", attributes: { address: "a", reserve_in_usd: "10", volume_usd: { h24: "5" } } },
    { id: "robinhood_b", attributes: { address: "b", reserve_in_usd: "99", volume_usd: { h24: "5" } } },
  ] }),
});
assert.equal(p.address, "b");

// unreachable -> null; answered-with-nothing -> { none: true }; 429 -> { limited: true }
assert.equal(await readCandles("m", { chain: "solana", fetchImpl: async () => { throw new Error("dns"); } }), null);
assert.equal(await readCandles("m", { chain: "solana", fetchImpl: async () => ({ ok: false, status: 500 }) }), null);
assert.deepEqual(await readCandles("m", { chain: "solana", fetchImpl: async () => ok({ data: [] }) }), { none: true });
assert.deepEqual(await readCandles("m", { chain: "solana", fetchImpl: async () => ({ ok: false, status: 429 }) }), { limited: true },
  "a rate limit is about us, not about the token");

// a chain the chart source does not cover says so, rather than looking like an outage
assert.deepEqual(await readCandles("0xabc", { chain: "nonsuch", fetchImpl: async () => ok(candleBody) }),
  { unsupported: true, chain: "nonsuch" });

// ---- the hint is a backstop, for when this source knows no pool but the other did ----
const notFound = { ok: false, status: 404 };

let r2 = await readCandles("mint", {
  chain: "solana",
  pool: "only-known-elsewhere",
  fetchImpl: async (u) => (u.includes("/pools?") ? ok({ data: [] }) : ok(candleBody)),
});
assert.equal(r2.pool, "only-known-elsewhere", "no pool here, so the hint is tried");
assert.equal(r2.candles.length, 3);

// a hint this source has never heard of is not an error either
assert.deepEqual(
  await readCandles("mint", { chain: "solana", pool: "nonsense", fetchImpl: async (u) => (u.includes("/pools?") ? ok({ data: [] }) : notFound) }),
  { none: true },
);

// a pool this source knows but with NO candles falls through to the hint
r2 = await readCandles("mint", {
  chain: "solana",
  pool: "has-history",
  fetchImpl: async (u) =>
    u.includes("/pools?") ? ok(poolsBody)
      : u.includes("has-history") ? ok(candleBody)
      : ok({ data: { attributes: { ohlcv_list: [] } } }),
});
assert.equal(r2.pool, "has-history", "an empty top pool is not a final answer when a hint exists");

// ---- the drawing ----
//
// It lives in this module rather than in the panel precisely so it can be tested: a single
// NaN in a coordinate makes an SVG render as nothing at all, silently, and "the chart is
// blank" is the kind of bug that survives a hundred manual looks at a working token.
const { candleSvg } = await import("../lib/candles.js");

const series = normalize([
  [4000, 1.0, 1.4, 0.9, 1.2, 500],
  [3000, 0.8, 1.1, 0.7, 1.0, 300],
  [2000, 1.2, 1.3, 0.75, 0.8, 900],
  [1000, 1.1, 1.25, 1.0, 1.2, 100],
]);

let svg = candleSvg(series);
assert.match(svg, /^<svg class="cndl" viewBox="0 0 320 132"/);
assert.doesNotMatch(svg, /NaN|Infinity|undefined|null/, "one NaN coordinate renders the whole chart as nothing");
assert.equal((svg.match(/class="body /g) || []).length, 4, "one body per candle");
assert.equal((svg.match(/class="wick /g) || []).length, 4);
assert.equal((svg.match(/class="vol /g) || []).length, 4);

// every coordinate must land inside the viewBox
for (const [, v] of svg.matchAll(/(?:x|y)1?2?="([-\d.]+)"/g)) {
  const val = Number(v);
  assert.ok(Number.isFinite(val) && val >= -1 && val <= 333, `coordinate out of the box: ${v}`);
}

// a perfectly flat series divides by a zero range
svg = candleSvg(normalize([[2000, 5, 5, 5, 5, 10], [1000, 5, 5, 5, 5, 10]]));
assert.doesNotMatch(svg, /NaN/);
assert.equal((svg.match(/class="body /g) || []).length, 2);

// a doji still gets a visible body
assert.match(candleSvg(normalize([[1000, 3, 4, 2, 3, 5]])), /class="body up" x="[\d.]+" y="[\d.]+" width="[\d.]+" height="1\.0"/);

// zero volume everywhere must not divide by zero either
assert.doesNotMatch(candleSvg(normalize([[1000, 1, 2, 1, 2, 0], [2000, 2, 3, 2, 3, 0]])), /NaN/);

assert.equal(candleSvg([]), "");
assert.equal(candleSvg(null), "");

// 90 bars, the widest timeframe, still fits
svg = candleSvg(normalize(Array.from({ length: 90 }, (_, i) => [1000 + i * 60, 1 + i * 0.01, 1.2 + i * 0.01, 0.9 + i * 0.01, 1.1 + i * 0.01, i])));
assert.equal((svg.match(/class="body /g) || []).length, 90);
assert.doesNotMatch(svg, /NaN/);
const widths = [...svg.matchAll(/class="body [a-z]+" x="[-\d.]+" y="[-\d.]+" width="([\d.]+)"/g)].map((m) => Number(m[1]));
assert.ok(widths.every((w) => w >= 1), "a body narrower than a pixel reads as missing data, so it is floored at one");

// ---- the log axis ----
//
// Not a preference. On a linear axis a pool that went 0.004 -> 0.9 -> 0.0002 is one spike and
// then a flat line pinned to the floor: the collapse, the part worth seeing, drawn as nothing.
const { priceScale, priceFlags } = await import("../lib/candles.js");

let sc = priceScale(0.0002, 0.9, 104);
assert.equal(sc.log, true);
// the midpoint of a log axis is the GEOMETRIC mean, which is the whole point
const mid = Math.sqrt(0.0002 * 0.9);
assert.ok(Math.abs(sc.y(mid) - 52) < 2, "the geometric mean sits halfway up a log axis");
// on a linear axis that same price would be crushed against the floor
const lin = priceScale(0.0002, 0.9, 104);
assert.ok(sc.y(0.002) < 90, "a 10x-above-the-floor price is well clear of the bottom on log");

// bounds hold at both ends
assert.ok(Math.abs(sc.y(0.9) - 1) < 0.01, "the high sits at the top");
assert.ok(Math.abs(sc.y(0.0002) - 103) < 0.01, "the low sits at the bottom");

// log(0) is -Infinity and one of those empties the whole drawing
assert.equal(priceScale(0, 5, 104).log, false, "a zero low falls back to linear");
assert.equal(priceScale(-1, 5, 104).log, false);
assert.equal(priceScale(5, 5, 104).log, false, "a flat series has no ratio to take a log of");
for (const s of [priceScale(0, 5, 104), priceScale(5, 5, 104), priceScale(-1, 5, 104)]) {
  assert.ok(Number.isFinite(s.y(1)) && Number.isFinite(s.y(5)));
}

// a real rug, drawn: every coordinate finite, none crushed off the canvas
const rugSeries = normalize([
  ...Array.from({ length: 30 }, (_, i) => [5000 - i * 60, 0.0002, 0.00022, 0.00018, 0.0002, 1]),
  ...Array.from({ length: 30 }, (_, i) => [3200 - i * 60, 0.9, 0.95, 0.85, 0.9, 900000]),
]);
const rugSvg = candleSvg(rugSeries);
assert.doesNotMatch(rugSvg, /NaN|Infinity/);

// ---- the rug, detected ----
//
// Reported from the field: a token that is a total rug on the chart came back PASS. Both were
// true at once - the contract passes every question bytecode can be asked, and the pool is
// down 99% with nobody left in it. A rug does not require a malicious contract.
const rug = normalize([
  // newest first, as the API sends: a long dead tail, one collapse bar, then the good times
  ...Array.from({ length: 24 }, (_, i) => [9000 - i * 60, 0.001, 0.0011, 0.0009, 0.001, 2]),
  [7500, 0.5, 0.5, 0.001, 0.001, 400000],
  ...Array.from({ length: 30 }, (_, i) => [7440 - i * 60, 0.5, 0.55, 0.45, 0.5, 90000]),
  ...Array.from({ length: 6 }, (_, i) => [5600 - i * 60, 0.05, 0.06, 0.04, 0.05, 40000]),
]);
let f = priceFlags(rug);
const ids = f.map((x) => x.id);
assert.ok(ids.includes("collapsed"), "down 99.8% from peak and still there");
assert.ok(ids.includes("round_trip"), "10x up, then all of it back, inside one window");
assert.ok(ids.includes("one_candle"), "one bar did nearly all of the damage");
assert.ok(ids.includes("abandoned"), "and nobody trades it now");
assert.match(f.find((x) => x.id === "collapsed").detail, /Down 99\.\d+% from its high/);
// it is worded as a price fact, never as fraud - plenty of honest things are down 99%
assert.match(f.find((x) => x.id === "collapsed").detail, /a contract that passes every check can sit on a chart like this/);
assert.ok(f.every((x) => x.status === "warn"), "a loss is never a FAIL");

// ---- the shape that shipped broken: PAID on Robinhood Chain, 2026-09-28 ----
//
// It peaked and collapsed inside the SAME candle, so the peak was the newest bar. The old
// guards - "the peak must be at least three bars old" and "the tail must already be near the
// floor" - were written to stop a token mid-pump reading as a rug, and between them they
// suppressed a 100.000% drawdown. Real numbers: high 8.805e-5, close 1.674e-12.
const paid = normalize([
  [9000, 8.805e-5, 8.805e-5, 1.674e-12, 1.674e-12, 48000],
  ...Array.from({ length: 8 }, (_, i) => [8940 - i * 60, 2e-5 + i * 1e-6, 3e-5, 1.5e-5, 2.2e-5, 5000]),
]);
assert.equal(paid.length, 9, "nine bars, which the old twenty-bar floor also rejected");
let paidFlags = priceFlags(paid);
assert.ok(paidFlags.some((x) => x.id === "collapsed"), "a 100% drawdown is a finding even when it happened this bar");
assert.match(paidFlags.find((x) => x.id === "collapsed").detail, /Down 100\.000% from its high/);
assert.match(paidFlags.find((x) => x.id === "collapsed").detail, /the high was the most recent bar - this is happening now/);
assert.ok(paidFlags.some((x) => x.id === "one_candle"));

// the severity floor scales with how much history there is: a shallow slide over nine bars
// is still nothing, so the shorter window did not simply become less careful
const slide = normalize(Array.from({ length: 9 }, (_, i) => [9000 - i * 60, 1, 1, 0.5, i === 0 ? 0.55 : 1, 100]));
assert.equal(priceFlags(slide).filter((x) => x.id === "collapsed").length, 0, "-45% over nine bars says nothing");

// ---- and the silences, which matter more ----
const healthy = normalize(Array.from({ length: 60 }, (_, i) => [9000 - i * 60, 1 + (i % 5) * 0.02, 1.1, 0.95, 1 + (i % 7) * 0.01, 5000]));
assert.deepEqual(priceFlags(healthy), [], "ordinary chop is not a rug");

// a token merely DOWN is not a rug: -60% says nothing here
const down60 = normalize(Array.from({ length: 60 }, (_, i) => [9000 - i * 60, 1, 1, 1, i < 30 ? 0.4 : 1, 5000]));
assert.equal(priceFlags(down60).filter((x) => x.id === "collapsed").length, 0);

// a deep wick that RECOVERED is volatility, not a collapse
const wick = normalize([
  ...Array.from({ length: 30 }, (_, i) => [9000 - i * 60, 1, 1.05, 0.95, 1, 5000]),
  [7100, 1, 1, 0.01, 0.02, 9000],
  ...Array.from({ length: 30 }, (_, i) => [7040 - i * 60, 1, 1.05, 0.95, 1, 5000]),
]);
assert.equal(priceFlags(wick).filter((x) => x.id === "collapsed").length, 0,
  "it came back, so it never stuck at the floor");

// mid-pump must never read as a rug - the peak being the newest bar is the giveaway
const pumping = normalize(Array.from({ length: 40 }, (_, i) => [9000 - i * 60, 1, 40 - i, 1, 40 - i, 9000]));
assert.equal(priceFlags(pumping).filter((x) => x.id === "collapsed").length, 0);

// too few bars to know what a peak even is
assert.deepEqual(priceFlags(rug.slice(-10)), []);
assert.deepEqual(priceFlags([]), []);
assert.deepEqual(priceFlags(null), []);

// a token that never traded says nothing about being abandoned
const quiet = normalize(Array.from({ length: 60 }, (_, i) => [9000 - i * 60, 1, 1, 1, 1, 0]));
assert.equal(priceFlags(quiet).filter((x) => x.id === "abandoned").length, 0);

console.log("candles: ok");
