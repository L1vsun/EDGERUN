"use client";

import { useState } from "react";
import { CONTRACT_ADDRESS, TOKEN_LIVE, TOKEN_TICKER } from "@/lib/config";

// The token's address, in full, under the mark. It is the one place on the site where the
// address can be read and copied, so it never shortens it - and it draws nothing at all
// until config.ts has an address to show.
export default function ContractLine() {
  const [copied, setCopied] = useState(false);
  if (!TOKEN_LIVE) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CONTRACT_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // no clipboard here: the address is still on the page, and one click selects all of it
    }
  };

  return (
    <div className="ca">
      <span className="ca-k">{TOKEN_TICKER} CA:</span>
      <code className="ca-v">{CONTRACT_ADDRESS}</code>
      <button type="button" className="ca-c" onClick={copy}>{copied ? "copied" : "copy"}</button>
    </div>
  );
}
