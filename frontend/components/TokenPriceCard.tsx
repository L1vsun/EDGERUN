"use client";

import { useEffect, useState } from "react";
import { fetchTokenStats, TokenStats } from "@/lib/api";
import { CONTRACT_ADDRESS, TOKEN_TICKER, buyUrl } from "@/lib/config";
import PriceChart from "./PriceChart";

function shortAddress(addr: string): string {
  return addr.length <= 14 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function compact(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export default function TokenPriceCard({ withChart = true }: { withChart?: boolean }) {
  const [stats, setStats] = useState<TokenStats | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const s = await fetchTokenStats();
        if (!cancelled) setStats(s);
      } catch {
        /* backend down — the card falls back to build-time config below */
      }
    }
    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // The card must render correctly even with the backend unreachable, so
  // launch state falls back to the build-time contract address.
  const launched = stats ? stats.launched : Boolean(CONTRACT_ADDRESS);
  const href = stats?.buy_url || buyUrl();
  const address = stats?.address || CONTRACT_ADDRESS;

  return (
    <div className={`price-card ${launched ? "glass-accent" : "glass price-card-armed"}`}>
      <div className="price-card-top">
        <span className="price-ticker">{TOKEN_TICKER}</span>
        {launched ? (
          <span className="price-state live">
            <span className="live-dot" /> live
          </span>
        ) : (
          <span className="price-state armed">pre-launch</span>
        )}
      </div>

      {launched && stats?.price != null ? (
        <div className="price-main">
          <span className="price-figure">
            {stats.price >= 1 ? `$${stats.price.toFixed(4)}` : `$${stats.price.toPrecision(3)}`}
          </span>
          {stats.change_24h != null && (
            <span className={`price-change ${stats.change_24h >= 0 ? "up" : "down"}`}>
              {stats.change_24h >= 0 ? "+" : ""}
              {stats.change_24h.toFixed(2)}% 24h
            </span>
          )}
        </div>
      ) : launched ? (
        <div className="price-main">
          <span className="price-figure dim">no price feed yet</span>
          <span className="price-note">holders and supply are tracked from block one</span>
        </div>
      ) : (
        <div className="price-main">
          <span className="price-figure dim">not launched</span>
          <span className="price-note">price, chart and buy link switch on automatically at launch</span>
        </div>
      )}

      <div className="price-stats">
        <div className="price-stat">
          <span className="k">mcap</span>
          <span className="v">{stats?.market_cap != null ? compact(stats.market_cap) : "—"}</span>
        </div>
        <div className="price-stat">
          <span className="k">vol 24h</span>
          <span className="v">{stats?.volume_24h != null ? compact(stats.volume_24h) : "—"}</span>
        </div>
        <div className="price-stat">
          <span className="k">holders</span>
          <span className="v">{stats?.holders != null ? stats.holders.toLocaleString() : "—"}</span>
        </div>
      </div>

      {withChart && <PriceChart launched={launched} />}

      <div className="price-ca">
        <span className="k">CA</span>
        <span className="v mono">{address ? shortAddress(address) : "assigned at launch"}</span>
        {address ? (
          <button
            className="chip"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
              } catch {
                /* ignore */
              }
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "copied ✓" : "copy"}
          </button>
        ) : null}
      </div>

      {href ? (
        <a className="btn btn-accent price-buy" href={href} target="_blank" rel="noreferrer">
          Buy {TOKEN_TICKER} on Pons ↗
        </a>
      ) : (
        <span className="btn price-buy disabled" aria-disabled="true">
          Pons launchpad opens at launch
        </span>
      )}
    </div>
  );
}
