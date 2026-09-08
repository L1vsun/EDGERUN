"use client";

import { useEffect, useState } from "react";
import { fetchFeed, fetchPublicConfig, PublicConfig, ScanResult } from "@/lib/api";
import { useChainPulse } from "@/lib/chain";

// Five real numbers, on screen immediately. Every one is either read from the
// chain or counted from scans we actually ran — none are decorative.
export default function StatStrip() {
  const [items, setItems] = useState<ScanResult[]>([]);
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const pulse = useChainPulse();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [feed, config] = await Promise.all([fetchFeed(100), fetchPublicConfig()]);
        if (!cancelled) {
          setItems(feed.items);
          setCfg(config);
        }
      } catch {
        /* strip renders em-dashes when the backend is unreachable */
      }
    }
    load();
    const id = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const count = (v: string) => items.filter((i) => i.verdict === v).length;
  const dash = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString());

  return (
    <div className="stat-row panel">
      <div className="stat-tile">
        <div className="stat-tile-head">
          <span className="stat-tile-label">scanned</span>
          <span className="stat-pill live">live</span>
        </div>
        <div className="stat-tile-value">{items.length || "—"}</div>
        <div className="stat-tile-sub">contracts in the feed</div>
      </div>
      <div className="stat-tile">
        <div className="stat-tile-head">
          <span className="stat-tile-label">pass</span>
        </div>
        <div className="stat-tile-value ok">{items.length ? count("PASS") : "—"}</div>
        <div className="stat-tile-sub">checks came back clean</div>
      </div>
      <div className="stat-tile">
        <div className="stat-tile-head">
          <span className="stat-tile-label">caution</span>
        </div>
        <div className="stat-tile-value warn">{items.length ? count("CAUTION") : "—"}</div>
        <div className="stat-tile-sub">unverified or live mint</div>
      </div>
      <div className="stat-tile">
        <div className="stat-tile-head">
          <span className="stat-tile-label">fail</span>
        </div>
        <div className="stat-tile-value fail">{items.length ? count("FAIL") : "—"}</div>
        <div className="stat-tile-sub">likely impersonation</div>
      </div>
      <div className="stat-tile">
        <div className="stat-tile-head">
          <span className="stat-tile-label">chain head</span>
          <span className="stat-pill live">live</span>
        </div>
        <div className="stat-tile-value">{dash(pulse.blockNumber)}</div>
        <div className="stat-tile-sub">robinhood · id {cfg?.chain_id ?? 4663}</div>
      </div>
    </div>
  );
}
