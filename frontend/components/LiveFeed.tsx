"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { fetchFeed, ScanResult } from "@/lib/api";
import VerdictCard from "./VerdictCard";

const REFRESH_MS = 20000;
type VerdictFilter = "ALL" | "PASS" | "CAUTION" | "FAIL";

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
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<VerdictFilter>("ALL");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (pausedRef.current) return;
      try {
        const { items } = await fetchFeed(40);
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

  const counts = useMemo(() => {
    const base = { PASS: 0, CAUTION: 0, FAIL: 0 };
    for (const it of items || []) base[it.verdict]++;
    return base;
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return null;
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (filter !== "ALL" && it.verdict !== filter) return false;
      if (!q) return true;
      return it.address.toLowerCase().includes(q) || (it.token_symbol || "").toLowerCase().includes(q) || (it.token_name || "").toLowerCase().includes(q);
    });
  }, [items, filter, query]);

  return (
    <div id="live-feed">
      <div className="feed-section-head">
          <div>
            <h3 className="eyebrow">
              <span className="live-dot" /> live feed {paused ? "· paused" : ""}
            </h3>
            <h2>Recently scanned on Robinhood Chain</h2>
          </div>
          <button className="btn" onClick={() => setPaused((p) => !p)}>
            {paused ? "resume" : "pause"}
          </button>
        </div>
        <p>
          Every new verified contract and newly-listed token is picked up by the poller and run
          through both lanes automatically — the same pipeline <code>edgerun watch</code> runs.
        </p>

        <div className="feed-controls">
          <input
            className="mono"
            placeholder="filter by ticker, name, or address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          <div className="feed-filters">
            {(["ALL", "PASS", "CAUTION", "FAIL"] as VerdictFilter[]).map((f) => (
              <button
                key={f}
                className={`chip${filter === f ? " chip-on" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f}
                {f !== "ALL" ? ` ${counts[f]}` : ""}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="feed-empty">feed unavailable: {error}</div>
        ) : filtered === null ? (
          <div className="feed-empty">loading…</div>
        ) : filtered.length === 0 ? (
          <div className="feed-empty">
            {items && items.length > 0
              ? "nothing matches that filter."
              : "no scans yet — the poller runs every ~45s. Once it finds a new deployment, it'll appear here."}
          </div>
        ) : (
          <div className="feed-table-wrap panel" style={{ overflowX: "auto" }}>
            <table className="feed-table">
              <thead>
                <tr>
                  <th>time</th>
                  <th>address</th>
                  <th>ticker</th>
                  <th>source</th>
                  <th>verdict</th>
                  <th>checks</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <Fragment key={r.address}>
                    <tr
                      data-verdict={r.verdict}
                      onClick={() => setExpanded(expanded === r.address ? null : r.address)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{timeAgo(r.scanned_at)}</td>
                      <td>
                        <a
                          href={r.blockscout_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.address.slice(0, 6)}...{r.address.slice(-4)}
                        </a>
                      </td>
                      <td className="feed-ticker">{r.token_symbol || "—"}</td>
                      <td>
                        <span className={`src-dot${r.contract.source_verified ? " verified" : ""}`}>
                          <i />
                          {r.contract.source_verified ? "verified" : "unverified"}
                        </span>
                      </td>
                      <td>
                        <span className={`pill pill-${r.verdict}`}>{r.verdict}</span>
                      </td>
                      <td>
                        <span className="bar">
                          <span className="bar-track">
                            <span
                              className={`bar-fill${r.verdict === "FAIL" ? " fail" : r.verdict === "CAUTION" ? " warn" : ""}`}
                              style={{
                                width: `${Math.round((r.facts_checked / Math.max(1, r.facts_checked + r.unresolved)) * 100)}%`,
                              }}
                            />
                          </span>
                          <span className="bar-num">
                            {r.facts_checked}/{r.facts_checked + r.unresolved}
                          </span>
                        </span>
                      </td>
                    </tr>
                    {expanded === r.address ? (
                      <tr>
                        <td colSpan={6} style={{ background: "var(--bg-alt)", padding: "0 14px 18px" }}>
                          <VerdictCard result={r} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
