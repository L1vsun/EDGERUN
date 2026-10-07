// Five modules reading the tape, running in this tab.
//
// This is the deterministic version of the same pipeline `brain/council_rules.py` runs on
// a schedule: same four seats, same thresholds, same gate, same order. The difference is
// only where it runs - here it runs on the numbers that are on your screen, this second,
// instead of on a snapshot taken up to half an hour ago.
//
// It is RULES, not reasoning, and the UI says so. Each sentence below is assembled from a
// number the feed reported seconds earlier; no model has seen any of it. The reasoning
// version (each seat a model call) cannot run in a static page - it needs a key -
// so it publishes `council.json` from a scheduled job and the page reads that separately.

import { ChainState, TokenStat, signals } from "./chain";

export type AgentId = "scout" | "skeptic" | "historian" | "synthesis" | "gate";
export type Tone = "bad" | "good" | "flat";

export interface AgentLine {
  text: string;
  tone: Tone;
  symbol?: string;
  address?: string;
}

// A small readout per seat, drawn from the same numbers it just judged - a split bar of
// what it sorted the window into, a meter against the bar it has to clear, or a tick row
// of how much memory it has. Every one names the number under it.
export type Viz =
  | { kind: "split"; parts: { v: number; tone: Tone }[]; note: string }
  | { kind: "meter"; value: number; mark: number; note: string }
  | { kind: "ticks"; filled: number; total: number; note: string };

export interface AgentOut {
  id: AgentId;
  name: string;
  seat: string;        // the structure it is anchored to in the specimen
  job: string;         // what this seat is for, in one line
  reads: string;       // what it is allowed to see
  saw: string;         // what it actually consumed this round
  lead: string;        // its one-sentence answer
  lines: AgentLine[];  // the evidence behind it
  viz?: Viz;
}

export interface Round {
  at: number;
  block: number;
  tokensMoving: number;
  flagged: number;
  agents: AgentOut[];
  gate: { action: "SPEAK" | "SILENCE"; why: string };
  focus: { symbol: string; address: string } | null;
  confidence: number;
  rounds: number;      // how long the local log is, for the Historian's honesty
}

interface Flagged extends TokenStat {
  flags: string[];
}

interface LogTok { symbol: string; perMin: number; flags: string[] }
interface LogEntry { at: number; tokens: LogTok[] }

// The relay clock, shared by the board and the specimen behind it: each seat holds the
// floor for RELAY_STEP ms, in the order they actually execute.
export const RELAY_STEP = 620;
export const RELAY_SEATS = 5;

const LOG_KEY = "edgerun.rounds";
const LOG_KEEP = 40;
const MIN_CONFIDENCE = 0.55;

// what each flag is worth when deciding whether anything deserves saying out loud
// Calibrated so the gate is quiet by default, which on this feed takes deliberate effort: a
// trending list is, by construction, a list of tokens that are heating. Wired to it with the
// old weights the gate spoke EVERY round - once about a token with 34 trades and 18 wallets
// behind it - and with two-flags-is-enough it still spoke three rounds out of three.
//
// So: one good sign names nothing. Two name a token to watch and leave the gate shut. Only
// all three together - volume above its own hour, buyers outnumbering sellers, and most of
// the wallets trading it new to it - clear the bar. Anything negative costs more than all
// three earn.
const WEIGHT: Record<string, number> = {
  heating: 0.09, "buyers lead": 0.07, "new holders": 0.07,
  "top-heavy": -0.3, "mint open": -0.34, "sellers lead": -0.2, cooling: -0.12,
};
const BASE_CONFIDENCE = 0.34;
// What a token needs behind it before Synthesis may name it or the gate may speak about it.
// Five minutes of tape: a hundred trades from forty wallets is a market, less is a rumour.
const MIN_TRADES = 100;
const MIN_TRADERS = 40;
const TOO_SMALL = 60; // below this Skeptic says nothing either way

const n0 = (x: number) => Math.round(x).toLocaleString();
const pct = (x: number) => `${Math.round(x * 100)}%`;

