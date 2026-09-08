"use client";

import { useState } from "react";
import { scanAddress, isAddressLike, ScanResult } from "@/lib/api";
import { CONTRACT_ADDRESS, DEX_URL, TOKEN_TICKER } from "@/lib/config";
import VerdictCard from "./VerdictCard";

function displayAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function Hero() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [copied, setCopied] = useState(false);

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
      <div className="container-wide">
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="live-dot" /> robinhood chain · read-only · zero wallet
            </div>
            <h1>
              Scan it before you ape it. <span className="accent-line">Not a score, a verdict.</span>
            </h1>
            <p className="sub">
              A rug and an impersonation are two different exits. edgerun checks for both,
              separately, and shows the receipts — verified on Blockscout, nothing signed,
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

            <div className="ca-card">
              <div className="ca-card-ticker">{TOKEN_TICKER}</div>
              <div className="ca-card-mid">
                <div className="ca-card-label">contract address</div>
                <div className="ca-card-value">
                  {CONTRACT_ADDRESS ? displayAddress(CONTRACT_ADDRESS) : "not deployed yet"}
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
          </div>

          <div className="term-card">
            <div className="term-card-head">
              <span className="term-dot" />
              <span className="term-dot" />
              <span className="term-dot" />
              <span style={{ marginLeft: 4 }}>edgerun · real scan</span>
            </div>
            <div className="term-card-body">
              <span className="t-dim">$ edgerun scan 0xDAA8...CED3</span>
              {"\n\n  contract\n"}
              <span className="t-ok">    ok</span>{"    source verified on blockscout\n"}
              <span className="t-ok">    ok</span>{"    supply fixed at deploy, no mint function\n"}
              <span className="t-dim">    ??</span>{"    owner() unreadable — no Ownable getter\n"}
              <span className="t-dim">    ??</span>{"    LP lock — no DEX factory configured yet\n"}
              {"\n  impersonation\n"}
              <span className="t-ok">    ok</span>{"    ticker matches no known collision\n"}
              {"\n  "}
              <span className="t-ok">verdict: PASS</span>
              {"\n"}
              <span className="t-dim">  facts checked: 3 · unresolved: 2</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
