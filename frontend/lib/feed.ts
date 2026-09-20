// Live Robinhood Chain activity, straight from the public RPC in the visitor's browser
// (it sends access-control-allow-origin: *), so no backend is involved.

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const HEAVY_GAS = 3_000_000; // a block using far more gas than the ~0.7M median

export interface ChainSample {
  ok: boolean;
  block: number;
  txPerSec: number;
  creations: number; // contracts deployed since the last poll
  heavy: number; // unusually heavy blocks since the last poll
}

async function rpc(body: unknown) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`rpc ${r.status}`);
  return r.json();
}

export function startChainFeed(onSample: (s: ChainSample) => void): () => void {
  let stopped = false;
  let last = 0;
  let lastAt = 0;
  let timer: ReturnType<typeof setTimeout>;

  async function poll() {
    try {
      const head = parseInt((await rpc({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] })).result, 16);
      const now = performance.now();
      if (!last) {
        last = head - 1;
        lastAt = now - 1000;
      }
      const from = Math.max(last + 1, head - 11); // at most 12 blocks per poll
      let tx = 0;
      let creations = 0;
      let heavy = 0;
      if (head >= from) {
        const batch = [];
        for (let n = from; n <= head; n++) {
          batch.push({ jsonrpc: "2.0", id: n, method: "eth_getBlockByNumber", params: ["0x" + n.toString(16), true] });
        }
        for (const r of await rpc(batch)) {
          const b = r.result;
          if (!b) continue;
          tx += b.transactions.length;
          for (const t of b.transactions) if (t.to === null) creations++;
          if (parseInt(b.gasUsed, 16) > HEAVY_GAS) heavy++;
        }
      }
      const secs = Math.max(0.5, (now - lastAt) / 1000);
      last = head;
      lastAt = now;
      if (!stopped) onSample({ ok: true, block: head, txPerSec: tx / secs, creations, heavy });
    } catch {
      if (!stopped) onSample({ ok: false, block: 0, txPerSec: 0, creations: 0, heavy: 0 });
    }
    if (!stopped) timer = setTimeout(poll, 1000);
  }

  poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
