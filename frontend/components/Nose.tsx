"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { asset } from "@/lib/config";
import { ChainState, TokenStat, featureVector, odour, startChain } from "@/lib/chain";
import BrainCanvas, { Pulse } from "./BrainCanvas";

// Live Robinhood Chain flow, smelled by a real fly's olfactory circuit.
// Everything runs in this tab: the chain is read from the public RPC, the circuit from
// a 1.6 MB file of real connectome wiring.

type SortKey = "perMin" | "wallets" | "newWallets" | "concentration" | "accel" | "swaps" | "novelty";
const COLS: { key: SortKey; label: string }[] = [
  { key: "perMin", label: "flow/min" },
  { key: "wallets", label: "wallets" },
  { key: "newWallets", label: "new" },
  { key: "concentration", label: "1-addr" },
  { key: "accel", label: "accel" },
  { key: "swaps", label: "swaps" },
  { key: "novelty", label: "novelty" },
];

// A pattern is remembered only when it is unlike everything already stored — the same
// habituation that makes a fly stop reacting to a smell it knows.
const NOVEL_ENOUGH = 0.45;
const ARCHIVE_MAX = 600;

interface Scored extends TokenStat {
  novelty: number;
  nearest: { symbol: string; overlap: number } | null;
  code: number[];
  codeSet: Set<number>;
  pn: Float64Array | null;
  gloms: number[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const num = (x: number) => x.toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function Nose() {
  const [phase, setPhase] = useState<"load" | "run" | "error">("load");
  const [err, setErr] = useState("");
  const [state, setState] = useState<ChainState | null>(null);
  const [rows, setRows] = useState<Scored[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("perMin");
  const [circuit, setCircuit] = useState<any>(null);
  const circuitRef = useRef<any>(null);
  const archive = useRef<{ address: string; code: Set<number> }[]>([]);
  const pulses = useRef<Pulse[]>([]);
  const selectedRef = useRef<string | null>(null);

  useEffect(() => {
    let dead = false;

    const score = (s: ChainState): Scored[] => {
      const c = circuitRef.current;
      const FH = (window as any).FlyHash;
      const live = s.tokens.slice(0, 40);
      if (!c || !FH) return live.map((t) => ({ ...t, code: [], codeSet: new Set<number>(), pn: null, gloms: [], novelty: -1, nearest: null }));

      const vecs = live.map((t) => odour(t, c.gloms.length));
      const smelled = vecs.map((v) => c.smell(v));
      const scored = live.map((t, i) => {
        const { codeSet, code, pn } = smelled[i];
        let seen = 0;
        for (const m of archive.current) {
          if (m.address === t.address) continue;
          const o = FH.overlap(codeSet, m.code);
          if (o > seen) seen = o;
        }
        let best = 0;
        let bestSym: string | null = null;
        live.forEach((u, j) => {
          if (u.address === t.address) return;
          const o = FH.overlap(codeSet, smelled[j].codeSet);
          if (o > best) { best = o; bestSym = u.symbol; }
        });
        return { ...t, code, codeSet, pn, gloms: vecs[i], novelty: 1 - seen, nearest: bestSym ? { symbol: bestSym, overlap: best } : null };
      });
      for (const r of scored) {
        const known = archive.current.some((m) => m.address !== r.address && FH.overlap(r.codeSet, m.code) >= NOVEL_ENOUGH);
        if (!known) archive.current.push({ address: r.address, code: r.codeSet });
      }
      if (archive.current.length > ARCHIVE_MAX) archive.current = archive.current.slice(-ARCHIVE_MAX);
      return scored;
    };

    const stop = startChain((s) => {
      if (dead) return;
      setState(s);
      if (!s.ok) return;
      const scored = score(s);
      setRows(scored);
      // every token in the window sends its own wave, spread across the poll interval,
      // so the circuit is continuously alive with real traffic
      const now = performance.now();
      const queue = scored.filter((r) => r.code.length).slice(0, 26);
      const gap = queue.length ? Math.min(190, 4600 / queue.length) : 0;
      pulses.current = pulses.current.filter((p) => p.at > now);
      queue.forEach((r, i) => {
        pulses.current.push({
          at: now + i * gap,
          gloms: r.gloms,
          pn: r.pn,
          code: r.code,
          strength: r.address === selectedRef.current ? 1 : r.isNew || r.novelty > 0.6 ? 0.8 : 0.42,
          lead: r.address === selectedRef.current,
        });
      });
    });

    (async () => {
      try {
        await new Promise<void>((res, rej) => {
          const el = document.createElement("script");
          el.src = asset("/brain/flyhash.js");
          el.onload = () => res();
          el.onerror = () => rej(new Error("could not load the circuit"));
          document.head.appendChild(el);
        });
        const c = await (window as any).FlyHash.load(asset("/brain/"));
        if (dead) return;
        circuitRef.current = c;
        setCircuit(c);
        setPhase("run");
      } catch (e: any) {
        if (!dead) { setErr(String(e?.message || e)); setPhase("error"); }
      }
    })();

    return () => { dead = true; stop(); };
  }, []);

  const pick = useCallback((t: Scored) => {
    setSelected(t.address);
    selectedRef.current = t.address;
    if (t.code.length) {
      const now = performance.now();
      pulses.current = pulses.current.filter((p) => p.at > now + 260);
      pulses.current.unshift({ at: now, gloms: t.gloms, pn: t.pn, code: t.code, strength: 1, lead: true });
    }
  }, []);

  const shown = [...rows].sort((a, b) => (b[sort] as number) - (a[sort] as number));
  const sel = rows.find((r) => r.address === selected) || null;

  useEffect(() => {
    if (!selected && shown.length && phase === "run") pick(shown[0]);
  }, [shown, selected, pick, phase]);

  if (phase === "error") return <div className="notice">{err}</div>;

  return (
    <>
      <section className="stage">
        <BrainCanvas circuit={circuit} pulses={pulses} />
        <div className="vignette" />

        <div className="hero">
          <div className="kicker">
            <span className={`dot${state?.ok ? " on" : ""}`} />
            {state?.ok ? "live · robinhood chain" : "connecting"}
          </div>
          <h1>A real fly brain,<br />smelling the chain.</h1>
          <p>
            9,515 neurons in their true positions — the fly&apos;s olfactory circuit, wired exactly as the
            connectome maps it. Every token moving on Robinhood Chain is fed to it as a smell, and it
            answers one question: <b>have I smelled this before?</b>
          </p>
        </div>

        {sel && phase === "run" && (
          <div className="focus">
            <div className="fhead2">
              <h2>{sel.symbol}</h2>
              {sel.isNew && <i className="tag">new</i>}
            </div>
            <div className="big">
              <b>{pct(sel.novelty)}</b>
              <span>novelty<small>unlike {archive.current.length} shapes seen</small></span>
            </div>
            <div className="odour">
              {featureVector(sel).map((f) => (
                <div key={f.label} className="frow">
                  <span>{f.label}</span>
                  <i><b style={{ width: `${Math.round(f.value * 100)}%` }} /></i>
                </div>
              ))}
            </div>
            <div className="mini">
              <div><b>{num(sel.code.length)}</b><span>kenyon cells lit</span></div>
              {sel.nearest && <div><b>{sel.nearest.symbol}</b><span>smells like · {pct(sel.nearest.overlap)}</span></div>}
            </div>
          </div>
        )}

        <div className="ticker">
          <div><b>{state?.ok ? num(state.block) : "—"}</b><span>block</span></div>
          <div><b>{state ? num(state.transfersPerMin) : "—"}</b><span>transfers/min</span></div>
          <div><b>{state ? num(state.wallets) : "—"}</b><span>wallets</span></div>
          <div><b>{state ? num(state.tokens.length) : "—"}</b><span>tokens moving</span></div>
          <div><b>{phase === "run" ? "9,515" : "…"}</b><span>neurons live</span></div>
        </div>

        <div className="hint">{phase === "run" ? "drag to turn the brain" : "waking the circuit…"}</div>
      </section>

      <section className="feed">
        <div className="fhead">
          <h2>Everything moving right now</h2>
          <small>3-minute window · click a column to sort · a row to smell it</small>
        </div>
        <div className="tscroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>token</th>
                {COLS.map((c) => (
                  <th key={c.key} className={`sortable${sort === c.key ? " sorted" : ""}`} onClick={() => setSort(c.key)}>{c.label}</th>
                ))}
                <th>smells like</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.address} className={t.address === selected ? "on" : ""} onClick={() => pick(t)}>
                  <td className="sym">{t.symbol}{t.isNew && <i className="tag">new</i>}</td>
                  <td>{num(t.perMin)}</td>
                  <td>{num(t.wallets)}</td>
                  <td className={t.wallets && t.newWallets / t.wallets > 0.6 ? "hi" : ""}>{num(t.newWallets)}</td>
                  <td className={t.concentration > 0.4 ? "hi" : ""}>{pct(t.concentration)}</td>
                  <td className={t.accel > 1.6 ? "up" : t.accel < 0.5 ? "dn" : ""}>{t.accel.toFixed(1)}×</td>
                  <td>{t.swaps || "—"}</td>
                  <td>{t.novelty < 0 ? <span className="pend">·</span> : <span className="nov" style={{ ["--n" as any]: t.novelty }}>{pct(t.novelty)}</span>}</td>
                  <td className="like">{t.nearest ? `${t.nearest.symbol} · ${pct(t.nearest.overlap)}` : t.novelty < 0 ? "·" : "—"}</td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={9} className="empty">reading the chain…</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="how">
        <div>
          <h3>Why a fly</h3>
          <p>
            The mushroom body turns a smell into a sparse code: of 5,177 Kenyon cells only ~5% fire, and
            which 5% depends on the input. Similar inputs share most of their code, unrelated ones almost
            none — the same trick behind locality-sensitive hashing.
          </p>
        </div>
        <div>
          <h3>What you get</h3>
          <p>
            <b>Novelty</b> is how unlike anything already seen a token&apos;s flow pattern is — a new shape of
            activity, not just a new listing. <b>Smells like</b> names the closest token right now. Flow,
            wallets, one-address share and acceleration are raw chain facts and stand on their own.
          </p>
        </div>
        <div>
          <h3>What it is not</h3>
          <p>
            It does not predict price. It compares patterns of on-chain activity. Which measurements become
            which glomeruli is our design; the 9,515 neurons and their synapses are the fly&apos;s.
          </p>
        </div>
      </section>
    </>
  );
}
