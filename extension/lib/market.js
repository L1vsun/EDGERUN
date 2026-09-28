// What the trades say, which is a different witness from what the contract says.
//
// Every other check in this project asks the contract a question. This one asks the market,
// and it is worth having because the two can disagree in a way that is itself the finding:
// a contract whose code looks clean, on a pool where four hundred people bought and three
// sold, is telling you something the bytecode did not.
//
// That is the frame. NOT a price widget - the price is the least useful number here and it
// is one tap away on Dexscreener anyway. What this adds is the shape of the flow, across the
// timeframes the API actually carries, because the shape is evidence and the price is noise.
//
// ---- what is available, and what is not ----
//
// Dexscreener's public token endpoint is keyless, needs no CORS workaround, and does cover
// Robinhood Chain (verified live 2026-09-28: chainId "robinhood", 30 pairs for TSLA). It
// carries volume and buy/sell counts at m5 / h1 / h6 / h24, price change at h1 / h6 / h24,
// liquidity, FDV and the pair's creation time.
//
// It does NOT carry OHLC candles. There is no honest way to draw a candlestick chart from
// this, so this module does not pretend to: it reports the numbers that exist and says
// nothing about the ones that do not.

const ENDPOINT = "https://api.dexscreener.com/latest/dex/tokens/";

/** The windows the API actually reports, newest first. */
export const WINDOWS = [
  { key: "m5", label: "5m" },
  { key: "h1", label: "1h" },
  { key: "h6", label: "6h" },
  { key: "h24", label: "24h" },
];

// Number(null) is 0 and Number("") is 0, so the obvious one-liner turns a MISSING value
// into a real zero. On a chart that is a crash that never happened; on a volume row it is
// a confident claim of no trading. Absent stays absent.
const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * One token can have thirty pools. The deepest one is the one whose numbers describe what
 * would actually happen to somebody trading, so it leads - a lopsided flow in a pool holding
 * forty dollars is not evidence of anything.
 */
export function pickPair(pairs, { chain } = {}) {
  const usable = (pairs || []).filter((p) => p && p.pairAddress);
  const scoped = chain ? usable.filter((p) => String(p.chainId) === String(chain)) : usable;
  const pool = scoped.length ? scoped : usable;
  // Ranked by VOLUME first. Liquidity alone picks the wrong pool for exactly the token this
  // matters most on: after a rug the pool holding the whole story has been drained to a few
  // dollars, so the deepest pool is some other one with nothing in it and nothing to say.
  const vol = (p) => num(p.volume?.h24) || 0;
  const liq = (p) => num(p.liquidity?.usd) || 0;
  return pool.slice().sort((a, b) => vol(b) - vol(a) || liq(b) - liq(a))[0] || null;
}

/**
 * Findings, not decoration - so the same discipline applies as everywhere else here: every
 * one of these has a floor under it, because a ratio computed from four trades is a ratio
 * that means nothing, and this project's characteristic bug is saying something confident
 * about too little.
 */
export function marketFlags(pair, now = Date.now()) {
  const out = [];
  if (!pair) return out;

  const t24 = pair.txns?.h24 || {};
  const buys = num(t24.buys) || 0;
  const sells = num(t24.sells) || 0;
  const liq = num(pair.liquidity?.usd);

  // The honeypot shape. People got in; nobody got out. This corroborates a failed exit test
  // from the other direction - simulation says they cannot move it, the tape says they did
  // not - and on its own it is still only a reason to look, which is what it says.
  if (buys >= 25 && sells === 0) {
    out.push({
      id: "no_sells", status: "warn",
      detail: `${buys} buys and no sells at all in 24h. Money went in and none came out - the shape a token has when holders cannot sell, though a brand-new pool can look like this honestly for a while.`,
    });
  } else if (buys >= 40 && sells > 0 && buys / sells >= 12) {
    out.push({
      id: "lopsided", status: "warn",
      detail: `${buys} buys against ${sells} sells in 24h. Heavily one-directional; worth knowing why before adding to it.`,
    });
  }

  const created = num(pair.pairCreatedAt);
  if (created && now - created < 24 * 3600_000) {
    const hours = Math.max(1, Math.round((now - created) / 3600_000));
    out.push({
      id: "new_pair", status: "warn",
      detail: `This pool is about ${hours} hour${hours === 1 ? "" : "s"} old. A contract that passes every check on a pool this young has not been through anything yet.`,
    });
  }

  if (liq !== null && liq < 5000 && (buys + sells) > 0) {
    out.push({
      id: "thin", status: "warn",
      detail: `About $${Math.round(liq).toLocaleString()} of liquidity. At this depth an ordinary-sized order moves the price a long way, whatever the contract does.`,
    });
  }

  return out;
}

/** The per-window table the panel draws. Nulls stay null; a missing number is not a zero. */
export function windows(pair) {
  return WINDOWS.map(({ key, label }) => ({
    key,
    label,
    volume: num(pair?.volume?.[key]),
    change: num(pair?.priceChange?.[key]),
    buys: num(pair?.txns?.[key]?.buys),
    sells: num(pair?.txns?.[key]?.sells),
  }));
}

export function summarize(pair, now = Date.now()) {
  if (!pair) return null;
  return {
    chain: pair.chainId || null,
    dex: pair.dexId || null,
    pairAddress: pair.pairAddress || null,
    url: pair.url || null,
    symbol: pair.baseToken?.symbol || null,
    quote: pair.quoteToken?.symbol || null,
    priceUsd: num(pair.priceUsd),
    liquidityUsd: num(pair.liquidity?.usd),
    fdv: num(pair.fdv),
    createdAt: num(pair.pairCreatedAt),
    windows: windows(pair),
    flags: marketFlags(pair, now),
  };
}

/**
 * Read the market for one token.
 *
 * Three outcomes, and keeping them apart matters. `null` means the source could not be
 * reached, which says nothing about the token. `{ none: true }` means the source answered and
 * knows of no pool - different, and worth showing, because a token being pushed hard with
 * nowhere to trade it is a fact about the push. It is still reported as unresolved rather
 * than as a warning: Dexscreener not indexing a pool is not the same as the pool not
 * existing, and this project does not turn an absence into an accusation.
 *
 * Never throws. This is corroboration, and a corroborating source that is down must not be
 * able to take a verdict down with it.
 */
export async function readMarket(address, { fetchImpl = fetch, chain, now = Date.now() } = {}) {
  try {
    const res = await fetchImpl(`${ENDPOINT}${encodeURIComponent(address)}`, { headers: { Accept: "application/json" } });
    if (!res?.ok) return null;
    const body = await res.json();
    const pair = pickPair(body?.pairs, { chain });
    if (!pair) return { none: true };
    return summarize(pair, now);
  } catch {
    return null;
  }
}
