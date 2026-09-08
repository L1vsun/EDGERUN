"use client";

import { useEffect, useState } from "react";
import { fetchFeed, ScanResult } from "@/lib/api";

const REFRESH_MS = 20000;

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function LiveFeed() {
  const [items, setItems] = useState<ScanResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { items } = await fetchFeed(20);
        if (!cancelled) {
          setItems(items);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "feed unavailable");
      }
    }

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <section id="live-feed">
      <div className="container">
        <h3>
          <span className="live-dot" />
          live feed
        </h3>
        <h2>Recently scanned on Robinhood Chain</h2>
        <p>
          Every new verified contract and newly-listed token is picked up by the poller and run
          through both lanes automatically — this is the same pipeline `edgerun watch` runs.
        </p>

        {error ? (
          <div className="feed-empty">feed unavailable: {error}</div>
        ) : items === null ? (
          <div className="feed-empty">loading…</div>
        ) : items.length === 0 ? (
          <div className="feed-empty">
            no scans yet — the poller runs every ~45s. Once it finds a new deployment, it'll
            appear here.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="feed-table">
              <thead>
                <tr>
                  <th>time</th>
                  <th>address</th>
                  <th>ticker</th>
                  <th>verdict</th>
                  <th>facts</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.address}>
                    <td>{timeAgo(r.scanned_at)}</td>
                    <td>
                      <a href={r.blockscout_url} target="_blank" rel="noreferrer">
                        {r.address.slice(0, 6)}...{r.address.slice(-4)}
                      </a>
                    </td>
                    <td>{r.token_symbol || "—"}</td>
                    <td>
                      <span className={`pill pill-${r.verdict}`}>{r.verdict}</span>
                    </td>
                    <td>
                      {r.facts_checked}/{r.facts_checked + r.unresolved}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
