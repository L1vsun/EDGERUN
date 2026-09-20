// Live Robinhood Chain activity, read straight from the public RPC in the visitor's
// browser (it sends access-control-allow-origin: *). No backend, no API key.
//
// Keeps a rolling window of ERC-20 Transfer logs and DEX swaps and turns them into
// per-token numbers that mean something to a trader: how fast a token is moving, how
// many distinct wallets are involved, how much of the flow is one address, whether
// supply is being minted, and whether any of that is accelerating.

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const SWAP_V3 = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";
const SWAP_V2 = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
const ZERO = "0x" + "0".repeat(64);

export const WINDOW_MS = 180_000; // 3 minutes of history
const RECENT_MS = 45_000; // "now" slice used for the acceleration reading
const MAX_BLOCKS = 140; // cap per poll so a slow tab samples instead of backfilling
const POLL_MS = 5000;

export interface TokenStat {
  address: string;
  symbol: string;
  isNew: boolean;       // first appeared after this page was opened
  transfers: number;
  perMin: number;
  wallets: number;
  newWallets: number;
  mints: number;
  burns: number;
  swaps: number;
  concentration: number; // share of transfers that touch the single busiest wallet
  accel: number; // recent rate vs the whole window, 1 = steady
  firstSeen: number;
  age: number; // ms since we first saw it
}

export interface ChainState {
  ok: boolean;
  block: number;
  txPerSec: number;
  transfersPerMin: number;
  wallets: number;
  tokens: TokenStat[];
  lag: number; // blocks we skipped because we could not keep up
}

interface Ev {
  t: number;
  token: string;
  from: string;
  to: string;
}

async function rpc(body: unknown): Promise<any> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("rpc " + r.status);
  return r.json();
}

function decodeString(hex?: string | null): string | null {
  if (!hex || hex.length < 130) return null;
  try {
    const len = parseInt(hex.slice(66, 130), 16);
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(parseInt(hex.slice(130 + i * 2, 132 + i * 2), 16));
    return s.replace(/[^\x20-\x7e]/g, "").trim() || null;
  } catch {
    return null;
  }
}

