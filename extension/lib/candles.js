// Real price history, which Dexscreener does not carry.
//
// The market module reads the tape - volume and buy/sell counts per window - and that is the
// part that works as evidence. This is the other thing people actually want when they open a
// token: what the price has been doing, at a timeframe they choose.
//
// ---- why GeckoTerminal ----
//
// Dexscreener's public token endpoint has no OHLC at all, so the first version of this shipped
// a table and said plainly that there was no chart. GeckoTerminal's on-chain API does have
// one, it is keyless, and - the part that was not obvious and had to be checked - it covers
// Robinhood Chain. Verified live on 2026-09-28:
//
//   /networks/robinhood/pools/0x4864…a6ea/ohlcv/hour  -> 8 hourly candles, real OHLCV
//   /networks/solana/tokens/pumpCmX…/pools            -> 20 pools, deepest $24.6m
//   aggregate=15 on minute, 4 on hour, 1 on day       -> all return candles
//
// So the timeframes below are not a guess at what the API might support; each one was run.
//
// ---- rate limits ----
//
// The free tier is somewhere around 30 calls a minute and it is not generous: enumerating
// their network list while building this was enough to earn a 429. So a chart is only ever
// fetched when a reader asks for one, results are cached per pool and timeframe, and a 429 is
// reported as "ask again in a moment" rather than as an error about the token.

import { ALL, CHAINS, SOLANA_GT } from "./chains.js";

const API = "https://api.geckoterminal.com/api/v2";

/**
 * The timeframes offered, each one verified against the live API.
 *
 * `limit` is chosen so every chart covers a comparable span of real time rather than a
 * comparable number of bars: 96 fifteen-minute candles is a day, 84 four-hour candles is two
 * weeks. A chart whose x-axis silently means something different per tab is a chart that
 * invites the wrong comparison.
 */
export const TIMEFRAMES = [
  { key: "15m", timeframe: "minute", aggregate: 15, limit: 96, label: "15m", span: "24 hours" },
  { key: "1h", timeframe: "hour", aggregate: 1, limit: 72, label: "1H", span: "3 days" },
  { key: "4h", timeframe: "hour", aggregate: 4, limit: 84, label: "4H", span: "2 weeks" },
  { key: "1d", timeframe: "day", aggregate: 1, limit: 90, label: "1D", span: "3 months" },
];

export const DEFAULT_TIMEFRAME = "1h";

/** Our chain key, or a Dexscreener chainId, to GeckoTerminal's own network slug. */
export function gtNetwork(chain) {
  if (!chain) return null;
  const c = String(chain).toLowerCase();
  if (c === "solana") return SOLANA_GT;
  if (CHAINS[c]?.gt) return CHAINS[c].gt;
  // Dexscreener reports the chain as its own slug ("robinhood", "bsc"), which usually but not
  // always matches ours, so fall back to matching on either.
  const hit = ALL.find((x) => x.dex === c || x.gt === c || x.key === c);
  return hit?.gt || null;
}

// Number(null) is 0 and Number("") is 0, so the obvious one-liner turns a MISSING value
// into a real zero. On a chart that is a crash that never happened; on a volume row it is
// a confident claim of no trading. Absent stays absent.
const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * GeckoTerminal answers `[unix, open, high, low, close, volume]`, newest first.
 *
 * Reversed here so a caller can draw left to right without thinking about it, and anything
 * with a missing close is dropped: a gap in the middle of a line chart drawn as a zero is a
 * crash that never happened, which is the chart equivalent of a false accusation.
 */
export function normalize(list) {
  return (list || [])
    .map((c) => ({ t: num(c?.[0]), o: num(c?.[1]), h: num(c?.[2]), l: num(c?.[3]), c: num(c?.[4]), v: num(c?.[5]) }))
    .filter((c) => c.t !== null && c.c !== null)
    .sort((a, b) => a.t - b.t);
}

/** What the chart says about the span it is showing - not a price call, just arithmetic. */
export function summarizeCandles(candles) {
  if (!candles?.length) return null;
  const first = candles[0];
  const last = candles[candles.length - 1];
  const highs = candles.map((c) => c.h ?? c.c);
  const lows = candles.map((c) => c.l ?? c.c);
  const open = first.o ?? first.c;
  return {
    open,
    close: last.c,
    high: Math.max(...highs),
    low: Math.min(...lows),
    changePct: open ? ((last.c - open) / open) * 100 : null,
    from: first.t,
    to: last.t,
    bars: candles.length,
  };
}

