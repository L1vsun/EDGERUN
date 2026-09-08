"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchTokenHistory, HistoryRange, TokenPoint } from "@/lib/api";

type Series = "price" | "holders";

const RANGES: HistoryRange[] = ["1h", "24h", "7d", "all"];
const REFRESH_MS = 30000;

function formatValue(v: number, series: Series): string {
  if (series === "holders") return Math.round(v).toLocaleString();
  if (v >= 1) return `$${v.toFixed(4)}`;
  return `$${v.toPrecision(3)}`;
}

export default function PriceChart({ launched }: { launched: boolean }) {
  const [range, setRange] = useState<HistoryRange>("24h");
  const [series, setSeries] = useState<Series>("price");
  const [points, setPoints] = useState<TokenPoint[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!launched) return;
    let cancelled = false;

    async function load() {
      try {
        const { points } = await fetchTokenHistory(range);
        if (!cancelled) {
          setPoints(points);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [range, launched]);

  const values = useMemo(() => {
    if (!points) return [];
    return points
      .map((p) => ({ ts: p.ts, v: series === "price" ? p.price : p.holders }))
      .filter((p): p is { ts: number; v: number } => typeof p.v === "number");
  }, [points, series]);

  const geometry = useMemo(() => {
    if (values.length < 2) return null;
    const W = 600;
    const H = 180;
    const min = Math.min(...values.map((p) => p.v));
    const max = Math.max(...values.map((p) => p.v));
    const span = max - min || Math.abs(max) || 1;
    const pad = span * 0.12;
    const lo = min - pad;
    const hi = max + pad;

    const x = (i: number) => (i / (values.length - 1)) * W;
    const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;

    const line = values.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.v).toFixed(2)}`).join(" ");
    const area = `${line} L${W},${H} L0,${H} Z`;
    const first = values[0].v;
    const last = values[values.length - 1].v;

    return { W, H, line, area, first, last, lastX: W, lastY: y(last), min, max };
  }, [values]);

  const delta =
    geometry && geometry.first !== 0 ? ((geometry.last - geometry.first) / geometry.first) * 100 : null;

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div className="chart-series">
          <button
            className={`chip${series === "price" ? " chip-on" : ""}`}
            onClick={() => setSeries("price")}
          >
            price
          </button>
          <button
            className={`chip${series === "holders" ? " chip-on" : ""}`}
            onClick={() => setSeries("holders")}
          >
            holders
          </button>
        </div>
        <div className="chart-ranges">
          {RANGES.map((r) => (
            <button key={r} className={`chip${range === r ? " chip-on" : ""}`} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {!launched ? (
        <div className="chart-empty">
          <span className="chart-empty-tag">armed</span>
          chart activates the moment a contract address is set — it plots real samples only,
          so there is nothing to draw yet.
        </div>
      ) : error ? (
        <div className="chart-empty">history unavailable right now</div>
      ) : geometry === null ? (
        <div className="chart-empty">
          <span className="chart-empty-tag">collecting</span>
          {values.length === 1
            ? "first sample recorded — the line needs one more."
            : series === "price"
              ? "no price samples in this window yet. Holders is available immediately."
              : "no samples in this window yet."}
        </div>
      ) : (
        <>
          <div className="chart-readout">
            <span className="chart-value">{formatValue(geometry.last, series)}</span>
            {delta !== null && (
              <span className={`chart-delta ${delta >= 0 ? "up" : "down"}`}>
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(2)}% <small>over {range}</small>
              </span>
            )}
          </div>
          <svg
            className="chart-svg"
            viewBox={`0 0 ${geometry.W} ${geometry.H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${series} over ${range}`}
          >
            <defs>
              <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1="0"
                x2={geometry.W}
                y1={geometry.H * f}
                y2={geometry.H * f}
                stroke="var(--border)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={geometry.area} fill="url(#chartFill)" />
            <path
              d={geometry.line}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <circle cx={geometry.lastX} cy={geometry.lastY} r="3.5" fill="var(--accent)" />
          </svg>
          <div className="chart-foot">
            <span>{values.length} real samples</span>
            <span>
              lo {formatValue(geometry.min, series)} · hi {formatValue(geometry.max, series)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
