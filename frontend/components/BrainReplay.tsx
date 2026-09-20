import trace from "@/public/brain/trace.json";
import experiment from "@/public/brain/experiment.json";
import { asset } from "@/lib/config";

// Everything here is rendered at build time from two JSON files written by
// brain/run.py and brain/experiment.py. It is a RECORDED replay, not a live
// simulation: the fly model needs ~2 GB of RAM and a compiler, which the
// free-tier backend does not have.

type Ev = { address: string; symbol: string | null; verdict: string; failed_checks: string[] };
type Out = { feeding: number; head: number; descending: number; active_neurons: number };
type Cycle = {
  cycle: number;
  events: Ev[];
  sense: Record<string, number>;
  brain: Out;
  control: Out;
  gate: { action: string; because: string[]; brain_weight: number };
};
type Trace = {
  meta: {
    generated_at: string; neurons: number; synapses: number; batch: number; dur_ms: number;
    hz_per_event: number; hz_max: number; shuffle_seed: number; rest_cycles: number;
    channels: Record<string, number>; readouts: Record<string, number>;
  };
  cycles: Cycle[];
};
type Cond = { name: string; mean: Out; sd: Out };
type Exp = { meta: { generated_at: string; trials: number; dur_ms: number }; conditions: Cond[] };

const T = trace as unknown as Trace;
const E = experiment as unknown as Exp;

const READOUTS = ["feeding", "head", "descending"] as const;

function Bar({ v, max, tone }: { v: number; max: number; tone: "real" | "ctrl" }) {
  return (
    <span className={`bar ${tone}`}>
      <i style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
    </span>
  );
}

const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

