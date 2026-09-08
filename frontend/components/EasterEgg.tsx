"use client";

import { useEffect, useState } from "react";

// Press ` (backtick) anywhere on the site. Real output — this is the exact
// text `edgerun explain` prints from the CLI, not written twice.
const EXPLAIN_OUTPUT = `$ edgerun explain

  contract lane
    source_verified  GET /api/v2/addresses/{address} -> is_verified
    supply_mint       bytecode selector scan for mint(address,uint256) (+ source regex when
                       verified); needs deployed bytecode, unresolved if neither source nor
                       eth_getCode is reachable
    ownership         eth_call owner() over RPC, cross-checked against a bytecode scan for
                       pause/blacklist/setFee-style selectors; unresolved if owner() reverts
                       and no dangerous selectors are found either
    lp_lock           unresolved until dex.factory_address is set in known_tokens.json

  impersonation lane
    ticker/name        Levenshtein edit distance against every entry in known_tokens.json;
                        unresolved if the reference list is empty or the address has no
                        token metadata`;

export default function EasterEgg() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "`") setOpen((o) => !o);
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) {
    return <div className="egg-hint">press ` for the CLI</div>;
  }

  return (
    <div className="egg-overlay" onClick={() => setOpen(false)}>
      <div className="egg-term panel" onClick={(e) => e.stopPropagation()}>
        <div className="egg-term-head">
          <span className="egg-term-dot" />
          <span className="egg-term-dot" />
          <span className="egg-term-dot" />
          <span style={{ marginLeft: 6 }}>edgerun · terminal</span>
        </div>
        <div className="egg-term-body">{EXPLAIN_OUTPUT}</div>
      </div>
    </div>
  );
}
