"use client";

import { useEffect, useState } from "react";
import { fetchPublicConfig, PublicConfig } from "@/lib/api";
import { useChainPulse } from "@/lib/chain";
import { CONTRACT_ADDRESS, GITHUB_REPO_URL } from "@/lib/config";

export default function OnChainPage() {
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const pulse = useChainPulse();

  useEffect(() => {
    fetchPublicConfig().then(setCfg).catch(() => setCfg(null));
  }, []);

  return (
    <>
      <section className="page-head">
        <div className="container">
          <div className="eyebrow">trust mechanic</div>
          <h1>Verify it yourself</h1>
          <p>
            The point of a security tool that hides its own work is nothing. Everything below is a
            direct link or a live value you can check independently.
          </p>
        </div>
      </section>

      <section className="block">
        <div className="container">
          <h3 className="eyebrow" style={{ marginTop: 0 }}>live chain state</h3>
          <div className="kv-row">
            <span className="k">block height</span>
            <span className="v">{pulse.blockNumber ? pulse.blockNumber.toLocaleString() : "…"}</span>
          </div>
          <div className="kv-row">
            <span className="k">average gas price</span>
            <span className="v">{pulse.gasGwei !== null ? `${pulse.gasGwei.toFixed(3)} gwei` : "—"}</span>
          </div>
          <div className="kv-row">
            <span className="k">chain id</span>
            <span className="v">{cfg?.chain_id ?? 4663}</span>
          </div>
          <div className="kv-row">
            <span className="k">explorer this tool queries</span>
            <span className="v">{cfg?.explorer_base || "https://robinhoodchain.blockscout.com"}</span>
          </div>
          <div className="kv-row">
            <span className="k">rpc endpoint</span>
            <span className="v">{cfg?.rpc_url || "https://rpc.mainnet.chain.robinhood.com"}</span>
          </div>
        </div>
      </section>

      <section className="block">
        <div className="container">
          <h3 className="eyebrow" style={{ marginTop: 0 }}>scan configuration</h3>
          <div className="kv-row">
            <span className="k">reference tokens loaded</span>
            <span className="v">{cfg?.reference_token_count ?? "…"}</span>
          </div>
          <div className="kv-row">
            <span className="k">max edit-distance flagged</span>
            <span className="v">≤{cfg?.max_edit_distance_flag ?? "…"}</span>
          </div>
          <div className="kv-row">
            <span className="k">poller interval</span>
            <span className="v">{cfg ? `${cfg.poll_interval_seconds}s` : "…"}</span>
          </div>
          <div className="kv-row">
            <span className="k">scan cache TTL</span>
            <span className="v">{cfg ? `${Math.round(cfg.scan_cache_ttl_seconds / 60)}m` : "…"}</span>
          </div>
        </div>
      </section>

      <section className="block">
        <div className="container">
          <h3 className="eyebrow" style={{ marginTop: 0 }}>direct links</h3>
          <div className="verify-links">
            {GITHUB_REPO_URL ? (
              <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                → source code (scan engine + CLI + this site): {GITHUB_REPO_URL}
              </a>
            ) : (
              <span style={{ color: "var(--text-faint)" }}>→ source code: repo link not set (NEXT_PUBLIC_GITHUB_REPO_URL)</span>
            )}
            {CONTRACT_ADDRESS ? (
              <a
                href={`${cfg?.explorer_base || "https://robinhoodchain.blockscout.com"}/address/${CONTRACT_ADDRESS}`}
                target="_blank"
                rel="noreferrer"
              >
                → $EDGERUN contract on Blockscout
              </a>
            ) : (
              <span style={{ color: "var(--text-faint)" }}>→ $EDGERUN contract: not deployed yet</span>
            )}
            <a href={`${cfg?.explorer_base || "https://robinhoodchain.blockscout.com"}/api-docs`} target="_blank" rel="noreferrer">
              → the exact Blockscout API this tool calls (api-docs)
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
