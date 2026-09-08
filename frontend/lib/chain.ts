"use client";

import { useEffect, useState } from "react";

// Direct browser calls to Blockscout + the public RPC — both send
// `access-control-allow-origin: *` (confirmed live), so this needs no proxy
// through our own backend. Real data only: block height and gas price come
// straight from the chain, not simulated for effect.

const EXPLORER_BASE = "https://robinhoodchain.blockscout.com";
const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const POLL_MS = 15000;

export interface ChainPulse {
  blockNumber: number | null;
  gasGwei: number | null;
  loading: boolean;
}

export function useChainPulse(): ChainPulse {
  const [state, setState] = useState<ChainPulse>({ blockNumber: null, gasGwei: null, loading: true });

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const resp = await fetch(`${EXPLORER_BASE}/api/v2/stats`);
        if (!resp.ok) throw new Error(`stats HTTP ${resp.status}`);
        const data = await resp.json();
        if (!cancelled) {
          setState({
            blockNumber: data.total_blocks ? Number(data.total_blocks) : null,
            gasGwei: data.gas_prices?.average ?? null,
            loading: false,
          });
        }
      } catch {
        // Fall back to a raw RPC call if the Blockscout stats endpoint is
        // having a moment — still real data, just a different source.
        try {
          const resp = await fetch(RPC_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
          });
          const body = await resp.json();
          if (!cancelled && body.result) {
            setState((s) => ({ ...s, blockNumber: parseInt(body.result, 16), loading: false }));
          }
        } catch {
          if (!cancelled) setState((s) => ({ ...s, loading: false }));
        }
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return state;
}
