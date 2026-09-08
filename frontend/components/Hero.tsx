"use client";

import { useState } from "react";
import { scanAddress, isAddressLike, ScanResult } from "@/lib/api";
import TokenPriceCard from "./TokenPriceCard";
import VerdictCard from "./VerdictCard";
import StatStrip from "./StatStrip";

export default function Hero() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

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

          </div>

          <div className="hero-token">
            <TokenPriceCard />
          </div>
        </div>

        <StatStrip />
      </div>
    </section>
  );
}