// ---- the local round log: the only thing that compounds ----

export function readLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch {
    return []; // private window or blocked storage: the Historian just has nothing to match on
  }
}

export function appendLog(log: LogEntry[], tokens: Flagged[]): LogEntry[] {
  const entry: LogEntry = {
    at: Date.now(),
    tokens: tokens.slice(0, 12).map((t) => ({ symbol: t.symbol, perMin: Math.round(t.perMin), flags: t.flags })),
  };
  const next = [...log, entry].slice(-LOG_KEEP);
  try { localStorage.setItem(LOG_KEY, JSON.stringify(next)); } catch {}
  return next;
}

// ---- the four seats ----

function scout(toks: Flagged[], moving: number): AgentOut {
  const flagged = toks.filter((t) => t.flags.length);
  const top = [...(flagged.length ? flagged : toks)].sort((a, b) => b.perMin - a.perMin).slice(0, 3);
  const lines: AgentLine[] = top.map((t) => {
    let what: string;
    if (t.flags.includes("heating")) what = `${n0(t.perMin)} trades/min, ${t.accel.toFixed(1)}x its own hourly average`;
    else if (t.flags.includes("top-heavy")) what = `${n0(t.perMin)}/min but the ten largest wallets hold ${pct(t.top10)} of it`;
    else if (t.flags.includes("mint open")) what = `the mint authority is still live while ${n0(t.traders)} wallets trade it`;
    else if (t.flags.includes("buyers lead")) what = `${t.buys} buys against ${t.sells} sells, ${n0(t.perMin)}/min across ${n0(t.traders)} wallets`;
    else what = `${n0(t.perMin)} trades/min across ${n0(t.traders)} wallets`;
    return { text: what, tone: "flat" as Tone, symbol: t.symbol, address: t.address };
  });
  return {
    id: "scout",
    name: "SCOUT",
    seat: "antennal lobe · sensory in",
    job: "says what is happening, with no opinion about it",
    reads: "the raw five-minute tape only",
    saw: `${moving} tokens moving · ${toks.length} in the window · ${flagged.length} flagged`,
    lead: flagged.length
      ? `${moving} tokens moving · ${flagged.length} showing something worth a look`
      : `${moving} tokens moving, none of them doing anything unusual`,
    lines,
  };
}

function skeptic(toks: Flagged[], scoutOut: AgentOut): AgentOut {
  const traps: AgentLine[] = [];
  const clean: string[] = [];
  for (const t of toks) {
    if (t.flags.includes("top-heavy")) {
      traps.push({ text: `the ten largest wallets hold ${pct(t.top10)} of supply - that is a handful of holders, not demand`, tone: "bad", symbol: t.symbol, address: t.address });
    } else if (t.flags.includes("mint open")) {
      traps.push({ text: `the mint authority is still live - supply can grow under whoever is buying`, tone: "bad", symbol: t.symbol, address: t.address });
    } else if (t.trades < TOO_SMALL) {
      continue; // too small to judge either way; saying nothing is the correct answer
    } else if (t.flags.includes("sellers lead")) {
      traps.push({ text: `${t.sells} sells against ${t.buys} buys in five minutes - more leaving than arriving`, tone: "bad", symbol: t.symbol, address: t.address });
    } else if (t.buys >= t.sells * 0.8 && t.top10 < 0.3) {
      clean.push(t.symbol);
    }
  }
  const lines = traps.slice(0, 4);
  if (clean.length) lines.push({ text: `looks clean: ${clean.slice(0, 5).join(", ")}`, tone: "good" });
  const small = toks.length - traps.length - clean.length;
  return {
    viz: {
      kind: "split",
      parts: [{ v: traps.length, tone: "bad" }, { v: clean.length, tone: "good" }, { v: Math.max(0, small), tone: "flat" }],
      note: `${traps.length} trap · ${clean.length} clean · ${Math.max(0, small)} too small to judge`,
    },
    id: "skeptic",
    name: "SKEPTIC",
    seat: "lateral horn · innate valence",
    job: "argues the bear case against whatever Scout just said",
    reads: "the same numbers, plus Scout's report",
    saw: `${toks.length} tokens re-read after Scout · ${scoutOut.lines.length} of them named`,
    lead: traps.length
      ? `${traps.length} of the ${toks.length} busiest are top-heavy, printable or being sold`
      : "nothing in this window matches a known trap pattern",
    lines,
  };
}

