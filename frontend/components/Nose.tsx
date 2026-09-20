"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { asset } from "@/lib/config";
import { ChainState, TokenStat, featureVector, odour, startChain } from "@/lib/chain";

// The page: live Robinhood Chain token flow on the left, and the fly's olfactory circuit
// scoring it on the right. Both run entirely in this browser tab.

type Circuit = any;
// The circuit remembers a pattern only when it is unlike everything already stored — the
// same habituation that makes a fly stop responding to a familiar smell. So the archive is
// a set of DISTINCT activity shapes, not one entry per poll.
const NOVEL_ENOUGH = 0.45; // overlap below this counts as a shape we have not smelled before
const ARCHIVE_MAX = 600;

interface Scored extends TokenStat {
  novelty: number;
  nearest: { symbol: string; overlap: number } | null;
  code: Set<number>;
  codeList: number[];
}

type SortKey = "perMin" | "wallets" | "newWallets" | "concentration" | "accel" | "swaps" | "novelty";
const COLS: { key: SortKey; label: string }[] = [
  { key: "perMin", label: "flow/min" },
  { key: "wallets", label: "wallets" },
  { key: "newWallets", label: "new" },
  { key: "concentration", label: "1-addr share" },
  { key: "accel", label: "accel" },
  { key: "swaps", label: "swaps" },
  { key: "novelty", label: "novelty" },
];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const num = (x: number, d = 0) => x.toLocaleString(undefined, { maximumFractionDigits: d });

