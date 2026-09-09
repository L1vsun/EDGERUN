"use client";

import { useEffect, useState } from "react";
import { fetchEvents, ChangeEvent } from "@/lib/api";

function ago(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return `${Math.max(1, s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const HEADLINE: Record<string, string> = {
  exit_test: "SELLABILITY CHANGED",
  ownership: "OWNERSHIP CHANGED",
  supply_mint: "SUPPLY CHANGED",
  source_verified: "VERIFICATION CHANGED",
};

export default function ChangeFeed({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<ChangeEvent[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { items } = await fetchEvents(compact ? 6 : 40);
        if (!cancelled) {
          setItems(items);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }
    load();
    const id = setInterval(load, 25000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [compact]);

  if (error) return <div className="feed-empty">change feed unavailable</div>;
  if (items === null) return <div className="feed-empty">loading…</div>;

  if (items.length === 0) {
    return (
      <div className="feed-empty">
        no changes recorded yet. The watchtower re-scans known contracts every few minutes and
        logs anything that moves — a contract that could be sold and now can&apos;t, ownership
        re-acquired after being renounced, a mint that appeared post-deploy.
      </div>
    );
  }

  return (
    <div className="change-list">
      {items.map((e, i) => (
        <div className={`change-item sev-${e.severity}`} key={`${e.address}-${e.ts}-${i}`}>
          <div className="change-top">
            <span className="change-headline">{HEADLINE[e.check] || e.label.toUpperCase()}</span>
            <span className="change-time">{ago(e.ts)}</span>
          </div>
          <div className="change-body">
            <span className="change-ticker">{e.ticker || "—"}</span>
            <span className="change-transition">
              <span className={`t-${e.before}`}>{e.before}</span>
              <span className="arrow">→</span>
              <span className={`t-${e.after}`}>{e.after}</span>
            </span>
            <a
              className="change-addr"
              href={`https://robinhoodchain.blockscout.com/address/${e.address}`}
              target="_blank"
              rel="noreferrer"
            >
              {e.address.slice(0, 8)}…{e.address.slice(-6)}
            </a>
          </div>
          {!compact && e.detail ? <div className="change-detail">{e.detail}</div> : null}
        </div>
      ))}
    </div>
  );
}
