"use client";

import { useState } from "react";
import { CONTRACT_ADDRESS, TOKEN_TICKER } from "@/lib/config";
import TokenPriceCard from "@/components/TokenPriceCard";

function displayAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function TokenPage() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!CONTRACT_ADDRESS) return;
    try {
      await navigator.clipboard.writeText(CONTRACT_ADDRESS);
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <section className="page-head">
        <div className="container">
          <div className="eyebrow">{TOKEN_TICKER}</div>
          <h1>The token made around the tool, not the other way around</h1>
          <p>
            edgerun works with zero tokens held and zero keys required — the scanner is free to run
            for anyone, forever. {TOKEN_TICKER} is what you hold if you want a faster seat and a say
            in what the tool checks next.
          </p>
        </div>
      </section>

      <section className="block">
        <div className="container">
          <div className="token-page-grid">
            <TokenPriceCard />
            <div>
              <div className="ca-card" style={{ marginTop: 0 }}>
                <div className="ca-card-ticker">{TOKEN_TICKER}</div>
                <div className="ca-card-mid">
                  <div className="ca-card-label">contract address</div>
                  <div className="ca-card-value">
                    {CONTRACT_ADDRESS ? displayAddress(CONTRACT_ADDRESS) : "not deployed yet"}
                  </div>
                </div>
                {CONTRACT_ADDRESS ? (
                  <button className="btn" onClick={handleCopy}>
                    {copied ? "copied ✓" : "copy CA"}
                  </button>
                ) : null}
              </div>
              <p style={{ marginTop: 16, fontSize: 14 }}>
                Buying happens on the Pons launchpad. The price, chart and buy link on this page
                read from the live contract — before launch there is no data to show, and this
                page says so rather than filling the space with a placeholder chart.
              </p>
              <p style={{ fontSize: 14 }}>
                Chart points are real samples recorded by the same poller that runs the scan
                feed. Blockscout publishes no price history for a token, so the series starts
                the moment the contract goes live and grows from there.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="block">
        <div className="container">
          <h3 className="eyebrow" style={{ marginTop: 0 }}>utility</h3>
          <h2>Kept to what it actually does</h2>
          <ul className="utility-list">
            <li>Priority position in the scan queue during high-deployment periods</li>
            <li>Access to the real-time verdict alert feed</li>
            <li>A vote on additions to the impersonation reference list and new check modules</li>
          </ul>
          <p style={{ marginTop: 18 }}>
            Not a signal service. A PASS is not a buy recommendation. Read the verdict, then read
            the linked Blockscout page yourself before you decide anything.
          </p>
        </div>
      </section>

      <section className="block" style={{ borderBottom: "none" }}>
        <div className="container">
          <h3 className="eyebrow" style={{ marginTop: 0 }}>why hold it</h3>
          <h2>You're early to the checker, not to a promise</h2>
          <p className="lead">
            Every scam this tool catches gets caught for everyone, holder or not — that's the
            point of a public good. Holding {TOKEN_TICKER} doesn't change what the tool tells you
            about a contract. It changes how fast you get the answer, and whether you get a vote on
            what gets checked next.
          </p>
        </div>
      </section>
    </>
  );
}
