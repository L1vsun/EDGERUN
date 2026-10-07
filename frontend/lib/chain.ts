// Live Solana flow, read in the visitor's browser from a public, keyless feed.
//
// There is no block to poll here the way there is on an EVM chain - no `eth_getLogs`, and a
// Solana node will not hand a browser every swap in a slot. What a browser CAN read is an
// index of the tape: Jupiter publishes, for the tokens trading hardest right now and the
// ones that launched most recently, how many buys and sells landed in the last five minutes,
// from how many wallets, how the holder count moved, and how the volume compares with the
// hour before. That is this file's whole input.
//
// So this is NOT "every transaction on the chain". It is the five-minute tape of what is
// trending and what just launched, refreshed every poll - and every label on the page says
// trades, not transfers, because that is what is being counted. Two hosts, in order: the
// keyless one has been announced for retirement and postponed with no date.

const HOSTS = ["https://lite-api.jup.ag", "https://api.jup.ag"];
const FEEDS = ["/tokens/v2/toptrending/5m?limit=50", "/tokens/v2/recent?limit=30"];
const SEARCH = "/tokens/v2/search?query=";

export const WINDOW_MS = 300_000; // the feed's own window: five minutes
const POLL_MS = 20_000;   // the window is five minutes; polling faster only costs bandwidth
const HIDDEN_MS = 90_000; // a backgrounded tab still refreshes, but slowly
const BACKOFF_MAX = 120_000;
const NEW_MS = 30 * 60_000; // "new launch": first traded inside the last half hour

// What everything else is priced against. Always busy, and never the interesting call.
const QUOTE = new Set([
  "So11111111111111111111111111111111111111112", // wrapped SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", // PYUSD
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", // jitoSOL
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", // mSOL
]);

export interface TokenStat {
  address: string;       // the mint, in its real casing
  symbol: string;
  isNew: boolean;        // first traded inside the last half hour
  trades: number;        // buys + sells in the last five minutes
  perMin: number;        // trades per minute
  traders: number;       // distinct wallets trading it in the window
  newHolders: number;    // holders gained in the window
  buys: number;
  sells: number;
  quote: boolean;        // a quote asset - SOL, a stable, a liquid-staking token
  top10: number;         // share of supply the ten largest wallets hold, 0..1
  mintOpen: boolean;     // the mint authority is still live
  verified: boolean;     // on the index's verified list
  accel: number;         // this window's volume rate against the last hour's, 1 = steady
  holders: number | null;
  launchpad: string | null;
  firstSeen: number;     // when it first traded, ms
  age: number;           // ms since then
}

export interface ChainState {
  ok: boolean;
  block: number;         // the newest slot any price in the feed was read at
  tradesPerMin: number;
  traders: number;
  tokens: TokenStat[];
}