function historian(toks: Flagged[], log: LogEntry[]): AgentOut {
  const base = {
    id: "historian" as const,
    name: "HISTORIAN",
    seat: "mushroom body · memory",
    job: "checks what followed last time something carried these same flags",
    reads: "the numbers, plus every round this browser has logged",
    saw: `${log.length} round${log.length === 1 ? "" : "s"} in the local log`,
    viz: { kind: "ticks" as const, filled: log.length, total: LOG_KEEP, note: `${log.length} of ${LOG_KEEP} rounds remembered · kept in this browser` },
  };
  if (log.length < 3) {
    return { ...base, lead: "none yet - the log needs a few more rounds before it can compare", lines: [] };
  }

  // index every token ever logged: symbol -> [round index, per_min, flags]
  const seen = new Map<string, { i: number; perMin: number; flags: string[] }[]>();
  log.forEach((entry, i) => {
    for (const t of entry.tokens) {
      const list = seen.get(t.symbol) || [];
      list.push({ i, perMin: t.perMin, flags: t.flags });
      seen.set(t.symbol, list);
    }
  });

  const lines: AgentLine[] = [];
  for (const now of toks.filter((t) => t.flags.length).slice(0, 3)) {
    const want = new Set(now.flags);
    let best: { score: number; sym: string; then: number; later: number; n: number } | null = null;
    seen.forEach((hist, sym) => {
      if (sym === now.symbol || hist.length < 2) return;
      const last = hist[hist.length - 1];
      for (let k = 0; k < hist.length - 1; k++) {
        const h = hist[k];
        let overlap = 0;
        for (const f of h.flags) if (want.has(f)) overlap++;
        if (!overlap || last.i <= h.i) continue;
        const score = overlap - Math.abs(want.size - h.flags.length) * 0.5;
        if (!best || score > best.score) best = { score, sym, then: h.perMin, later: last.perMin, n: hist.length };
      }
    });
    if (best) {
      const b: { score: number; sym: string; then: number; later: number; n: number } = best;
      const change = b.then > 0 ? (b.later - b.then) / b.then : 0;
      const dir = change < -0.15 ? "fell" : change > 0.15 ? "rose" : "held";
      lines.push({
        text: `${b.sym} carried the same flags at ${n0(b.then)}/min and its flow ${dir} to ${n0(b.later)}/min over ${b.n} rounds`,
        tone: dir === "fell" ? "bad" : dir === "rose" ? "good" : "flat",
        symbol: now.symbol,
        address: now.address,
      });
    }
  }
  return {
    ...base,
    lead: lines.length
      ? `${lines.length} of the flagged tokens resemble something already in the log`
      : "nothing in the log carries these flags yet",
    lines,
  };
}

