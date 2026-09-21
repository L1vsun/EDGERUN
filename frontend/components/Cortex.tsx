"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChainState } from "@/lib/chain";
import { AgentOut, GATE_SEAT, RELAY_SEATS, RELAY_STEP, Round, Viz, appendLog, readLog, runCouncil } from "@/lib/council";

// The council, running in front of you.
//
// Five seats relay in order - Scout reads the chain, Skeptic attacks what Scout said,
// Historian checks the log, Synthesis weighs all three, and a code gate decides whether
// any of it is worth saying. Every round here is computed in this tab from the numbers
// on screen; the relay animation is the actual order of execution, not decoration.
//
// The same relay drives the anatomy behind it: `relay.current.at` is the moment the round
// started, and BrainCanvas lights each region as its seat takes its turn.

const STEP = RELAY_STEP;   // how long each seat holds the floor
const SEATS = RELAY_SEATS; // four regions + the gate

export interface RelayState { at: number }

export default function Cortex({
  state,
  relay,
  onRound,
  onFocus,
  onScan,
}: {
  state: ChainState | null;
  relay: React.MutableRefObject<RelayState>;
  onRound: (r: Round) => void;
  onFocus: (address: string) => void;
  onScan: (address: string) => void;
}) {
  const [round, setRound] = useState<Round | null>(null);
  const [stage, setStage] = useState(SEATS);
  const [open, setOpen] = useState<string | null>(null);
  // what each round measured, kept so the seats can show their own recent past
  const [history, setHistory] = useState<{ speak: boolean; symbol: string; why: string; flow: number; flagged: number }[]>([]);
  const log = useRef<ReturnType<typeof readLog>>([]);
  const lastBlock = useRef(0);

  useEffect(() => { log.current = readLog(); }, []);

  const play = useCallback((s: ChainState) => {
    const { round: r, flagged } = runCouncil(s, log.current);
    log.current = appendLog(log.current, flagged);
    setRound(r);
    onRound(r);
    setHistory((h) => [...h, {
      speak: r.gate.action === "SPEAK", symbol: r.focus?.symbol || "-", why: r.gate.why,
      flow: s.transfersPerMin, flagged: r.flagged,
    }].slice(-28));
    relay.current = { at: performance.now() };
    setStage(0);
  }, [onRound, relay]);

  // a fresh block means fresh numbers: the council re-runs on its own, every poll
  useEffect(() => {
    if (!state?.ok || !state.tokens.length) return;
    if (state.block === lastBlock.current) return;
    lastBlock.current = state.block;
    play(state);
  }, [state, play]);

  // the relay itself: one clock, shared with the specimen behind it
  useEffect(() => {
    if (stage >= SEATS) return;
    let raf = 0;
    const tick = () => {
      const k = Math.floor((performance.now() - relay.current.at) / STEP);
      setStage(Math.min(SEATS, Math.max(0, k)));
      if (k < SEATS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage, relay]);

  const agents = round?.agents || [];
  const speak = round?.gate.action === "SPEAK";
  const running = stage < SEATS;

  return (
    <section className="cortex" id="council">
      <div className="cx-top">
        <div className="cx-title">
          <h2>The council</h2>
          <span className="cx-badge">RULES · IN THIS TAB</span>
        </div>
        <div className="cx-meta">
          {round ? (
            <>
              <span>block <b>{round.block.toLocaleString()}</b></span>
              <span><b>{round.tokensMoving}</b> tokens read</span>
              <span><b>{round.flagged}</b> flagged</span>
              <span><b>{round.rounds}</b> rounds logged</span>
            </>
          ) : (
            <span>waiting for the first block…</span>
          )}
          <button className="cx-run" onClick={() => state?.ok && play(state)} disabled={!state?.ok || running}>
            {running ? "running…" : "run a round"}
          </button>
        </div>
      </div>

      <div className={`cx-board${running ? " live" : ""}`}>
        {agents.map((a, i) => (
          <Module
            key={a.id}
            a={a}
            n={i}
            stage={stage}
            open={open === a.id}
            onToggle={() => setOpen(open === a.id ? null : a.id)}
            onPick={onFocus}
            // Scout has no verdict to meter, so it shows the thing it actually watches:
            // how hard the whole chain has been moving, one bar per round it has read
            extra={a.id === "scout" && history.length > 1 ? (
              <Spark
                values={history.map((h) => h.flow)}
                note={`${Math.round(history[history.length - 1].flow).toLocaleString()} transfers/min · last ${history.length} rounds`}
              />
            ) : null}
          />
        ))}

        <div className={`cx-mod cx-gate${stage > 4 ? " done" : ""}${stage === 4 ? " firing" : ""}${speak ? " speak" : ""}`}>
          <span className="cx-scan" aria-hidden="true"><i /></span>
          <div className="cx-head">
            <span className="cx-n">05</span>
            <b>{GATE_SEAT.name}</b>
            <span className="cx-led" />
          </div>
          <i className="cx-seat">{GATE_SEAT.seat}</i>
          {stage > 3 && round ? (
            <>
              <div className="cx-action">{round.gate.action}</div>
              <p className="cx-lead">{speak ? `${round.focus?.symbol} · confidence ${round.confidence.toFixed(2)}` : "nothing worth saying"}</p>
              <p className="cx-line">{round.gate.why}</p>
              {speak && round.focus && (
                <div className="cx-acts">
                  <button onClick={() => onFocus(round.focus!.address)}>put it in the specimen</button>
                  <button className="cx-act-go" onClick={() => onScan(round.focus!.address)}>pull its paper trail</button>
                </div>
              )}
              <div className="cx-viz">
                <div className="cx-hist">
                  {history.map((h, i) => (
                    <i key={i} className={h.speak ? "on" : ""} title={`${h.symbol} · ${h.why}`} />
                  ))}
                </div>
                <span className="cx-note">
                  {history.filter((h) => h.speak).length} of {history.length} rounds spoke
                </span>
              </div>
            </>
          ) : (
            <p className="cx-wait">waiting on synthesis…</p>
          )}
        </div>
      </div>

      <div className="cx-foot">
        <p>
          The gate stays silent unless confidence and evidence clear a fixed bar, so most rounds say
          nothing - that is the design. Each seat is a rule here, not a language model: it can only
          see what a threshold already knows. The reasoning version runs the same five seats as
          separate model calls and publishes below.
        </p>
      </div>
    </section>
  );
}

function Module({
  a, n, stage, open, onToggle, onPick, extra,
}: {
  a: AgentOut; n: number; stage: number; open: boolean; onToggle: () => void;
  onPick: (address: string) => void; extra?: React.ReactNode;
}) {
  const firing = stage === n;
  const done = stage > n;
  return (
    <div className={`cx-mod cx-${a.id}${firing ? " firing" : ""}${done ? " done" : ""}${open ? " open" : ""}`}>
      <span className="cx-scan" aria-hidden="true"><i /></span>
      {n < 4 && <span className={`cx-wire${firing ? " hot" : ""}`}><i /></span>}
      <button className="cx-head" onClick={onToggle} aria-expanded={open}>
        <span className="cx-n">{String(n + 1).padStart(2, "0")}</span>
        <b>{a.name}</b>
        <span className="cx-led" />
      </button>
      <i className="cx-seat">{a.seat}</i>

      {done || firing ? (
        <>
          {a.viz ? <Readout v={a.viz} /> : extra}
          <p className="cx-lead">{a.lead}</p>
          {a.lines.slice(0, open ? 9 : 3).map((l, i) => (
            <p key={i} className={`cx-line cx-${l.tone}`}>
              {l.address ? (
                <button className="cx-sym" onClick={() => onPick(l.address!)}>{l.symbol}</button>
              ) : l.symbol ? <b>{l.symbol}</b> : null}
              {l.text}
            </p>
          ))}
          {open && (
            <div className="cx-detail">
              <p><span>job</span>{a.job}</p>
              <p><span>reads</span>{a.reads}</p>
              <p><span>saw</span>{a.saw}</p>
            </div>
          )}
          <button className="cx-more" onClick={onToggle}>{open ? "less" : "what it saw"}</button>
        </>
      ) : (
        <p className="cx-wait">waiting…</p>
      )}
    </div>
  );
}

// The readouts. Each is the seat's own working shown as a shape: what it sorted the window
// into, how far its confidence is from the bar it must clear, how much it remembers.
function Readout({ v }: { v: Viz }) {
  if (v.kind === "split") {
    const total = v.parts.reduce((s, p) => s + p.v, 0) || 1;
    return (
      <div className="cx-viz">
        <div className="cx-split">
          {v.parts.map((p, i) => (
            <span key={i} className={`cx-${p.tone}`} style={{ flex: p.v || 0.0001 }} title={`${p.v} of ${total}`} />
          ))}
        </div>
        <span className="cx-note">{v.note}</span>
      </div>
    );
  }
  if (v.kind === "meter") {
    return (
      <div className="cx-viz">
        <div className={`cx-meter${v.value >= v.mark ? " over" : ""}`}>
          <i style={{ width: `${v.value * 100}%` }} />
          <b style={{ left: `${v.mark * 100}%` }} />
        </div>
        <span className="cx-note">{v.note}</span>
      </div>
    );
  }
  return (
    <div className="cx-viz">
      <div className="cx-ticks">
        {Array.from({ length: v.total }, (_, i) => <i key={i} className={i < v.filled ? "on" : ""} />)}
      </div>
      <span className="cx-note">{v.note}</span>
    </div>
  );
}

// one bar per round of whatever the chain has been doing while the council watched
function Spark({ values, note }: { values: number[]; note: string }) {
  const max = Math.max(...values, 1);
  return (
    <div className="cx-viz">
      <div className="cx-spark">
        {values.map((v, i) => (
          <i key={i} style={{ height: `${Math.max(6, (v / max) * 100)}%` }} />
        ))}
      </div>
      <span className="cx-note">{note}</span>
    </div>
  );
}

