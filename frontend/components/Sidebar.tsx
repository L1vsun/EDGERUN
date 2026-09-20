"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchPublicConfig, PublicConfig } from "@/lib/api";
import { useChainPulse } from "@/lib/chain";
import ScanPreview from "./ScanPreview";
import ChangeFeed from "./ChangeFeed";

export default function Sidebar() {
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const pulse = useChainPulse();

  useEffect(() => {
    fetchPublicConfig().then(setCfg).catch(() => setCfg(null));
  }, []);

  return (
    <div className="dash-side">
      <ScanPreview compact />

      <div className="side-card panel">
        <div className="eyebrow">
          <span className="live-dot" /> watchtower
        </div>
        <ChangeFeed compact />
      </div>

      <div className="side-card panel">
        <div className="eyebrow">
          <span className="live-dot" /> chain pulse
        </div>
        <div className="side-stat">
          <span className="k">block height</span>
          <span className="v">{pulse.blockNumber ? pulse.blockNumber.toLocaleString() : "…"}</span>
        </div>
        <div className="side-stat">
          <span className="k">gas (avg)</span>
          <span className="v">{pulse.gasGwei !== null ? `${pulse.gasGwei.toFixed(3)} gwei` : "—"}</span>
        </div>
        <div className="side-stat">
          <span className="k">reference tokens</span>
          <span className="v">{cfg ? cfg.reference_token_count : "…"}</span>
        </div>
        <div className="side-stat">
          <span className="k">edit distance flag</span>
          <span className="v">≤{cfg ? cfg.max_edit_distance_flag : "…"}</span>
        </div>
        <div className="side-stat">
          <span className="k">scan cache</span>
          <span className="v">{cfg ? Math.round(cfg.scan_cache_ttl_seconds / 60) : "…"}m</span>
        </div>
      </div>

      <div className="side-card panel">
        <div className="eyebrow" style={{ color: "var(--text-faint)" }}>the rest of the site</div>
        <div className="side-links">
          <Link href="/brain">
            fly brain
            <small>a real connectome reacting to scans</small>
          </Link>
          <Link href="/changes">
            changes
            <small>contracts that turned after the scan</small>
          </Link>
          <Link href="/deployers">
            deployers
            <small>wallets that keep shipping rugs</small>
          </Link>
          <Link href="/mechanism">
            mechanism
            <small>the two checks, call by call</small>
          </Link>
          <Link href="/limits">
            limits
            <small>what it doesn't catch — said plainly</small>
          </Link>
          <Link href="/onchain">
            on-chain
            <small>verify every claim yourself</small>
          </Link>
          <Link href="/token">
            token
            <small>utility, contract, why hold it</small>
          </Link>
        </div>
      </div>
    </div>
  );
}
