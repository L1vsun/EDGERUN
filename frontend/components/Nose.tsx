"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { asset } from "@/lib/config";
import { ChainState, SCAN_BLOCKS, Signal, TokenStat, interest, odour, scanToken, signals, startChain } from "@/lib/chain";
import { Dossier, investigate, readDossier } from "@/lib/osint";
import { Round } from "@/lib/council";
import BrainCanvas, { ModuleMark, Pulse } from "./BrainCanvas";
import ModuleHUD from "./ModuleHUD";
import Cortex from "./Cortex";

// Live Robinhood Chain flow, read through a real olfactory circuit and argued over by five
// modules. Everything runs in this tab: the chain from the public RPC, the circuit from a
// 1.6 MB file of real connectome wiring, the council from the numbers on screen.

type SortKey = "score" | "perMin" | "wallets" | "newWallets" | "concentration" | "accel" | "swaps" | "novelty";
const COLS: { key: SortKey; label: string }[] = [
  { key: "score", label: "worth a look" },
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
  sig: Signal[];
  score: number;
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
  const [sort, setSort] = useState<SortKey>("score");
  const [circuit, setCircuit] = useState<any>(null);
  const circuitRef = useRef<any>(null);
  const archive = useRef<{ address: string; code: Set<number> }[]>([]);
  const rowsRef = useRef<Scored[]>([]);
  const pulses = useRef<Pulse[]>([]);
  const marks = useRef<ModuleMark[]>([]);
  const [say, setSay] = useState<Record<string, string>>({});
  const relay = useRef({ at: 0 });
  const watchRef = useRef<string[]>([]);
  const selectedRef = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const [scan, setScan] = useState<{ busy: boolean; result: Scored | null; error: string }>({ busy: false, result: null, error: "" });
  const [dossier, setDossier] = useState<{ busy: boolean; d: Dossier | null }>({ busy: false, d: null });
  const [watch, setWatch] = useState<string[]>([]);
  const fired = useRef<Record<string, string>>({}); // token -> signals we have already announced
  const [ping, setPing] = useState<{ symbol: string; labels: string } | null>(null);

  // each round the council runs, the callouts on the anatomy say what that region just said
  const onRound = useCallback((r: Round) => {
    const by: Record<string, string> = {};
    for (const a of r.agents) by[a.id] = a.lead;
    by.gate = `${r.gate.action} · ${r.gate.why}`;
    setSay(by);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("edgerun.watch");
      if (raw) setWatch(JSON.parse(raw));
    } catch {
      /* private window or blocked storage: the watchlist just does not persist */
    }
  }, []);

  const toggleWatch = useCallback((address: string) => {
    setWatch((prev) => {
      const next = prev.includes(address) ? prev.filter((a) => a !== address) : [...prev, address];
      try { localStorage.setItem("edgerun.watch", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    let dead = false;

    const score = (s: ChainState): Scored[] => {
      const c = circuitRef.current;
      const FH = (window as any).FlyHash;
      const live = s.tokens.slice(0, 40);
      if (!c || !FH) return live.map((t) => ({ ...t, code: [], codeSet: new Set<number>(), pn: null, gloms: [], novelty: -1, nearest: null, sig: signals(t), score: interest(t) }));

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
        return { ...t, code, codeSet, pn, gloms: vecs[i], novelty: 1 - seen, nearest: bestSym ? { symbol: bestSym, overlap: best } : null, sig: signals(t), score: interest(t) };
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
      if (!s.ok) return;   // keep the last rows on screen; the ticker shows the state
      const scored = score(s);
      setRows(scored);
      rowsRef.current = scored;

      // a starred token that picks up a flag it did not have before is worth saying out loud
      for (const t of scored) {
        if (!watchRef.current.includes(t.address)) continue;
        const now = t.sig.map((g) => g.label).join(" · ");
        const before = fired.current[t.address];
        if (now && now !== before) {
          fired.current[t.address] = now;
          if (before !== undefined) setPing({ symbol: t.symbol, labels: now });
        } else if (!now) {
          fired.current[t.address] = "";
        }
      }
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

  const runScan = useCallback(async (raw: string) => {
    const c = circuitRef.current;
    const FH = (window as any).FlyHash;
    setScan({ busy: true, result: null, error: "" });
    try {
      const stat = await scanToken(raw);
      let result: Scored;
      if (c && FH) {
        const vec = odour(stat, c.gloms.length);
        const { code, codeSet, pn } = c.smell(vec);
        let best = 0;
        let bestSym: string | null = null;
        for (const r of rowsRef.current) {
          if (r.address === stat.address) continue;
          const o = FH.overlap(codeSet, r.codeSet);
          if (o > best) { best = o; bestSym = r.symbol; }
        }
        let seen = 0;
        for (const m of archive.current) {
          if (m.address === stat.address) continue;
          const o = FH.overlap(codeSet, m.code);
          if (o > seen) seen = o;
        }
        result = { ...stat, code, codeSet, pn, gloms: vec, novelty: 1 - seen,
          nearest: bestSym ? { symbol: bestSym, overlap: best } : null, sig: signals(stat), score: interest(stat) };
        pulses.current = pulses.current.filter((p) => p.at > performance.now() + 300);
        pulses.current.unshift({ at: performance.now(), gloms: vec, pn, code, strength: 1, lead: true });
      } else {
        result = { ...stat, code: [], codeSet: new Set<number>(), pn: null, gloms: [], novelty: -1,
          nearest: null, sig: signals(stat), score: interest(stat) };
      }
      setScan({ busy: false, result, error: "" });
      // the public paper trail: who deployed it, what else they have launched, who paid
      setDossier({ busy: true, d: null });
      investigate(result.address, (partial) => setDossier({ busy: true, d: partial }))
        .then((d) => setDossier({ busy: false, d }))
        .catch(() => setDossier({ busy: false, d: null }));
    } catch (e: any) {
      setScan({ busy: false, result: null, error: String(e?.message || e) });
      setDossier({ busy: false, d: null });
    }
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

  // a token named by the council: focus it if it is in the live window, otherwise scan it
  const focusAddress = useCallback((address: string) => {
    const t = rowsRef.current.find((r) => r.address === address);
    if (t) pick(t);
    else { setQuery(address); runScan(address); }
  }, [pick, runScan]);

  const scanAddress = useCallback((address: string) => {
    setQuery(address);
    runScan(address);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [runScan]);

  useEffect(() => { watchRef.current = watch; }, [watch]);

  useEffect(() => {
    if (!ping) return;
    const id = setTimeout(() => setPing(null), 9000);
    return () => clearTimeout(id);
  }, [ping]);

  const shown = [...rows].sort((a, b) => {
    const w = Number(watch.includes(b.address)) - Number(watch.includes(a.address));
    return w || (b[sort] as number) - (a[sort] as number);
  });
  // the handful actually worth interrupting someone for
  const alerts = [...rows].filter((t) => t.sig.length).sort((a, b) => b.score - a.score).slice(0, 4);
  const sel = rows.find((r) => r.address === selected) || null;

  useEffect(() => {
    if (!selected && shown.length && phase === "run") pick(shown[0]);
  }, [shown, selected, pick, phase]);

  if (phase === "error") return <div className="notice">{err}</div>;

  return (
    <>
      <section className="stage">
        <BrainCanvas circuit={circuit} pulses={pulses} marks={marks} relay={relay} />
        {phase === "run" && <ModuleHUD marks={marks} say={say} />}
        <div className="vignette" />
        <div className="reticle" aria-hidden="true">
          <span className="r-tl" /><span className="r-tr" /><span className="r-bl" /><span className="r-br" />
          <span className="r-scale">CONNECTOME 783 · 9,515 NEURONS TRACED · 849,261 SYNAPSES</span>
        </div>

        <div className="hero">
          <div className="rail">
            <span className="stamp">RESTRICTED</span>
            <span><i>CIRCUIT</i> 9,515 neurons</span>
            <span><i>COUNCIL</i> 5 modules</span>
            <span><i>FEED</i> RH Chain 4663</span>
            <span className={`rail-live${state?.ok ? " on" : ""}`}>
              <span className={`dot${state?.ok ? " on" : ""}`} />
              {state?.ok ? "SIGNAL" : state ? "RE-ACQUIRING" : "ACQUIRING"}
            </span>
          </div>
          <div className="title">
            <h1>Five modules<br />read every block.</h1>
          </div>
          <p>
            Four of them argue over the same live chain — what is moving, why it is a trap, what
            followed last time, what it adds up to — and a fifth decides whether any of it is worth
            interrupting you for. Most rounds, it says nothing.
          </p>
          <form
            className="scan"
            onSubmit={(e) => { e.preventDefault(); if (query.trim()) runScan(query); }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="paste any token address — 0x…"
              spellCheck={false}
              aria-label="token contract address"
            />
            <button type="submit" disabled={scan.busy || !query.trim()}>{scan.busy ? "reading…" : "run it"}</button>
          </form>

          {(scan.result || scan.error) && (
            <div className="scanout">
              {scan.error ? (
                <span className="scanerr">{scan.error}</span>
              ) : scan.result ? (
                <>
                  <div className="scanhead">
                    <b>{scan.result.symbol}</b>
                    <span>{num(scan.result.transfers)} transfers · {num(scan.result.wallets)} wallets · last {Math.round(SCAN_BLOCKS / 9 / 60)} min</span>
                    <button className="x" onClick={() => { setScan({ busy: false, result: null, error: "" }); setDossier({ busy: false, d: null }); setQuery(""); }} aria-label="close">×</button>
                  </div>
                  <div className="scanflags">
                    {scan.result.sig.length
                      ? scan.result.sig.map((g) => <i key={g.id} className={`chip chip-${g.tone}`}>{g.label}</i>)
                      : <span className="quiet">nothing unusual in how it is moving</span>}
                  </div>
                  <div className="scanwhy">
                    {scan.result.sig.slice(0, 2).map((g) => <p key={g.id}>{g.why}</p>)}
                    {scan.result.nearest && <p>moves most like <b>{scan.result.nearest.symbol}</b> of everything live right now · {pct(scan.result.nearest.overlap)} of the same neurons.</p>}
                  </div>
                  <div className="dossier">
                    <div className="dos-head">
                      <span>paper trail</span>
                      {dossier.busy && !dossier.d ? <i>pulling records…</i> : dossier.d?.deployer ? (
                        <a href={`https://robinhoodchain.blockscout.com/address/${dossier.d.deployer}`} target="_blank" rel="noreferrer">
                          deployer {dossier.d.deployer.slice(0, 8)}…
                        </a>
                      ) : null}
                    </div>
                    {dossier.d ? (
                      readDossier(dossier.d).map((r, i) => (
                        <p key={i} className={`dos dos-${r.tone}`}>{r.text}</p>
                      ))
                    ) : dossier.busy ? null : (
                      <p className="dos dos-flat">no public record reachable for this address</p>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          )}

          {alerts.length > 0 && (
            <div className="calls">
              {alerts.map((t) => (
                <button key={t.address} className={`call call-${t.sig[0].tone}`} onClick={() => pick(t)}>
                  <b>{t.symbol}</b>
                  <i>{t.sig.slice(0, 3).map((g) => g.label).join(" · ")}</i>
                </button>
              ))}
            </div>
          )}
        </div>

        {sel && phase === "run" && (
          <div className="focus">
            <div className="fhead2">
              <h2>{sel.symbol}</h2>
              <span className="flow">{num(sel.perMin)}/min</span>
              <button
                className={`star${watch.includes(sel.address) ? " on" : ""}`}
                onClick={() => toggleWatch(sel.address)}
                title={watch.includes(sel.address) ? "stop watching" : "watch this — tell me when it changes"}
              >★</button>
            </div>

            <div className="verdict">
              {sel.sig.length ? (
                sel.sig.slice(0, 3).map((g) => (
                  <div key={g.id} className={`sig sig-${g.tone}`}>
                    <b>{g.label}</b>
                    <span>{g.why}</span>
                  </div>
                ))
              ) : (
                <div className="sig sig-flat"><b>quiet</b><span>nothing unusual in how this one is moving</span></div>
              )}
            </div>

            <div className="mini">
              <div><b>{num(sel.wallets)}</b><span>wallets · {pct(sel.wallets ? sel.newWallets / sel.wallets : 0)} new</span></div>
              <div><b>{sel.accel.toFixed(1)}×</b><span>vs its own average</span></div>
              {sel.nearest && <div><b>{sel.nearest.symbol}</b><span>moves most like this · {pct(sel.nearest.overlap)}</span></div>}
            </div>
          </div>
        )}

        <div className="ticker">
          <div><b>{state?.block ? num(state.block) : "—"}</b><span>block</span></div>
          <div><b>{state ? num(state.transfersPerMin) : "—"}</b><span>transfers/min</span></div>
          <div><b>{state ? num(state.wallets) : "—"}</b><span>wallets</span></div>
          <div><b>{state ? num(state.tokens.length) : "—"}</b><span>tokens moving</span></div>
          <div><b>{phase === "run" ? "9,515" : "…"}</b><span>neurons live</span></div>
        </div>

        {ping && (
          <div className="ping" onClick={() => setPing(null)}>
            <b>{ping.symbol}</b>
            <span>{ping.labels}</span>
            <i>watched · just changed</i>
          </div>
        )}

        <div className="hint">{phase === "run" ? "drag to turn the brain" : "waking the circuit…"}</div>
      </section>

      <Cortex state={state} relay={relay} onRound={onRound} onFocus={focusAddress} onScan={scanAddress} />

      <section className="feed">
        <div className="fhead">
          <h2>Everything moving right now</h2>
          <small>3-minute window · ★ to watch · click a column to sort, a row to send it through the circuit</small>
        </div>
        <div className="tscroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>token</th>
                <th>flags</th>
                {COLS.map((c) => (
                  <th key={c.key} className={`sortable${sort === c.key ? " sorted" : ""}`} onClick={() => setSort(c.key)}>{c.label}</th>
                ))}
                <th>moves like</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.address} className={t.address === selected ? "on" : ""} onClick={() => pick(t)}>
                  <td className="sym">
                    <button
                      className={`star${watch.includes(t.address) ? " on" : ""}`}
                      onClick={(e) => { e.stopPropagation(); toggleWatch(t.address); }}
                      title="watch this"
                    >★</button>
                    {t.symbol}
                  </td>
                  <td className="sigs">
                    {t.sig.length ? t.sig.slice(0, 3).map((g) => <i key={g.id} className={`chip chip-${g.tone}`}>{g.label}</i>) : <span className="quiet">quiet</span>}
                  </td>
                  <td>{Math.round(t.score)}</td>
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
              {!shown.length && <tr><td colSpan={11} className="empty">reading the chain…</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="how">
        <div>
          <h3>Why a real circuit</h3>
          <p>
            The mushroom body turns an input into a sparse code: of 5,177 traced cells only ~5% fire, and
            which 5% depends on the input. Similar inputs share most of their code, unrelated ones almost
            none — the same trick behind locality-sensitive hashing. Every synapse drawn here is measured,
            not invented.
          </p>
        </div>
        <div>
          <h3>What the flags mean</h3>
          <p>
            <b>one wallet</b> — a single address sits on most of the transfers, so the volume is one
            actor. <b>printing</b> — new supply is being minted right now. <b>no dex</b> — plenty of
            movement, no swaps. <b>heating</b> — flow is running well above the token&apos;s own average.
            <b>fresh wallets</b> — the buyers are addresses we had not seen before.
          </p>
        </div>
        <div>
          <h3>What it is not</h3>
          <p>
            Not advice and not a price call. Every flag is a plain threshold on measured activity and
            names the number behind it, so you can check it yourself on the explorer. A token with no
            flags is not safe — it is only unremarkable in the last three minutes.
          </p>
        </div>
      </section>
    </>
  );
}
