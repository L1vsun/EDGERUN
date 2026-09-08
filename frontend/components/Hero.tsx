"use client";

import { useEffect, useState } from "react";
import { scanAddress, isAddressLike, ScanResult, fetchPublicConfig, PublicConfig } from "@/lib/api";
import { useChainPulse } from "@/lib/chain";
import { CONTRACT_ADDRESS, DEX_URL, TOKEN_TICKER } from "@/lib/config";
import VerdictCard from "./VerdictCard";
import LogoMark from "./LogoMark";

function displayAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function Hero() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [copied, setCopied] = useState(false);
  const pulse = useChainPulse();

  useEffect(() => {
    fetchPublicConfig().then(setCfg).catch(() => setCfg(null));
  }, []);

  async function handleScan() {
    const trimmed = address.trim();
    if (!isAddressLike(trimmed)) {
      setError("that doesn't look like a contract address (expected 0x + 40 hex chars)");
      return;
    }
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const r = await scanAddress(trimmed);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "scan failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyCA() {
    if (!CONTRACT_ADDRESS) return;
    try {
      await navigator.clipboard.writeText(CONTRACT_ADDRESS);
    } catch {
      /* clipboard permission denied — copy button in the top banner still works */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="hero">
      <div className="container">
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="live-dot" /> robinhood chain · read-only · live
            </div>
            <h1>
              Check a contract before you touch it. <span className="accent-line">Not a score, a verdict.</span>
            </h1>
            <p className="sub">
              A rug and an impersonation are two different attacks. edgerun checks for both,
              separately, and shows the specific facts — verified on Blockscout, nothing signed,
              nothing custodied.
            </p>

            <div className="scanbox">
              <input
                className="mono"
                placeholder="0x… paste a Robinhood Chain contract address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleScan()}
                spellCheck={false}
              />
              <button onClick={handleScan} disabled={loading}>
                {loading ? "scanning…" : "scan"}
              </button>
            </div>
            {error ? <div className="scan-error">{error}</div> : null}
            {result ? <VerdictCard result={result} /> : null}
          </div>

          <div className="logo-badge">
            <LogoMark size={64} />
            <span className="logo-badge-tag">chain 4663</span>
          </div>
        </div>

        <div className="ca-card">
          <div className="ca-card-ticker">{TOKEN_TICKER}</div>
          <div className="ca-card-mid">
            <div className="ca-card-label">contract address</div>
            <div className="ca-card-value">
              {CONTRACT_ADDRESS ? displayAddress(CONTRACT_ADDRESS) : "not deployed yet — set NEXT_PUBLIC_EDGERUN_CONTRACT_ADDRESS at launch"}
            </div>
          </div>
          {CONTRACT_ADDRESS ? (
            <button className="btn" onClick={handleCopyCA}>
              {copied ? "copied ✓" : "copy CA"}
            </button>
          ) : null}
          {DEX_URL ? (
            <a className="btn btn-accent" href={DEX_URL} target="_blank" rel="noreferrer">
              Buy {TOKEN_TICKER} ↗
            </a>
          ) : (
            <span className="live-pill">live on robinhood chain</span>
          )}
        </div>

        <div className="stat-row">
          <div className="stat-tile">
            <div className="stat-tile-head">
              <span className="stat-tile-label">chain height</span>
              <span className="stat-pill live">live</span>
            </div>
            <div className="stat-tile-value">{pulse.blockNumber ? pulse.blockNumber.toLocaleString() : "…"}</div>
            <div className="stat-tile-sub">robinhood chain · id 4663</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-head">
              <span className="stat-tile-label">reference tokens</span>
              <span className="stat-pill live">live</span>
            </div>
            <div className="stat-tile-value">{cfg ? cfg.reference_token_count : "…"}</div>
            <div className="stat-tile-sub">loaded for impersonation checks</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-head">
              <span className="stat-tile-label">edit distance flag</span>
              <span className="stat-pill">config</span>
            </div>
            <div className="stat-tile-value">≤{cfg ? cfg.max_edit_distance_flag : "…"}</div>
            <div className="stat-tile-sub">tuned against false-positive reports</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-head">
              <span className="stat-tile-label">scan cache</span>
              <span className="stat-pill">config</span>
            </div>
            <div className="stat-tile-value">{cfg ? Math.round(cfg.scan_cache_ttl_seconds / 60) : "…"}m</div>
            <div className="stat-tile-sub">refresh interval per contract</div>
          </div>
        </div>
      </div>
    </section>
  );
}