export default function Nose() {
  const [phase, setPhase] = useState<"load" | "run" | "error">("load");
  const [err, setErr] = useState("");
  const [state, setState] = useState<ChainState | null>(null);
  const [rows, setRows] = useState<Scored[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("perMin");
  const circuitRef = useRef<Circuit>(null);
  const archive = useRef<{ address: string; symbol: string; code: Set<number>; at: number }[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paint = useRef<(t: Scored | null) => void>(() => {});

  // ---- read the chain and load the circuit at the same time ----
  // The table does not wait for the circuit: rows appear as soon as the chain answers,
  // and the novelty / smells-like columns fill in once the neurons are in memory.
  useEffect(() => {
    let dead = false;

    const score = (s: ChainState) => {
      const circuit = circuitRef.current;
      const FH = (window as any).FlyHash;
      const live = s.tokens.slice(0, 40);
      if (!circuit || !FH) {
        return live.map((t) => ({ ...t, code: new Set<number>(), codeList: [], novelty: -1, nearest: null })) as Scored[];
      }
      const codes = live.map((t) => circuit.smell(odour(t, circuit.gloms.length)));
      const scored: Scored[] = live.map((t, i) => {
        const { codeSet, code } = codes[i];
        let seenBest = 0;
        for (const m of archive.current) {
          if (m.address === t.address) continue;
          const o = FH.overlap(codeSet, m.code);
          if (o > seenBest) seenBest = o;
        }
        let best = 0;
        let bestSym: string | null = null;
        live.forEach((u, j) => {
          if (u.address === t.address) return;
          const o = FH.overlap(codeSet, codes[j].codeSet);
          if (o > best) {
            best = o;
            bestSym = u.symbol;
          }
        });
        return { ...t, code: codeSet, codeList: code, novelty: 1 - seenBest, nearest: bestSym ? { symbol: bestSym, overlap: best } : null };
      });
      // habituate: remember a shape only if it is unlike everything already known
      const now = Date.now();
      for (const r of scored) {
        const known = archive.current.some((m) => m.address !== r.address && FH.overlap(r.code, m.code) >= NOVEL_ENOUGH);
        if (!known) archive.current.push({ address: r.address, symbol: r.symbol, code: r.code, at: now });
      }
      if (archive.current.length > ARCHIVE_MAX) archive.current = archive.current.slice(-ARCHIVE_MAX);
      return scored;
    };

    const stop = startChain((s) => {
      if (dead) return;
      setState(s);
      if (s.ok) setRows(score(s));
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
        const circuit = await (window as any).FlyHash.load(asset("/brain/"));
        if (dead) return;
        circuitRef.current = circuit;
        setPhase("run");
      } catch (e: any) {
        if (!dead) {
          setErr(String(e?.message || e));
          setPhase("error");
        }
      }
    })();

    return () => {
      dead = true;
      stop();
    };
  }, []);

  // ---- the circuit picture ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || phase !== "run") return;
    const ctx = canvas.getContext("2d")!;
    const circuit = circuitRef.current;
    const { X, Y, layer, N } = circuit.mb;
    const LAY = circuit.L as string[];
    const COL: Record<string, string> = {
      ORN: "#ffffff", ALLN: "#5f6a4a", PN: "#cfff04", KC: "#8fd400",
      MBON: "#ff8a8a", DAN: "#ffd682", LH: "#4a5a30", APL: "#8ad4ff",
    };
    let raf = 0;
    let t0 = performance.now();
    let active: Set<number> = new Set();
    let pnHot: Float64Array | null = null;
    let current: Scored | null = null;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, canvas.clientWidth * dpr);
      canvas.height = Math.max(1, canvas.clientHeight * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    paint.current = (t) => {
      current = t;
      t0 = performance.now();
      if (!t) {
        active = new Set();
        pnHot = null;
        return;
      }
      active = t.code;
      pnHot = circuit.smell(odour(t, circuit.gloms.length)).pn;
    };

    function frame(now: number) {
      if (!canvas) return;
      const W = canvas.width;
      const H = canvas.height;
      const wave = Math.min(1.15, (now - t0) / 700); // signal sweeping down the pathway
      ctx.fillStyle = "#070a03";
      ctx.fillRect(0, 0, W, H);
      const r = Math.max(1, Math.min(W, H) / 420);

      let pnMax = 1;
      if (pnHot) for (const v of pnHot) if (v > pnMax) pnMax = v;

      for (let i = 0; i < N; i++) {
        const name = LAY[layer[i]];
        const x = (X[i] / 65535) * (W - 24) + 12;
        const y = (Y[i] / 65535) * (H - 24) + 12;
        const depth = Y[i] / 65535;
        let on = 0;
        if (current) {
          if (name === "KC") on = active.has(circuit.kcPos[i]) ? 1 : 0;
          else if (name === "PN" && pnHot) on = Math.max(0, pnHot[circuit.pnPos[i]] / pnMax);
          else if (name === "ORN" || name === "ALLN") on = 0.55;
          else if (name === "MBON" || name === "DAN" || name === "APL") on = active.size ? 0.75 : 0;
        }
        const lit = on > 0.02 && wave > depth ? Math.min(1, on * (1 - Math.max(0, depth - wave) * 6)) : 0;
        ctx.globalAlpha = lit ? 0.25 + 0.75 * lit : 0.1;
        ctx.fillStyle = lit ? COL[name] : "#1b2210";
        ctx.beginPath();
        ctx.arc(x, y, lit ? r * (name === "KC" ? 1.5 : 2) : r, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [phase]);

  const pick = useCallback((t: Scored) => {
    setSelected(t.address);
    paint.current(t);
  }, []);

  const shown = [...rows].sort((a, b) => (b[sort] as number) - (a[sort] as number));
  const sel = rows.find((r) => r.address === selected) || null;

  useEffect(() => {
    if (!selected && shown.length && phase === "run") pick(shown[0]);
  }, [shown, selected, pick, phase]);
  useEffect(() => {
    if (sel) paint.current(sel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.address, sel?.transfers]);

  if (phase === "error") return <div className="wrap notice">{err}</div>;

  return (
    <div className="wrap">
      <section className="lede">
        <h1>What is moving on Robinhood Chain — and what it smells like</h1>
        <p>
          Every ERC-20 transfer and DEX swap on the chain, read live in your browser. Each token&apos;s
          activity is then fed to a real fly&apos;s olfactory circuit — 9,515 neurons wired exactly as
          they are in the connectome — which is built to answer one question: <b>have I smelled this before?</b>
        </p>
      </section>

      <section className="bar">
        <div><b>{state?.ok ? num(state.block) : "—"}</b><span>block</span></div>
        <div><b>{state ? num(state.transfersPerMin) : "—"}</b><span>transfers / min</span></div>
        <div><b>{state ? num(state.wallets) : "—"}</b><span>active wallets</span></div>
        <div><b>{state ? num(state.tokens.length) : "—"}</b><span>tokens moving</span></div>
        <div className={state?.ok ? "ok" : "bad"}><b>{phase === "load" ? "waking" : state?.ok ? "live" : "reconnecting"}</b><span>3-minute window</span></div>
      </section>

      <div className="cols">
        <section className="panel">
          <div className="phead"><h2>Live tokens</h2><small>click a column to sort · a row to smell it</small></div>
          <div className="tscroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>token</th>
                  {COLS.map((c) => (
                    <th key={c.key} className={`sortable${sort === c.key ? " sorted" : ""}`} onClick={() => setSort(c.key)}>
                      {c.label}
                    </th>
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
                {!rows.length && (
                  <tr><td colSpan={9} className="empty">reading the chain…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel side">
          <div className="phead"><h2>{sel && phase === "run" ? sel.symbol : "circuit"}</h2><small>{phase !== "run" ? "waking 9,515 neurons…" : sel ? `${num(sel.transfers)} transfers in window` : "9,515 real neurons"}</small></div>
          <canvas ref={canvasRef} className="circuit" />
          <div className="legend">
            {["ORN", "PN", "KC", "MBON"].map((k) => (
              <span key={k} className={`lg lg-${k}`}>{k === "ORN" ? "sensory" : k === "PN" ? "projection" : k === "KC" ? "kenyon" : "output"}</span>
            ))}
          </div>
          {sel && (
            <>
              <div className="odour">
                {featureVector(sel).map((f) => (
                  <div key={f.label} className="frow">
                    <span>{f.label}</span>
                    <i><b style={{ width: `${Math.round(f.value * 100)}%` }} /></i>
                  </div>
                ))}
              </div>
              <div className="readout">
                <div><b>{pct(sel.novelty)}</b><span>novelty — unlike the {archive.current.length} shapes remembered</span></div>
                <div><b>{sel.codeList.length}</b><span>kenyon cells firing, of 5,177</span></div>
                {sel.nearest && <div><b>{sel.nearest.symbol}</b><span>closest match · {pct(sel.nearest.overlap)} code overlap</span></div>}
              </div>
            </>
          )}
        </section>
      </div>

      <section className="how">
        <div>
          <h3>Why a fly</h3>
          <p>
            The mushroom body turns a smell into a sparse code: of 5,177 Kenyon cells, only ~5% fire, and
            which 5% depends on the input. Similar inputs share most of their code, unrelated ones share
            almost none. That makes it a fast similarity index — the same trick behind
            locality-sensitive hashing.
          </p>
        </div>
        <div>
          <h3>What you get</h3>
          <p>
            <b>Novelty</b> is how unlike anything already seen a token&apos;s flow pattern is — a brand-new
            shape of activity, not just a new token. <b>Smells like</b> names the token whose pattern is
            closest right now. The flow, wallet and concentration columns are raw chain facts and stand on
            their own.
          </p>
        </div>
        <div>
          <h3>What it is not</h3>
          <p>
            It does not predict price and makes no claim about what a token will do. It compares patterns
            of on-chain activity. Which measurements become which glomeruli is our design; the 9,515
            neurons and their synapses are the fly&apos;s.
          </p>
        </div>
      </section>
    </div>
  );
}