function synthesis(toks: Flagged[], sk: AgentOut, hi: AgentOut): { out: AgentOut; focus: Flagged | null; confidence: number } {
  const trapped = new Set(sk.lines.filter((l) => l.tone === "bad").map((l) => l.symbol));
  let best: Flagged | null = null;
  let score = 0;
  for (const t of toks) {
    if (t.trades < MIN_TRADES || t.traders < MIN_TRADERS) continue;
    if (t.quote) continue; // a quote asset: everything is priced against it, so it is always busy
    let s = 0;
    for (const f of t.flags) s += WEIGHT[f] || 0;
    s += Math.min(0.03, t.perMin / 5000); // a little credit for actually moving - never a flag's worth
    if (s > score) { best = t; score = s; }
  }

  const base = {
    id: "synthesis" as const,
    name: "SYNTHESIS",
    seat: "MBON · convergence",
    job: "weighs all three and names one token, or none",
    reads: "the numbers and all three reports above",
    saw: `${toks.length} tokens weighed · ${trapped.size} vetoed by Skeptic · ${hi.lines.length} with precedent`,
  };
  const meter = (conf: number): Viz => ({
    kind: "meter", value: Math.max(0, Math.min(1, conf)), mark: MIN_CONFIDENCE,
    note: `confidence ${conf.toFixed(2)} · the gate opens at ${MIN_CONFIDENCE}`,
  });

  if (!best || score < 0.15) {
    return {
      out: {
        ...base,
        viz: meter(Math.min(0.4, score)),
        lead: "nothing in this window is worth acting on",
        lines: [{ text: `${trapped.size} of the busiest tripped a trap pattern; the rest are trading normally or are too small to read.`, tone: "flat" }],
      },
      focus: null,
      confidence: Math.min(0.4, score),
    };
  }

  const b: Flagged = best;
  let conf = Math.min(0.86, BASE_CONFIDENCE + score);
  const lines: AgentLine[] = [{
    text: `${n0(b.perMin)} trades/min across ${n0(b.traders)} wallets, ${b.accel.toFixed(1)}x its own hourly average, top ten hold ${pct(b.top10)}, ${b.buys} buys against ${b.sells} sells.`,
    tone: "flat",
  }];
  if (trapped.has(b.symbol)) {
    conf = conf - 0.2;
    lines.push({ text: `overruled: Skeptic flagged ${b.symbol} - kept because the flow is broad enough to be worth watching anyway`, tone: "bad" });
  }
  return {
    out: {
      ...base,
      viz: meter(conf),
      lead: `${b.symbol} is the one to watch - ${b.flags.join(", ") || "on flow alone"}`,
      lines,
    },
    focus: b,
    confidence: Math.round(conf * 100) / 100,
  };
}

// The gate is code in both versions, and silence is the default. It needs no justification
// to stay quiet; it needs one to speak.
function gate(focus: Flagged | null, confidence: number): { action: "SPEAK" | "SILENCE"; why: string } {
  if (confidence < MIN_CONFIDENCE) return { action: "SILENCE", why: `confidence ${confidence.toFixed(2)} is under the ${MIN_CONFIDENCE} bar` };
  if (!focus) return { action: "SILENCE", why: "synthesis named nothing to stand behind" };
  if (focus.trades < MIN_TRADES) return { action: "SILENCE", why: `${focus.symbol} has only ${focus.trades} trades - too few to stand behind` };
  return { action: "SPEAK", why: `confidence ${confidence.toFixed(2)} on ${focus.symbol}, ${n0(focus.trades)} trades behind it` };
}

export function runCouncil(state: ChainState, log: LogEntry[]): { round: Round; flagged: Flagged[] } {
  // "new launch" is a fact about age, not a sign of anything, and a feed of recent launches
  // carries it on every row: it is shown in the table and kept out of what the seats weigh.
  const toks: Flagged[] = state.tokens.slice(0, 40).map((t) => ({ ...t, flags: signals(t).filter((s) => s.id !== "new").map((s) => s.label) }));
  const sc = scout(toks, state.tokens.length);
  const sk = skeptic(toks, sc);
  const hi = historian(toks, log);
  const sy = synthesis(toks, sk, hi);
  const g = gate(sy.focus, sy.confidence);

  return {
    flagged: toks.filter((t) => t.flags.length),
    round: {
      at: Date.now(),
      block: state.block,
      tokensMoving: state.tokens.length,
      flagged: toks.filter((t) => t.flags.length).length,
      agents: [sc, sk, hi, sy.out],
      gate: g,
      focus: sy.focus ? { symbol: sy.focus.symbol, address: sy.focus.address } : null,
      confidence: sy.confidence,
      rounds: log.length,
    },
  };
}

export const GATE_SEAT = { name: "GATE", seat: "basal ganglia · output", job: "decides whether any of this is worth saying out loud", reads: "Synthesis only - and it is code, not a model" };