export default function BrainReplay() {
  const { meta, cycles } = T;
  const withEvents = cycles.filter((c) => c.events.length > 0);
  const stimulated = cycles.filter((c) => Object.keys(c.sense).length > 0);
  const nEvents = cycles.reduce((n, c) => n + c.events.length, 0);
  const nFlagged = cycles.reduce((n, c) => n + c.events.filter((e) => e.verdict === "FAIL").length, 0);
  const nAlerts = cycles.filter((c) => c.gate.action === "ALERT").length;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const realActive = avg(stimulated.map((c) => c.brain.active_neurons));
  const ctrlActive = avg(stimulated.map((c) => c.control.active_neurons));
  const max: Record<string, number> = {};
  for (const k of READOUTS) {
    max[k] = Math.max(0.01, ...cycles.flatMap((c) => [c.brain[k], c.control[k]]));
  }
  const expMax = Math.max(1, ...E.conditions.map((c) => c.mean.feeding + c.sd.feeding));
  const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

  return (
    <>
      <section className="block">
        <div className="container-wide">
          <div className="stat-row panel">
            <div className="stat-tile">
              <div className="stat-tile-head"><span className="stat-tile-label">neurons</span><span className="stat-pill">real</span></div>
              <div className="stat-tile-value">{meta.neurons.toLocaleString()}</div>
              <div className="stat-tile-sub">adult fly brain, FlyWire 783</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-head"><span className="stat-tile-label">synapses</span></div>
              <div className="stat-tile-value">{(meta.synapses / 1e6).toFixed(2)}M</div>
              <div className="stat-tile-sub">every one simulated</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-head"><span className="stat-tile-label">scans replayed</span></div>
              <div className="stat-tile-value">{nEvents}</div>
              <div className="stat-tile-sub">{nEvents - nFlagged} clean · {nFlagged} flagged, all real</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-head"><span className="stat-tile-label">wiring effect</span></div>
              <div className="stat-tile-value ok">{fmtK(realActive)} vs {fmtK(ctrlActive)}</div>
              <div className="stat-tile-sub">active neurons, real vs scrambled</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-head"><span className="stat-tile-label">gate alerts</span></div>
              <div className="stat-tile-value fail">{nAlerts}</div>
              <div className="stat-tile-sub">of {withEvents.length} cycles · brain weight 0</div>
            </div>
          </div>
        </div>
      </section>

      <section className="block">
        <div className="container-wide">
          <div className="feed-section-head">
            <h2>The replay</h2>
            <span className="live-pill">recorded {when(meta.generated_at)} · not live</span>
          </div>
          <p className="brain-note">
            Each row is one brain cycle: {meta.batch} real scans become sensory input for {meta.dur_ms} ms
            of brain time (clean scan → sugar-taste neurons, flagged scan → bitter-taste neurons,
            {" "}{meta.hz_per_event} Hz per scan). Bars show what the brain&apos;s motor and descending
            neurons did. The grey bar is the same brain with its wiring scrambled. Bars are scaled within
            {" "}each column, so compare the numbers across columns, not the bar lengths.
          </p>
          <div className="brain-legend">
            <span className="real"><i />real connectome</span>
            <span className="ctrl"><i />scrambled control (same neurons, same synapse count)</span>
          </div>
          <div className="panel brain-wrap">
            <table className="brain-table">
              <thead>
                <tr>
                  <th>#</th><th>input</th><th>scans</th>
                  {READOUTS.map((k) => (
                    <th key={k}>{k} <small>Hz · {meta.readouts[k]} n</small></th>
                  ))}
                  <th>active neurons</th><th>gate</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => {
                  const rest = c.events.length === 0;
                  return (
                    <tr key={c.cycle} className={rest ? "rest" : ""}>
                      <td>{c.cycle}</td>
                      <td>
                        {rest ? <span className="pill pill-rest">no input</span> : (
                          Object.entries(c.sense).map(([k, hz]) => (
                            <span key={k} className={`pill pill-${k}`}>{k} {hz} Hz</span>
                          ))
                        )}
                      </td>
                      <td className="scans">
                        {rest ? "—" : c.events.map((e, i) => (
                          <span key={e.address} className={e.verdict === "FAIL" ? "flagged" : ""}>
                            {i ? ", " : ""}{e.symbol ?? `${e.address.slice(0, 8)}…`}
                          </span>
                        ))}
                      </td>
                      {READOUTS.map((k) => (
                        <td key={k}>
                          <div className="bcell">
                            <b>{c.brain[k]}</b>
                            <Bar v={c.brain[k]} max={max[k]} tone="real" />
                            <Bar v={c.control[k]} max={max[k]} tone="ctrl" />
                          </div>
                        </td>
                      ))}
                      <td>
                        <b>{c.brain.active_neurons.toLocaleString()}</b>
                        <span className="dim"> / {c.control.active_neurons.toLocaleString()}</span>
                      </td>
                      <td>
                        <span className={`pill ${c.gate.action === "ALERT" ? "pill-FAIL" : "pill-silence"}`}>{c.gate.action}</span>
                        {c.gate.because.map((b) => <div key={b} className="dim because">{b}</div>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="brain-note">
            Look at the last {meta.rest_cycles} rows: input stops, feeding neurons go quiet, but about
            {" "}{fmtK(cycles[cycles.length - 1].brain.active_neurons)} neurons keep firing while the scrambled
            control falls silent. Whether that is real fly biology or an artefact of the model is not yet known.
          </p>
        </div>
      </section>

      <section className="block">
        <div className="container-wide">
          <div className="feed-section-head">
            <h2>Controlled input test</h2>
            <span className="live-pill">{E.meta.trials} fresh brains per row · {E.meta.dur_ms} ms</span>
          </div>
          <p className="brain-note">
            Sugar drive held fixed at 120 Hz; only the bitter input changes. Every trial starts from a fresh
            brain, so no state carries over. Feeding is the mean rate of {meta.readouts.feeding} feeding
            motor neurons; whiskers are one standard deviation.
          </p>
          <div className="panel brain-wrap">
            <table className="brain-table">
              <thead>
                <tr><th>input</th><th>feeding motor neurons, Hz</th><th>head</th><th>descending</th><th>active neurons</th></tr>
              </thead>
              <tbody>
                {E.conditions.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td>
                      <div className="bcell wide">
                        <b>{c.mean.feeding.toFixed(1)} <span className="dim">± {c.sd.feeding.toFixed(1)}</span></b>
                        <Bar v={c.mean.feeding} max={expMax} tone="real" />
                      </div>
                    </td>
                    <td>{c.mean.head.toFixed(1)}</td>
                    <td>{c.mean.descending.toFixed(1)}</td>
                    <td>{Math.round(c.mean.active_neurons).toLocaleString()} <span className="dim">± {Math.round(c.sd.active_neurons).toLocaleString()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="block">
        <div className="container-wide">
          <div className="panel brain-limits">
            <div className="eyebrow" style={{ color: "var(--text-faint)" }}>read this before believing anything</div>
            <ul>
              <li><b>Not a forecast.</b> The brain&apos;s output is a biological response to a stimulus. Nothing here shows it predicts price, rugs, or anything else.</li>
              <li><b>It does not change any verdict.</b> The gate alerts on failed scan checks only; the brain&apos;s weight in that decision is {T.cycles[0].gate.brain_weight}. The alerts you see are the flagged scans, by construction.</li>
              <li><b>The mapping is a design choice.</b> Clean scan → sweet, flagged → bitter is a valence metaphor we picked. The neurons are real annotated taste neurons; what they stand for is ours.</li>
              <li><b>Small samples.</b> {E.meta.trials} trials per condition, {nEvents} scans, one snapshot. An earlier 5-trial run showed a couple of brains igniting far less than the rest; this {E.meta.trials}-trial rerun did not reproduce it, so treat the cascade as stochastic and the effect sizes as rough.</li>
              <li><b>Recorded, not live.</b> The simulation ran on a laptop and was saved. The site shows that saved run.</li>
              <li><b>Data terms unverified.</b> The connectome and its annotations come from FlyWire; their licence for commercial use has not been confirmed.</li>
            </ul>
            <div className="brain-links">
              <a href={asset("/brain/trace.json")}>full trace (json)</a>
              <a href={asset("/brain/experiment.json")}>experiment (json)</a>
              <a href="https://github.com/philshiu/Drosophila_brain_model" target="_blank" rel="noreferrer">model code (Shiu et al.)</a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