/** The deepest pool GeckoTerminal knows for this token on this network. */
export async function topPool(network, address, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${API}/networks/${network}/tokens/${encodeURIComponent(address)}/pools?page=1`, {
    headers: { Accept: "application/json" },
  });
  if (res?.status === 429) throw new Error("rate limited");
  // null from here means "answered, and knows of no pool". Anything else is an outage and has
  // to stay distinguishable from it, or a source being down reads as a token not existing.
  if (res?.status === 404) return null;
  if (!res?.ok) throw new Error("unreachable");
  const body = await res.json();
  const pools = (body?.data || [])
    .map((p) => ({
      // ids arrive network-prefixed ("solana_2uF4…"); the OHLCV route wants the bare address
      address: String(p.attributes?.address || p.id || "").replace(new RegExp(`^${network}_`), ""),
      liquidity: num(p.attributes?.reserve_in_usd) || 0,
      volume: num(p.attributes?.volume_usd?.h24) || 0,
      name: p.attributes?.name || null,
    }))
    .filter((p) => p.address);
  // Ranked by VOLUME, not by what is left in the pool. After a rug the pool that holds the
  // whole story has been drained to a few dollars, so ranking by liquidity hands back some
  // other near-empty pool with two bars in it - which is exactly what shipped: a chart of the
  // wrong pool for a token with fourteen of them.
  return pools.sort((a, b) => b.volume - a.volume || b.liquidity - a.liquidity)[0] || null;
}

/**
 * Candles for one pool.
 *
 * A 404 is reported as UNKNOWN POOL rather than as a failure, and the difference is the whole
 * reason this distinction exists: the pool id handed in here usually comes from Dexscreener,
 * and the two services do not have to agree on which pools exist or what to call them. They
 * happened to agree for every token used while building this, which is exactly the kind of
 * agreement that holds until the token somebody actually cares about.
 */
export async function ohlcv(network, pool, key, { fetchImpl = fetch } = {}) {
  const tf = TIMEFRAMES.find((t) => t.key === key) || TIMEFRAMES.find((t) => t.key === DEFAULT_TIMEFRAME);
  const url = `${API}/networks/${network}/pools/${encodeURIComponent(pool)}/ohlcv/${tf.timeframe}?aggregate=${tf.aggregate}&limit=${tf.limit}`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (res?.status === 429) throw new Error("rate limited");
  if (res?.status === 404) return { unknownPool: true };
  if (!res?.ok) return null;
  const body = await res.json();
  return normalize(body?.data?.attributes?.ohlcv_list);
}

/**
 * Price history for one token.
 *
 * `pool` is passed in when the caller already knows it - the market read has it - which saves
 * a call against a tight rate limit. Returns null when the source is unreachable and
 * `{ none: true }` when it answered and has no pool, the same two-outcome shape the market
 * module uses, for the same reason: they are different facts and the panel says so.
 */
export async function readCandles(address, { chain, pool, key = DEFAULT_TIMEFRAME, fetchImpl = fetch } = {}) {
  const network = gtNetwork(chain);
  if (!network) return { unsupported: true, chain: chain || null };
  try {
    let poolAddress = null;
    let poolName = null;
    let candles = null;

    /*
     * This source picks its own pool, and the hint is only a backstop.
     *
     * An earlier version took the pool id from the market read to save a call against a tight
     * rate limit. That was the wrong trade, and the token it broke on showed why: PAID has
     * FOURTEEN pools on this chain. The two services rank them differently, so the chart drew
     * whichever near-empty pool Dexscreener happened to call deepest - one bar, no history -
     * while the pool holding the entire rug sat a lookup away with $84k of volume in it.
     *
     * One extra request is worth strictly more than a chart of the wrong pool.
     */
    const top = await topPool(network, address, { fetchImpl });
    if (top) {
      poolAddress = top.address;
      poolName = top.name;
      const got = await ohlcv(network, poolAddress, key, { fetchImpl });
      if (got && !got.unknownPool && got.length) candles = got;
      else poolAddress = null;
    }

    // Only now does the hint get a turn, for when this source knows no pool but the other did.
    if (!candles && pool) {
      const got = await ohlcv(network, pool, key, { fetchImpl });
      if (got && !got.unknownPool && got.length) {
        candles = got;
        poolAddress = pool;
        poolName = null;
      }
    }

    if (!candles) return { none: true };

    if (!candles?.length) return { none: true };
    return { network, pool: poolAddress, poolName, key, candles, stats: summarizeCandles(candles), flags: priceFlags(candles) };
  } catch (err) {
    if (String(err?.message) === "rate limited") return { limited: true };
    return null; // unreachable, and the panel says that rather than blaming the token
  }
}

/**
 * What the price history says, when it says something a contract check cannot.
 *
 * Reported from the field 2026-09-28: a token that is a total rug on the chart came back
 * PASS. Both were correct. The contract really does mint nothing, freeze nobody and let its
 * holders transfer - it passes every question the bytecode can be asked - and the pool is
 * still down 99% with nobody left trading it. A rug does not require a malicious contract.
 * Very often the contract is fine and a person simply sold everything.
 *
 * So this is the second witness saying its piece. It is deliberately NOT folded into the
 * verdict: `scan()` must stay reproducible from chain state alone, and it must not get slower
 * or start failing because a chart API is having a bad day. What it does instead is refuse to
 * let the panel show a bare PASS next to a chart like that.
 *
 * Every one of these is a PRICE fact, worded as a price fact. A token being down 99% is not
 * evidence of fraud - plenty of honest things are down 99% - and this project does not turn
 * a loss into an accusation. Silence below the floors, as everywhere else here.
 */
export function priceFlags(candles) {
  const n = candles?.length || 0;
  // Five bars is the floor for saying anything at all. It used to be twenty, which is why the
  // token this was built for reported NOTHING on its 1h chart: nine bars, down 100%.
  if (n < 5) return [];

  const highs = candles.map((c) => c.h ?? c.c);
  const peak = Math.max(...highs);
  const peakIdx = highs.indexOf(peak);
  const last = candles[n - 1].c;
  if (!(peak > 0) || last == null || last < 0) return [];

  const out = [];
  const drawdown = (peak - last) / peak;
  const pct = (x) => `${(x * 100).toFixed(x >= 0.999 ? 3 : 1)}%`;

  /*
   * What this used to require, and why both requirements were wrong.
   *
   * There were two extra guards here: the peak had to be at least three bars old, and the
   * recent tail had to still be near the floor. Both were meant to stop a token mid-pump
   * reading as a rug. Neither was needed and both were harmful, as the field showed
   * immediately: PAID on Robinhood Chain peaked and collapsed INSIDE THE SAME CANDLE, so the
   * peak was the newest bar, and a 100.000% drawdown produced no finding at all.
   *
   * The drawdown is measured from the LAST CLOSE, so it already describes the present. A
   * token mid-pump is at its high, which makes its drawdown approximately zero - it can never
   * satisfy this test. A deep wick that recovered is the same story: recovered means the last
   * close is back near the peak, so the drawdown is small again. The guards were solving a
   * problem the arithmetic had already solved, at the cost of missing the real thing.
   *
   * How severe it has to be scales with how much history there is, so a handful of bars can
   * still report a wipeout while a gentler slide needs a longer window to be worth mentioning.
   */
  const severe = drawdown >= (n >= 20 ? 0.9 : n >= 10 ? 0.95 : 0.98);

  if (severe) {
    const fresh = peakIdx >= n - 2;
    out.push({
      id: "collapsed",
      status: "warn",
      detail: `Down ${pct(drawdown)} from its high in this window${fresh ? ", and the high was the most recent bar - this is happening now" : ""}. Anyone who bought near the top is not getting out at that price. This is what the pool did, not what the contract is: a contract that passes every check can sit on a chart like this, and usually the reason is that somebody sold all of it.`,
    });
  }

  // The full cycle inside one window: up a lot, then all the way back. Worth separating from
  // a plain decline, because the shape is the story - it means the top was real and brief.
  const open = candles[0].o ?? candles[0].c;
  if (open > 0 && peak / open >= 5 && severe) {
    out.push({
      id: "round_trip",
      status: "warn",
      detail: `It went up ${(peak / open).toFixed(0)}x and gave all of it back within this window. The whole move happened where you can see it, which means the exit happened here too.`,
    });
  }

  // A single bar doing most of the damage is the drain, not a decline.
  let worst = null;
  for (let i = 1; i < n; i++) {
    const o = candles[i].o ?? candles[i - 1].c;
    if (!(o > 0) || candles[i].c == null) continue;
    const fall = (o - candles[i].c) / o;
    if (fall >= 0.8 && (!worst || fall > worst.fall)) worst = { fall, i };
  }
  if (worst && drawdown >= 0.5) {
    out.push({
      id: "one_candle",
      status: "warn",
      detail: `One bar fell ${pct(worst.fall)} on its own. A decline spread over a window is a market changing its mind; a single bar doing nearly all of it is one transaction.`,
    });
  }

  // The aftermath: it used to trade and now it does not. Only meaningful where there WAS
  // volume before, so a token that never traded at all says nothing here.
  // This one really does need a long window: it compares two halves of it.
  const tailLen = Math.max(3, Math.round(n * 0.1));
  const half = Math.floor(n / 2);
  const early = n >= 20 ? candles.slice(0, half).reduce((s, c) => s + (c.v || 0), 0) : 0;
  const late = candles.slice(-tailLen).reduce((s, c) => s + (c.v || 0), 0);
  if (early > 1000 && late <= early * 0.01) {
    out.push({
      id: "abandoned",
      status: "warn",
      detail: `Trading has all but stopped: the most recent ${tailLen} bars carry under 1% of the volume of the first half of this window. Whatever was happening here has finished.`,
    });
  }

  return out;
}

const CW = 320;   // drawing width; the svg scales to the panel via viewBox
const CH = 104;   // price area
const VH = 22;    // volume strip under it

/**
 * A LOG price axis, which for this chart is not a preference.
 *
 * These are memecoin pools. A token that went from 0.004 to 0.9 and back to 0.0002 is an
 * ordinary week here, and on a linear axis that series is one spike and then a flat line
 * pinned to the bottom - the entire collapse, the part worth seeing, rendered as a straight
 * line at zero. Log spends the same vertical space on each tenfold move, so a 99% decline
 * looks like a 99% decline instead of like nothing.
 *
 * Falls back to linear when anything is zero or negative, because log(0) is -Infinity and one
 * of those turns the whole drawing into an empty box.
 */
export function priceScale(lo, hi, height) {
  const usable = height - 2;
  if (lo > 0 && hi > 0 && hi / lo > 1.0001) {
    const a = Math.log(lo);
    const b = Math.log(hi);
    return { log: true, y: (p) => height - ((Math.log(Math.max(p, Number.MIN_VALUE)) - a) / (b - a)) * usable - 1 };
  }
  const span = hi - lo || hi || 1;
  return { log: false, y: (p) => height - ((p - lo) / span) * usable - 1 };
}

export function candleSvg(candles) {
  const n = candles?.length || 0;
  if (!n) return "";
  const lows = candles.map((c) => (c.l ?? c.c));
  const highs = candles.map((c) => (c.h ?? c.c));
  const lo = Math.min(...lows);
  const hi = Math.max(...highs);
  const maxV = Math.max(...candles.map((c) => c.v || 0), 1);

  const step = CW / n;
  const bw = Math.max(1, Math.min(9, step * 0.68));
  const { y } = priceScale(lo, hi, CH);

  const bars = candles
    .map((c, i) => {
      const x = i * step + step / 2;
      const o = c.o ?? c.c;
      const up = c.c >= o;
      const cls = up ? "up" : "down";
      const yo = y(o);
      const yc = y(c.c);
      const top = Math.min(yo, yc);
      const h = Math.max(1, Math.abs(yc - yo)); // a doji still gets a visible line
      const vh = ((c.v || 0) / maxV) * VH;
      return `<line class="wick ${cls}" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y(c.h ?? c.c).toFixed(1)}" y2="${y(c.l ?? c.c).toFixed(1)}"/>`
        + `<rect class="body ${cls}" x="${(x - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"/>`
        + `<rect class="vol ${cls}" x="${(x - bw / 2).toFixed(1)}" y="${(CH + 6 + (VH - vh)).toFixed(1)}" width="${bw.toFixed(1)}" height="${vh.toFixed(1)}"/>`;
    })
    .join("");

  return `<svg class="cndl" viewBox="0 0 ${CW} ${CH + 6 + VH}" preserveAspectRatio="none" role="img" aria-label="price history">${bars}</svg>`;
}
