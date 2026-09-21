"use client";

import { useEffect, useState } from "react";
import { asset } from "@/lib/config";

// Four Claude calls with different prompts, wired like brain regions, arguing about what
// the chain is doing — then a code gate that decides whether it is worth saying.
// They cannot run in the browser (a static page cannot hold an API key), so a scheduled
// job publishes this file and the page reads it. See brain/README-council.md.

interface Region { id: string; name: string; region: string; says: any }
interface Round {
  mode?: "rules" | "live";
  sample?: boolean;
  generated_at: string;
  model: string;
  block: number;
  window_seconds: number;
  regions: Region[];
  gate: { action: string; why: string };
  usage: { usd: number; cache_read: number };
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

// each region reports its own shape; show what it said without pretending to normalise it
function Says({ r }: { r: Region }) {
  const s = r.says;
  if (!s) return <p className="c-none">no answer</p>;
  if (s.error) return <p className="c-err">{s.error}</p>;
  switch (r.id) {
    case "scout":
      return (
        <>
          <p className="c-lead">{s.headline}</p>
          {(s.tokens || []).map((t: any, i: number) => (
            <p key={i} className="c-line"><b>{t.symbol}</b> {t.what}</p>
          ))}
        </>
      );
    case "skeptic":
      return (
        <>
          <p className="c-lead">{s.verdict}</p>
          {(s.traps || []).map((t: any, i: number) => (
            <p key={i} className="c-line c-bad"><b>{t.symbol}</b> {t.why}</p>
          ))}
          {!!(s.clean || []).length && <p className="c-line c-ok">looks clean: {s.clean.join(", ")}</p>}
        </>
      );
    case "historian":
      return (
        <>
          <p className="c-lead">{s.precedent}</p>
          {(s.matches || []).map((m: any, i: number) => (
            <p key={i} className="c-line"><b>{m.now}</b> looks like <b>{m.before}</b> — {m.what_followed}</p>
          ))}
          <p className="c-meta">confidence in the match: {s.confidence}</p>
        </>
      );
    default:
      return (
        <>
          <p className="c-lead">{s.call}</p>
          <p className="c-line">{s.reason}</p>
          {s.overruled ? <p className="c-line c-meta">overruled: {s.overruled}</p> : null}
        </>
      );
  }
}

export default function Council() {
  const [round, setRound] = useState<Round | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch(asset("/brain/council.json"))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setRound)
      .catch(() => setMissing(true));
  }, []);

  if (missing) return null;
  if (!round) return null;

  const synth = round.regions.find((r) => r.id === "synthesis");
  const spoke = round.gate.action === "SPEAK";

  return (
    <section className="council">
      <div className="fhead">
        <h2>The published round</h2>
        <small>
          the same five seats, run off-page · {ago(round.generated_at)}
          {round.usage?.usd ? ` · $${round.usage.usd.toFixed(3)}/round` : ""}
        </small>
      </div>

      <p className={`c-mode ${round.mode === "live" ? "live" : ""}`}>
        {round.mode === "live" ? (
          <>
            <b>v2 · reasoning</b> Each region is a separate {round.model} call with its own prompt, arguing
            over the same live chain data.
          </>
        ) : (
          <>
            <b>v1 · rules</b> The pipeline is live and the data is real, measured on-chain seconds ago —
            but each region decides by rule, not by reasoning. The language models take over these four
            seats in v2; the wiring, the data and the gate do not change.
          </>
        )}
      </p>

      <div className={`c-verdict ${spoke ? "on" : ""}`}>
        <span className="c-gate">{round.gate.action}</span>
        <div>
          <b>{spoke ? (synth?.says?.call ?? "—") : "nothing worth acting on"}</b>
          <span>{round.gate.why}</span>
        </div>
      </div>

      <div className="c-grid">
        {round.regions.map((r) => (
          <div key={r.id} className={`c-region c-${r.id}`}>
            <div className="c-head">
              <b>{r.name}</b>
              <i>{r.region}</i>
            </div>
            <Says r={r} />
          </div>
        ))}
      </div>

      <p className="c-foot">
        This is the scheduled run, minutes old — the board above is the same pipeline recomputed in
        your tab on the numbers you can see. Four regions, each with its own slice of the data, reporting in order — Scout sees the chain,
        Skeptic sees Scout, Historian sees the log of every past round, Synthesis sees all three. The
        gate is code in both versions: it stays silent unless confidence and evidence clear a fixed bar,
        which is why it often says nothing. Rounds are minutes old; the chain data above this is live.
      </p>
    </section>
  );
}