async function get(path: string): Promise<any[]> {
  let last: unknown = null;
  for (const host of HOSTS) {
    try {
      const r = await fetch(`${host}${path}`, { headers: { Accept: "application/json" } });
      if (!r.ok) { last = new Error(`feed ${r.status}`); continue; }
      const body = await r.json();
      if (Array.isArray(body)) return body;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("the feed did not answer");
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** One row of the feed as the numbers everything downstream reads. Null when it has no tape. */
export function toStat(t: any, now: number): TokenStat | null {
  if (!t?.id) return null;
  const s5 = t.stats5m || {};
  const s1h = t.stats1h || {};
  const buys = n(s5.numBuys);
  const sells = n(s5.numSells);
  const trades = buys + sells;
  const holders = typeof t.holderCount === "number" ? t.holderCount : null;
  // holderChange is a percentage over the window; turn it back into a count of new holders
  const change = n(s5.holderChange);
  const newHolders = holders !== null && change > 0 ? Math.round(holders - holders / (1 + change / 100)) : 0;
  const vol5 = n(s5.buyVolume) + n(s5.sellVolume);
  const vol1h = n(s1h.buyVolume) + n(s1h.sellVolume);
  const created = Date.parse(t.firstPool?.createdAt || t.createdAt || "");
  const firstSeen = Number.isFinite(created) ? created : 0;
  const age = firstSeen ? Math.max(0, now - firstSeen) : 0;
  return {
    address: String(t.id),
    symbol: String(t.symbol || t.id).slice(0, 14),
    isNew: firstSeen > 0 && age < NEW_MS,
    trades,
    perMin: trades / 5,
    traders: n(s5.numTraders),
    newHolders,
    buys,
    sells,
    quote: QUOTE.has(String(t.id)),
    top10: Math.max(0, Math.min(1, n(t.audit?.topHoldersPercentage) / 100)),
    mintOpen: t.audit?.mintAuthorityDisabled === false,
    verified: t.isVerified === true,
    // Five minutes of volume against the hour's average five minutes. A token younger than
    // the hour has no hour to be measured against - its whole life IS the window, which
    // would read as twelve times its own average - so it reads as steady.
    accel: vol1h > 0 && vol5 > 0 && age >= 3_600_000 ? Math.min(12, (vol5 / 5) / (vol1h / 60)) : 1,
    holders,
    launchpad: t.launchpad || null,
    firstSeen,
    age,
  };
}

export function startChain(onState: (s: ChainState) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let lastGood: ChainState | null = null;   // a dropped poll should not blank the screen
  let backoff = 0;                          // grows on failure, resets on success

  async function poll() {
    const now = Date.now();
    try {
      const lists = await Promise.all(FEEDS.map((f) => get(f)));
      const by = new Map<string, TokenStat>();
      let slot = 0;
      for (const row of lists.flat()) {
        const stat = toStat(row, now);
        if (!stat || by.has(stat.address)) continue;
        // something with no trade in the window is not "moving", however recently it launched
        if (stat.trades > 0) by.set(stat.address, stat);
        slot = Math.max(slot, n(row.priceBlockId));
      }
      const tokens = [...by.values()].sort((a, b) => b.perMin - a.perMin);
      const state: ChainState = {
        ok: true,
        block: slot,
        tradesPerMin: tokens.reduce((s, t) => s + t.perMin, 0),
        traders: tokens.reduce((s, t) => s + t.traders, 0),
        tokens,
      };
      lastGood = state;
      backoff = 0;
      if (!stopped) onState(state);
    } catch {
      // Back off hard on failure. If the feed is rate-limiting a crowd, every tab retrying
      // at full speed is exactly what keeps it down.
      backoff = Math.min(BACKOFF_MAX, backoff ? backoff * 2 : POLL_MS * 2);
      if (!stopped) onState(lastGood ? { ...lastGood, ok: false } : { ok: false, block: 0, tradesPerMin: 0, traders: 0, tokens: [] });
    }
    if (stopped) return;
    // A hidden tab barely polls. Jitter keeps a crowd from landing on the feed together.
    const base = backoff || (typeof document !== "undefined" && document.hidden ? HIDDEN_MS : POLL_MS);
    timer = setTimeout(poll, base + Math.random() * base * 0.35);
  }

  poll();
  const onVisible = () => {
    if (!stopped && !document.hidden) {
      clearTimeout(timer);
      backoff = 0;
      poll();
    }
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);

  return () => {
    stopped = true;
    clearTimeout(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
  };
}

// ---- scan any token on demand ----
//
// Paste a mint and the same index is asked about that one token: the same five-minute tape,
// run through the same measurements as the live table.

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function scanToken(address: string): Promise<TokenStat> {
  const mint = address.trim();
  if (!MINT_RE.test(mint)) throw new Error("that is not a Solana mint");
  const rows = await get(`${SEARCH}${encodeURIComponent(mint)}`);
  const row = rows.find((r) => r?.id === mint);
  if (!row) throw new Error("the index does not know this mint - it may have no pool yet");
  const stat = toStat(row, Date.now());
  if (!stat) throw new Error("the index returned nothing readable for this mint");
  if (!stat.trades) throw new Error(`${stat.symbol}: no trades at all in the last five minutes`);
  return stat;
}

// ---- signals: the same facts, said in a way you can act on in one second ----
//
// Each is a plain threshold on measured activity, and each names the number that triggered
// it so it can be checked. None of them is advice or a price forecast. THE THRESHOLDS ARE
// DUPLICATED in brain/chain_snapshot.py - change one, change the other.

export type Tone = "bad" | "good" | "flat";
export interface Signal { id: string; label: string; tone: Tone; why: string }

const mins = (ms: number) => Math.max(1, Math.round(ms / 60_000));

export function signals(t: TokenStat): Signal[] {
  const out: Signal[] = [];
  const freshShare = t.traders ? t.newHolders / t.traders : 0;

  // A live mint authority on a token no list vouches for: supply can grow under the buyers.
  // A stablecoin or a liquid-staking token has one by design, which is what `verified` is for.
  if (t.mintOpen && !t.verified) {
    out.push({ id: "mintopen", label: "mint open", tone: "bad", why: "the mint authority is still live - new supply can be created at any time" });
  }
  if (t.top10 > 0.5 && t.trades >= 10 && !t.verified) {
    out.push({ id: "topheavy", label: "top-heavy", tone: "bad", why: `the ten largest wallets hold ${pctOf(t.top10)} of supply - a handful of holders, not a crowd` });
  }
  if (t.sells >= t.buys * 1.5 && t.trades >= 30) {
    out.push({ id: "sellers", label: "sellers lead", tone: "bad", why: `${t.sells} sells against ${t.buys} buys in five minutes - more leaving than arriving` });
  }
  if (t.buys >= t.sells * 1.5 && t.trades >= 30) {
    out.push({ id: "buyers", label: "buyers lead", tone: "good", why: `${t.buys} buys against ${t.sells} sells in five minutes` });
  }
  if (t.accel >= 2 && t.trades >= 20) {
    out.push({ id: "heating", label: "heating", tone: "good", why: `volume is running ${t.accel.toFixed(1)}x its own hourly average in the last five minutes` });
  }
  if (freshShare > 0.5 && t.traders >= 20) {
    out.push({ id: "fresh", label: "new holders", tone: "good", why: `${t.newHolders} new holders in five minutes, against ${t.traders} wallets trading it` });
  }
  if (t.accel <= 0.45 && t.trades >= 25) {
    out.push({ id: "cooling", label: "cooling", tone: "flat", why: `volume has fallen to ${t.accel.toFixed(1)}x its own hourly average - interest is draining` });
  }
  if (t.isNew) {
    out.push({ id: "new", label: "new launch", tone: "flat", why: `first traded ${mins(t.age)} minute${mins(t.age) === 1 ? "" : "s"} ago${t.launchpad ? ` on ${t.launchpad}` : ""}` });
  }
  return out;
}

const pctOf = (x: number) => `${Math.round(x * 100)}%`;

// How much a token deserves a glance: loud things first, weighted by how much is moving.
export function interest(t: TokenStat): number {
  const sig = signals(t);
  let s = 0;
  for (const x of sig) s += x.tone === "bad" ? 3 : x.tone === "good" ? 2.5 : 0.6;
  return s * Math.log10(10 + t.perMin) + Math.min(2, t.perMin / 400);
}

// ---- turning a token's numbers into something the circuit can smell ----
//
// A fly encodes an odour as a pattern across its 53 glomeruli. We give each measurement
// its own small block of glomeruli and light them in proportion to how extreme it is, so
// "what this token smells of" stays readable: a block is flow, a block is concentration,
// and so on. The assignment is ours; the wiring underneath is the fly's.

export const FEATURES = [
  { key: "flow", label: "trade rate", of: (t: TokenStat) => Math.log10(1 + t.perMin) / 2.5 },
  { key: "traders", label: "trader spread", of: (t: TokenStat) => Math.log10(1 + t.traders) / 2.2 },
  { key: "new", label: "new holders", of: (t: TokenStat) => (t.traders ? Math.min(1, t.newHolders / t.traders) : 0) },
  { key: "accel", label: "acceleration", of: (t: TokenStat) => Math.min(1, Math.log2(1 + t.accel) / 2) },
  { key: "conc", label: "top-10 share", of: (t: TokenStat) => t.top10 },
  { key: "mint", label: "mint open", of: (t: TokenStat) => (t.mintOpen ? 1 : 0) },
  { key: "sell", label: "sell pressure", of: (t: TokenStat) => (t.trades ? t.sells / t.trades : 0) },
  { key: "buy", label: "buy pressure", of: (t: TokenStat) => (t.trades ? t.buys / t.trades : 0) },
] as const;

export function odour(t: TokenStat, nGlom: number): number[] {
  const v = new Array(nGlom).fill(0);
  const per = Math.floor(nGlom / FEATURES.length);
  FEATURES.forEach((f, fi) => {
    const x = Math.max(0, Math.min(1, f.of(t) || 0));
    for (let k = 0; k < per; k++) {
      // more glomeruli recruited as the measurement gets stronger, as with odour concentration
      const thresh = k / per;
      v[fi * per + k] = x > thresh ? Math.min(1, (x - thresh) * per) : 0;
    }
  });
  return v;
}

export function featureVector(t: TokenStat): { label: string; value: number }[] {
  return FEATURES.map((f) => ({ label: f.label, value: Math.max(0, Math.min(1, f.of(t) || 0)) }));
}
