"use client";

import { useState } from "react";
import { TOKEN_TICKER, CONTRACT_ADDRESS, DEX_URL, asset } from "@/lib/config";

// Visual truncation only — the ellipsis form from the design brief
// (0x1a2b...ef42). The copy button and the `title` attribute below always
// use the full, untruncated CONTRACT_ADDRESS constant.
function displayAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function TokenBanner() {
  const [copied, setCopied] = useState(false);
  const hasAddress = CONTRACT_ADDRESS.length > 0;

  async function handleCopy() {
    if (!hasAddress) return;
    try {
      await navigator.clipboard.writeText(CONTRACT_ADDRESS);
    } catch {
      // Fallback for browsers without Clipboard API permission.
      const el = document.createElement("textarea");
      el.value = CONTRACT_ADDRESS;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="banner">
      <div className="banner-inner">
        {/* Bar is ink-coloured, so this uses the chartreuse cut of the mark. */}
        <img className="banner-mark" src={asset("/mark-chartreuse.png")} alt="" aria-hidden="true" />
        <span className="banner-ticker">{TOKEN_TICKER}</span>
        {hasAddress ? (
          <>
            {/* Real DOM text, not an image or canvas — hover shows the full
                address, and the copy button below always copies the full,
                untruncated value regardless of what's displayed here. */}
            <span className="banner-ca" title={CONTRACT_ADDRESS}>
              {displayAddress(CONTRACT_ADDRESS)}
            </span>
            <button
              className={`banner-copy-btn${copied ? " copied" : ""}`}
              onClick={handleCopy}
              aria-label="Copy contract address"
            >
              {copied ? "copied ✓" : "copy CA"}
            </button>
          </>
        ) : (
          <span className="banner-placeholder-note">
            contract address not deployed yet — set NEXT_PUBLIC_EDGERUN_CONTRACT_ADDRESS at launch
          </span>
        )}
        {DEX_URL ? (
          <a className="banner-dex" href={DEX_URL} target="_blank" rel="noreferrer">
            view chart ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}
