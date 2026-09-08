"use client";

import { useEffect, useState } from "react";
import { fetchFeed, fetchPublicConfig } from "@/lib/api";

// Every value here is pulled from the live API — no invented "X people
// watching" style filler. If a fact can't be verified against real data,
// it doesn't go in the ticker.
export default function Marquee() {
  const [items, setItems] = useState<string[]>(["loading live chain data…"]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [cfg, feed] = await Promise.all([fetchPublicConfig(), fetchFeed(100)]);
        if (cancelled) return;
        const pass = feed.items.filter((i) => i.verdict === "PASS").length;
        const caution = feed.items.filter((i) => i.verdict === "CAUTION").length;
        const fail = feed.items.filter((i) => i.verdict === "FAIL").length;
        setItems([
          `robinhood chain · chain id ${cfg.chain_id}`,
          `${feed.items.length} contracts in the live feed`,
          `${pass} PASS · ${caution} CAUTION · ${fail} FAIL`,
          `${cfg.reference_token_count} reference tokens loaded`,
          `max edit-distance flagged: ${cfg.max_edit_distance_flag}`,
          `poller runs every ${cfg.poll_interval_seconds}s`,
          `scan cache refreshes every ${Math.round(cfg.scan_cache_ttl_seconds / 60)}m`,
          `read-only · no wallet connection · nothing custodied`,
        ]);
      } catch {
        if (!cancelled) setItems(["live backend unreachable right now — retrying…"]);
      }
    }

    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const track = [...items, ...items];

  return (
    <div className="marquee-wrap">
      <div className="marquee-track">
        {track.map((t, i) => (
          <span className="marquee-item" key={i}>
            <b>›</b> {t}
          </span>
        ))}
      </div>
    </div>
  );
}
