// What happened after the post.
//
// The account record has always stopped at the verdict: "nine of the forty-seven contracts
// this account posted came back flagged". That is checkable and it is the smaller half of
// what a reader wants to know. The larger half is what the price did afterwards, and the old
// note in lib/graph.js said plainly why it was missing - "needs price history that is not
// stored and was never fetched".
//
// It is fetched here, from the same keyless candle source the chart uses, and nothing about
// it needs a server: a post has a timestamp, a pool has candles, and the difference between
// the bar the post landed in and the last bar is arithmetic anyone can redo.
//
// ---- what the number is, exactly ----
//
//   entry - the CLOSE of the bar the post landed in. Not the low and not the open: a figure
//           flattering to neither side, and at most one bar after the post.
//   last  - the close of the newest bar in the pool the token trades in NOW.
//   peak  - the highest high after the entry bar, in the pool the post was priced in.
//
// ---- the trap, measured live 2026-10-07 ----
//
// A launchpad token trades in two pools in its life: the bonding curve, then - if it
// graduates - an open pool. The curve stops dead at graduation and keeps its last price
// forever. So a post made on the curve has its entry in one pool and its present in another,
// and reading both from the curve reports the graduation price as today's, for a token that
// has since gone to zero. Entry comes from the pool that was live at the post; the present
// comes from the pool that is live today.
//
// When the post is older than every pool the source knows, there is no bar to enter at. The
// first trade is used instead and the result SAYS SO (`basis: "first_trade"`), because "down
// 80% since the post" and "down 80% since it first traded" are different sentences.
//
// ---- what this is not ----
//
// It is not a judgement of the account. Somebody warning about a contract has still posted
// it, and its price falling afterwards is them being right. The record already carries that
// limit for verdicts and it applies here unchanged - which is why these numbers describe and
// never set an account's tone.

import { gtNetwork, livePools, ohlcv } from "./candles.js";
import { HOME, chainByKey } from "./chains.js";

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

// Each frame is the finest one whose 1000 bars still reach back past the post.
const FRAMES = [
  { timeframe: "minute", aggregate: 1, barSec: MIN },
  { timeframe: "minute", aggregate: 5, barSec: 5 * MIN },
  { timeframe: "minute", aggregate: 15, barSec: 15 * MIN },
  { timeframe: "hour", aggregate: 1, barSec: HOUR },
  { timeframe: "hour", aggregate: 4, barSec: 4 * HOUR },
  { timeframe: "hour", aggregate: 12, barSec: 12 * HOUR },
  { timeframe: "day", aggregate: 1, barSec: DAY },
];
const LIMIT = 1000;

/** The finest candle size that still covers a post this old. */
export function pickFrame(ageMs) {
  const ageSec = Math.max(0, Number(ageMs) || 0) / 1000;
  // 950, not 1000: a bar or two of slack so the entry bar is never the one that fell off
  const frame = FRAMES.find((f) => f.barSec * 950 >= ageSec) || FRAMES[FRAMES.length - 1];
  return { ...frame, limit: LIMIT };
}

/**
 * Entry, last and peak.
 *
 * `bars` are the candles of the pool that was live at the post. `last` is today's price in
 * the pool the token trades in NOW, which is a different pool for anything posted before a
 * graduation; when it is not given, the newest bar stands in. `complete` says the series
 * reaches back to the pool's very first bar - which is what makes "no bar before the post"
 * mean the post is older than the pool rather than that history ran out.
 *
 * Returns null when no honest entry exists.
 */
export function measure(bars, t0Ms, { complete = false, last = null } = {}) {
  const t0 = Math.floor(Number(t0Ms) / 1000);
  const list = bars || [];
  if (!list.length || !Number.isFinite(t0)) return null;

  let i = -1;
  for (let k = 0; k < list.length; k++) {
    if (list[k].t <= t0) i = k;
    else break;
  }

  let entry;
  let basis;
  let from;
  if (i >= 0) {
    entry = list[i].c;
    basis = "post";
    from = i + 1;
  } else if (complete) {
    // the post is older than the pool: there was nothing to buy when it was written
    entry = list[0].o ?? list[0].c;
    basis = "first_trade";
    from = 0;
  } else {
    return null; // history ran out before the post - not the same as the pool being younger
  }
  if (!(entry > 0)) return null;

  const now = last > 0 ? last : list[list.length - 1].c;
  if (!(now > 0)) return null;
  const peak = Math.max(entry, now, ...list.slice(from).map((c) => c.h ?? c.c));
  return {
    entry,
    last: now,
    peak,
    pct: ((now - entry) / entry) * 100,
    peakPct: ((peak - entry) / entry) * 100,
    basis,
  };
}

/**
 * Which pool the post should be priced in, and which one the token is in now.
 *
 * `live` is where it trades today. `entry` is the same pool when it already existed at the
 * post. Otherwise it is the youngest pool that did - for a launchpad token posted before
 * graduation, the bonding curve - and when NO pool existed yet it is the oldest one, so
 * "since its first trade" means the token's first trade and not its second pool's.
 */
export function pickPools(pools, t0Ms) {
  const ranked = livePools(pools).slice().sort((a, b) => b.volume - a.volume || b.liquidity - a.liquidity);
  const live = ranked[0] || null;
  if (!live) return { live: null, entry: null };
  if (!live.createdAt || live.createdAt <= t0Ms) return { live, entry: live };
  const dated = (pools || []).filter((p) => p.createdAt).sort((a, b) => a.createdAt - b.createdAt);
  const existed = dated.filter((p) => p.createdAt <= t0Ms);
  return { live, entry: existed[existed.length - 1] || dated[0] || live };
}

