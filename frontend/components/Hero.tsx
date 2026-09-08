"use client";

import { useState } from "react";
import { scanAddress, isAddressLike, ScanResult } from "@/lib/api";
import VerdictCard from "./VerdictCard";

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
      <div className="container">
        <div className="eyebrow">robinhood chain · contract safety + impersonation checker</div>
        <h1>Check a Robinhood Chain contract before you touch it. Not a score, a verdict.</h1>
        <p className="sub">
          A rug and an impersonation are two different attacks. edgerun checks for both,
          separately, and shows you the specific facts — verified on Blockscout, nothing
          signed, nothing custodied.
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
    </section>
  );
}
