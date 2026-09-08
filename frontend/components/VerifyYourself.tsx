"use client";

import { useEffect, useState } from "react";
import { fetchPublicConfig, PublicConfig } from "@/lib/api";
import { CONTRACT_ADDRESS, GITHUB_REPO_URL } from "@/lib/config";

export default function VerifyYourself() {
  const [cfg, setCfg] = useState<PublicConfig | null>(null);

  useEffect(() => {
    fetchPublicConfig().then(setCfg).catch(() => setCfg(null));
  }, []);

  return (
    <section>
      <div className="container">
        <h3>trust mechanic</h3>
        <h2>Verify it yourself</h2>
        <p>
          The point of a security tool that hides its own work is nothing. Everything here is a
          direct link to a source you can check independently.
        </p>
        <div className="verify-links">
          {GITHUB_REPO_URL ? (
            <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">→ source code (scan engine + CLI): {GITHUB_REPO_URL}</a>
          ) : (
            <span style={{ color: "var(--text-faint)" }}>→ source code: repo link not set (NEXT_PUBLIC_GITHUB_REPO_URL)</span>
          )}
          {CONTRACT_ADDRESS ? (
            <a href={`${cfg?.explorer_base || "https://robinhoodchain.blockscout.com"}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">
              → $EDGERUN contract on Blockscout
            </a>
          ) : (
            <span style={{ color: "var(--text-faint)" }}>→ $EDGERUN contract: not deployed yet</span>
          )}
          {cfg ? (
            <>
              <span>→ explorer this tool queries: {cfg.explorer_base}</span>
              <span>→ chain id: {cfg.chain_id}</span>
              <span>→ reference tokens loaded: {cfg.reference_token_count}</span>
              <span>→ max edit-distance flagged: {cfg.max_edit_distance_flag}</span>
              <span>→ scan cache refreshes every {Math.round(cfg.scan_cache_ttl_seconds / 60)} min</span>
            </>
          ) : (
            <span style={{ color: "var(--text-faint)" }}>→ live backend config unavailable right now</span>
          )}
        </div>
      </div>
    </section>
  );
}