/** The chain a recorded call is on, for a source that has to be told. */
export const chainOfCall = (call) => call?.chain || (/^0x[0-9a-fA-F]{40}$/.test(String(call?.address || "")) ? HOME.key : "solana");

const DEX_TOKENS = "https://api.dexscreener.com/latest/dex/tokens/";

/**
 * A token's pools, from the tape rather than from the candle source.
 *
 * Deliberately Dexscreener: the candle source allows very few requests a minute, and
 * spending one of them to learn which pool to ask about halves how many calls can be priced
 * in a run. This answer also carries each pool's current price, which is the "now" half of
 * the sum.
 */
async function dexPools(address, slug, fetchImpl) {
  const res = await fetchImpl(`${DEX_TOKENS}${encodeURIComponent(address)}`, { headers: { Accept: "application/json" } });
  if (res?.status === 429) throw new Error("rate limited");
  if (!res?.ok) throw new Error("unreachable");
  const body = await res.json();
  return (body?.pairs || [])
    .filter((p) => p?.pairAddress && String(p.chainId) === slug)
    .map((p) => ({
      address: String(p.pairAddress),
      liquidity: Number(p.liquidity?.usd) || 0,
      volume: Number(p.volume?.h24) || 0,
      createdAt: Number(p.pairCreatedAt) || null,
      price: Number(p.priceUsd) || null,
    }));
}

/**
 * Price one call.
 *
 * `{ status }` is always present: "priced", "none" (no pool to price it in), "early"
 * (history does not reach the post), "limited" (rate limited - about us, never about the
 * token), "unreachable", or "unusable" (the record predates addresses keeping their case).
 * Never throws.
 *
 * One request to each source. When the post is older than the pool the token trades in now,
 * the highs made in that newer pool are not read - a second candle request per call is not
 * affordable - so the peak is a FLOOR and is marked as one (`peakFloor`).
 */
export async function readOutcome(call, { fetchImpl = fetch, now = Date.now() } = {}) {
  const address = String(call?.address || "");
  const t0 = Number(call?.posted || call?.at);
  if (!address || !Number.isFinite(t0)) return { status: "unusable" };
  // Base58 folded to lowercase is not the address any more. Records written before the graph
  // stopped folding them cannot be priced and must not be guessed at.
  if (!address.startsWith("0x") && !/[A-Z]/.test(address)) return { status: "unusable" };

  const chain = chainOfCall(call);
  const network = gtNetwork(chain);
  if (!network) return { status: "none" };

  try {
    const pools = await dexPools(address, chainByKey(chain)?.dex || chain, fetchImpl);
    const { live, entry } = pickPools(pools, t0);
    if (!live) return { status: "none" };

    const frame = pickFrame(now - t0);
    const bars = await ohlcv(network, entry.address, frame, { fetchImpl });
    // an unknown pool is the two sources disagreeing about what exists, not a finding
    if (!Array.isArray(bars) || !bars.length) return { status: "none" };

    const m = measure(bars, t0, { complete: bars.length < frame.limit, last: live.price });
    if (!m) return { status: "early" };
    return {
      status: "priced",
      ...m,
      since: call?.posted ? "post" : "seen",
      ...(live.address !== entry.address ? { peakFloor: true } : {}),
    };
  } catch (err) {
    return { status: /rate limited/.test(String(err?.message)) ? "limited" : "unreachable" };
  }
}

const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Below this many priced calls there is no pattern to report, only anecdotes. The same floor
// the tape uses for the same reason: a ratio from two data points is not evidence.
export const OUTCOME_MIN = 3;

/** The record's price half, counted. Null until anything has been priced. */
export function summarizeOutcomes(calls) {
  const priced = (calls || []).map((c) => c?.out).filter((o) => o && Number.isFinite(o.pct));
  if (!priced.length) return null;
  return {
    priced: priced.length,
    down50: priced.filter((o) => o.pct <= -50).length,
    down90: priced.filter((o) => o.pct <= -90).length,
    up: priced.filter((o) => o.pct > 0).length,
    doubled: priced.filter((o) => o.peakPct >= 100).length,
    median: median(priced.map((o) => o.pct)),
  };
}

export const pctText = (n) => {
  if (!Number.isFinite(n)) return "-";
  const r = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${r > 0 ? "+" : ""}${r}%`;
};

/** One sentence, or null when there are too few priced calls for a sentence to be fair. */
export function sayOutcomes(sum) {
  if (!sum || sum.priced < OUTCOME_MIN) return null;
  const parts = [`${sum.down50} of ${sum.priced} priced calls are down more than half since the post`];
  if (sum.up) parts.push(`${sum.up} ${sum.up === 1 ? "is" : "are"} up`);
  return `${parts.join(", ")}. Median ${pctText(sum.median)}.`;
}

/** What one call's line reads. */
export function outcomeText(out) {
  if (!out) return "";
  if (Number.isFinite(out.pct)) {
    const from = out.basis === "first_trade" ? "since its first trade" : out.since === "seen" ? "since it crossed your feed" : "since the post";
    const peak = out.peakPct >= 10 ? `, peaked ${out.peakFloor ? "at least " : ""}${pctText(out.peakPct)}` : "";
    return `${pctText(out.pct)} ${from}${peak}`;
  }
  return {
    none: "no pool found to price it in",
    early: "price history does not reach back to the post",
    limited: "the price source is rate limiting - try again in a minute",
    unreachable: "the price source did not answer",
    unusable: "recorded before this version - cannot be priced",
  }[out.status] || "";
}