export function startChain(onState: (s: ChainState) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const sessionStart = Date.now();
  const SETTLE_MS = 20_000;  // anything seen in the first moments was already there, not new
  let events: Ev[] = [];
  let lastBlock = 0;
  let lastAt = 0;
  let txSeen = 0;
  let lag = 0;
  const symbols = new Map<string, string>();
  const pending = new Set<string>();
  const poolTokens = new Map<string, string[]>();
  const poolPending = new Set<string>();
  const firstSeen = new Map<string, number>();
  const walletFirst = new Map<string, number>();
  let swapEvents: { t: number; pool: string }[] = [];

  async function resolveSymbols(addrs: string[]) {
    const want = addrs.filter((a) => !symbols.has(a) && !pending.has(a)).slice(0, 12);
    if (!want.length) return;
    want.forEach((a) => pending.add(a));
    try {
      const res = await rpc(
        want.map((a, i) => ({ jsonrpc: "2.0", id: i, method: "eth_call", params: [{ to: a, data: "0x95d89b41" }, "latest"] })),
      );
      for (const r of res) symbols.set(want[r.id], decodeString(r.result) || want[r.id].slice(0, 8));
    } catch {
      /* try again next poll */
    } finally {
      want.forEach((a) => pending.delete(a));
    }
  }

  async function resolvePools(pools: string[]) {
    const want = pools.filter((p) => !poolTokens.has(p) && !poolPending.has(p)).slice(0, 6);
    if (!want.length) return;
    want.forEach((p) => poolPending.add(p));
    try {
      const calls: any[] = [];
      want.forEach((p, i) => {
        calls.push({ jsonrpc: "2.0", id: `${i}a`, method: "eth_call", params: [{ to: p, data: "0x0dfe1681" }, "latest"] });
        calls.push({ jsonrpc: "2.0", id: `${i}b`, method: "eth_call", params: [{ to: p, data: "0xd21220a7" }, "latest"] });
      });
      const res = await rpc(calls);
      const by: Record<string, string> = {};
      for (const r of res) if (r.result) by[r.id] = "0x" + r.result.slice(-40);
      want.forEach((p, i) => {
        const t = [by[`${i}a`], by[`${i}b`]].filter(Boolean) as string[];
        if (t.length) poolTokens.set(p, t);
      });
    } catch {
      /* try again next poll */
    } finally {
      want.forEach((p) => poolPending.delete(p));
    }
  }

  function summarise(now: number): ChainState {
    const cut = now - WINDOW_MS;
    events = events.filter((e) => e.t >= cut);
    swapEvents = swapEvents.filter((e) => e.t >= cut);
    const span = Math.max(15_000, now - (events.length ? events[0].t : now));
    const recentCut = now - RECENT_MS;

    const per = new Map<string, { n: number; recent: number; w: Map<string, number>; fresh: Set<string>; mint: number; burn: number }>();
    const allWallets = new Set<string>();
    for (const e of events) {
      let s = per.get(e.token);
      if (!s) per.set(e.token, (s = { n: 0, recent: 0, w: new Map(), fresh: new Set(), mint: 0, burn: 0 }));
      s.n++;
      if (e.t >= recentCut) s.recent++;
      if (e.from === ZERO) s.mint++;
      else if (e.to === ZERO) s.burn++;
      for (const a of [e.from, e.to]) {
        if (a === ZERO) continue;
        s.w.set(a, (s.w.get(a) || 0) + 1);
        allWallets.add(a);
        if ((walletFirst.get(a) ?? now) > sessionStart + SETTLE_MS) s.fresh.add(a);
      }
    }

    const swapsPerToken = new Map<string, number>();
    for (const s of swapEvents) {
      for (const t of poolTokens.get(s.pool) || []) swapsPerToken.set(t, (swapsPerToken.get(t) || 0) + 1);
    }

    const tokens: TokenStat[] = [];
    for (const [address, s] of per) {
      let top = 0;
      for (const v of s.w.values()) if (v > top) top = v;
      const windowRate = s.n / (span / 60000);
      const recentRate = s.recent / (Math.min(RECENT_MS, span) / 60000);
      const seen = firstSeen.get(address) ?? now;
      tokens.push({
        address,
        symbol: symbols.get(address) || address.slice(0, 8),
        isNew: seen > sessionStart + SETTLE_MS,
        transfers: s.n,
        perMin: windowRate,
        wallets: s.w.size,
        newWallets: s.fresh.size,
        mints: s.mint,
        burns: s.burn,
        swaps: swapsPerToken.get(address) || 0,
        concentration: s.n ? top / (s.n * 2) : 0,
        accel: windowRate > 0 ? recentRate / windowRate : 1,
        firstSeen: seen,
        age: now - seen,
      });
    }
    tokens.sort((a, b) => b.perMin - a.perMin);

    const secs = Math.max(1, (now - lastAt) / 1000);
    return {
      ok: true,
      block: lastBlock,
      txPerSec: txSeen / secs,
      transfersPerMin: events.length / (span / 60000),
      wallets: allWallets.size,
      tokens,
      lag,
    };
  }

  async function poll() {
    const now = Date.now();
    try {
      const head = parseInt((await rpc({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] })).result, 16);
      if (!lastBlock) lastBlock = head - 60;
      let from = lastBlock + 1;
      if (head - from > MAX_BLOCKS) {
        lag += head - from - MAX_BLOCKS;
        from = head - MAX_BLOCKS;
      }
      if (head >= from) {
        const [tr, s3, s2] = await Promise.all([
          rpc({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ fromBlock: "0x" + from.toString(16), toBlock: "0x" + head.toString(16), topics: [TRANSFER] }] }),
          rpc({ jsonrpc: "2.0", id: 2, method: "eth_getLogs", params: [{ fromBlock: "0x" + from.toString(16), toBlock: "0x" + head.toString(16), topics: [SWAP_V3] }] }),
          rpc({ jsonrpc: "2.0", id: 3, method: "eth_getLogs", params: [{ fromBlock: "0x" + from.toString(16), toBlock: "0x" + head.toString(16), topics: [SWAP_V2] }] }),
        ]);
        const logs = (tr.result || []) as any[];
        txSeen = logs.length;
        for (const l of logs) {
          if (l.topics.length !== 3) continue; // 4 topics = NFT
          const token = l.address.toLowerCase();
          const from_ = l.topics[1];
          const to = l.topics[2];
          events.push({ t: now, token, from: from_, to });
          if (!firstSeen.has(token)) firstSeen.set(token, now);
          for (const a of [from_, to]) if (a !== ZERO && !walletFirst.has(a)) walletFirst.set(a, now);
        }
        for (const l of [...(s3.result || []), ...(s2.result || [])] as any[]) {
          swapEvents.push({ t: now, pool: l.address.toLowerCase() });
        }
        lastBlock = head;
        lastAt = now;
      }
      const state = summarise(now);
      if (!stopped) onState(state);
      resolveSymbols(state.tokens.slice(0, 30).map((t) => t.address));
      resolvePools([...new Set(swapEvents.map((s) => s.pool))]);
    } catch {
      if (!stopped) onState({ ok: false, block: lastBlock, txPerSec: 0, transfersPerMin: 0, wallets: 0, tokens: [], lag });
    }
    if (!stopped) timer = setTimeout(poll, POLL_MS);
  }

  poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

// ---- turning a token's numbers into something the circuit can smell ----
//
// A fly encodes an odour as a pattern across its 53 glomeruli. We give each measurement
// its own small block of glomeruli and light them in proportion to how extreme it is, so
// "what this token smells of" stays readable: a block is flow, a block is concentration,
// and so on. The assignment is ours; the wiring underneath is the fly's.

export const FEATURES = [
  { key: "flow", label: "flow rate", of: (t: TokenStat) => Math.log10(1 + t.perMin) / 2.5 },
  { key: "wallets", label: "wallet spread", of: (t: TokenStat) => Math.log10(1 + t.wallets) / 2.2 },
  { key: "new", label: "new wallets", of: (t: TokenStat) => (t.wallets ? t.newWallets / t.wallets : 0) },
  { key: "accel", label: "acceleration", of: (t: TokenStat) => Math.min(1, Math.log2(1 + t.accel) / 2) },
  { key: "conc", label: "concentration", of: (t: TokenStat) => t.concentration },
  { key: "mint", label: "minting", of: (t: TokenStat) => (t.transfers ? t.mints / t.transfers : 0) },
  { key: "burn", label: "burning", of: (t: TokenStat) => (t.transfers ? t.burns / t.transfers : 0) },
  { key: "swap", label: "dex swaps", of: (t: TokenStat) => (t.transfers ? Math.min(1, t.swaps / t.transfers) : 0) },
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
