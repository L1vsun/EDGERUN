"use client";

import { useEffect, useRef, useState } from "react";
import { asset } from "@/lib/config";
import { startChainFeed, ChainSample } from "@/lib/feed";

// A real fly connectome (FlyWire, 138,639 neurons) simulated in this browser tab by a web worker.
// The chain drives three groups of real sensory neurons; the page draws every neuron that fires.

type Channel = "touch" | "sweet" | "bitter";
const CHANNELS: { id: Channel; label: string; hint: string }[] = [
  { id: "touch", label: "touch", hint: "transactions" },
  { id: "sweet", label: "sweet", hint: "new contract" },
  { id: "bitter", label: "bitter", hint: "heavy block" },
];
const POKE_HZ = 60;
const LIT_MS = 260; // how long a firing neuron glows

// neuron class -> colour: other, sensory, central, optic, motor, descending, ascending, endocrine
const COLORS: [number, number, number][] = [
  [140, 150, 120], [255, 255, 255], [207, 255, 4], [150, 215, 20],
  [255, 138, 138], [255, 138, 138], [140, 200, 255], [255, 214, 130],
];

function chainRates(s: ChainSample | null): Record<Channel, number> {
  if (!s || !s.ok) return { touch: 0, sweet: 0, bitter: 0 };
  return {
    touch: Math.min(60, s.txPerSec * 0.6),
    sweet: s.creations > 0 ? 60 : 0,
    bitter: s.heavy > 0 ? 60 : 0,
  };
}

export default function BrainStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const chain = useRef<ChainSample | null>(null);
  const poke = useRef<Record<Channel, number>>({ touch: 0, sweet: 0, bitter: 0 });
  const push = useRef<() => void>(() => {});
  const live = useRef({ lit: 0, spikes: 0, ms: 0 });

  const [phase, setPhase] = useState<"load" | "unpack" | "run" | "error">("load");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState("");
  const [stats, setStats] = useState({ lit: 0, sps: 0, sec: 0, block: 0, tx: 0 });
  const [driven, setDriven] = useState<Record<Channel, boolean>>({ touch: false, sweet: false, bitter: false });

  useEffect(() => {
    let alive = true;
    const cleanups: (() => void)[] = [];

    (async () => {
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      const [posBuf, clsBuf] = await Promise.all([
        fetch(asset("/brain/positions.bin")).then((r) => r.arrayBuffer()),
        fetch(asset("/brain/classes.bin")).then((r) => r.arrayBuffer()),
      ]);
      if (!alive) return;
      const P = new Uint16Array(posBuf);
      const cls = new Uint8Array(clsBuf);
      const N = cls.length;

      // front view: x across, y down (FlyWire's y points ventrally)
      const nx = new Float32Array(N);
      const ny = new Float32Array(N);
      let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
      for (let i = 0; i < N; i++) {
        nx[i] = P[i * 3] / 65535;
        ny[i] = P[i * 3 + 1] / 65535;
        if (nx[i] < x0) x0 = nx[i];
        if (nx[i] > x1) x1 = nx[i];
        if (ny[i] < y0) y0 = ny[i];
        if (ny[i] > y1) y1 = ny[i];
      }

      const heat = new Float32Array(N);
      const hot = new Int32Array(N);
      const inHot = new Uint8Array(N);
      let hotN = 0;
      let pix = new Int32Array(N);
      let W = 0, H = 0;
      let base = new Uint32Array(0);
      let frame: ImageData;
      let frame32 = new Uint32Array(0);

      function layout() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = Math.max(1, Math.round(canvas.clientWidth * dpr));
        H = Math.max(1, Math.round(canvas.clientHeight * dpr));
        canvas.width = W;
        canvas.height = H;
        const m = 0.06 * Math.min(W, H);
        const s = Math.min((W - 2 * m) / (x1 - x0), (H - 2 * m) / (y1 - y0));
        const ox = (W - (x1 - x0) * s) / 2 - x0 * s;
        const oy = (H - (y1 - y0) * s) / 2 - y0 * s;
        const dens = new Uint8Array(W * H);
        for (let i = 0; i < N; i++) {
          const x = Math.min(W - 1, Math.max(0, Math.round(nx[i] * s + ox)));
          const y = Math.min(H - 1, Math.max(0, Math.round(ny[i] * s + oy)));
          const idx = y * W + x;
          pix[i] = idx;
          if (dens[idx] < 255) dens[idx]++;
        }
        base = new Uint32Array(W * H);
        for (let p = 0; p < base.length; p++) {
          const t = Math.min(1, dens[p] / 4);
          base[p] = 0xff000000 | ((4 + t * 34) << 16) | ((14 + t * 78) << 8) | (10 + t * 58);
        }
        frame = ctx.createImageData(W, H);
        frame32 = new Uint32Array(frame.data.buffer);
      }
      layout();
      const onResize = () => layout();
      window.addEventListener("resize", onResize);
      cleanups.push(() => window.removeEventListener("resize", onResize));

      function glow(idx: number, r: number, g: number, b: number) {
        const v = frame32[idx];
        const R = Math.min(255, (v & 255) + r);
        const G = Math.min(255, ((v >> 8) & 255) + g);
        const B = Math.min(255, ((v >> 16) & 255) + b);
        frame32[idx] = 0xff000000 | (B << 16) | (G << 8) | R;
      }

      let last = performance.now();
      let raf = 0;
      function draw(now: number) {
        const decay = Math.exp(-(now - last) / LIT_MS);
        last = now;
        frame32.set(base);
        for (let k = 0; k < hotN; ) {
          const i = hot[k];
          const h = heat[i] * decay;
          if (h < 0.04) {
            heat[i] = 0;
            inHot[i] = 0;
            hot[k] = hot[--hotN];
            continue;
          }
          heat[i] = h;
          const c = COLORS[cls[i]] || COLORS[0];
          const r = c[0] * h, g = c[1] * h, b = c[2] * h;
          const p = pix[i];
          glow(p, r, g, b);
          if (p % W > 0) glow(p - 1, r * 0.45, g * 0.45, b * 0.45);
          if (p % W < W - 1) glow(p + 1, r * 0.45, g * 0.45, b * 0.45);
          if (p >= W) glow(p - W, r * 0.45, g * 0.45, b * 0.45);
          if (p < W * (H - 1)) glow(p + W, r * 0.45, g * 0.45, b * 0.45);
          k++;
        }
        ctx.putImageData(frame, 0, 0);
        live.current.lit = hotN;
        raf = requestAnimationFrame(draw);
      }
      raf = requestAnimationFrame(draw);
      cleanups.push(() => cancelAnimationFrame(raf));

      // the brain
      const worker = new Worker(asset("/brain/worker.js"));
      workerRef.current = worker;
      cleanups.push(() => worker.terminate());
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === "progress") setPct(Math.min(99, Math.round((100 * m.loaded) / (m.total || 37_400_000))));
        else if (m.type === "unpack") setPhase("unpack");
        else if (m.type === "ready") {
          setPhase("run");
          push.current();
        } else if (m.type === "error") {
          setError(m.message);
          setPhase("error");
        } else if (m.type === "spikes") {
          const ids: Int32Array = m.ids;
          for (let k = 0; k < ids.length; k++) {
            const i = ids[k];
            heat[i] = 1;
            if (!inHot[i]) {
              inHot[i] = 1;
              hot[hotN++] = i;
            }
          }
          live.current.spikes = m.total;
          live.current.ms = m.ms;
        }
      };

      // what the brain is being fed: the chain, plus whatever the visitor holds down
      push.current = () => {
        const c = chainRates(chain.current);
        const eff = { touch: 0, sweet: 0, bitter: 0 } as Record<Channel, number>;
        for (const ch of CHANNELS) eff[ch.id] = Math.max(c[ch.id], poke.current[ch.id]);
        worker.postMessage({ type: "rates", ...eff });
        setDriven({ touch: eff.touch > 0, sweet: eff.sweet > 0, bitter: eff.bitter > 0 });
      };
      cleanups.push(
        startChainFeed((s) => {
          chain.current = s;
          setStats((p) => ({ ...p, block: s.ok ? s.block : p.block, tx: s.ok ? s.txPerSec : 0 }));
          push.current();
        }),
      );

      const onVis = () => worker.postMessage({ type: "pause", paused: document.hidden });
      document.addEventListener("visibilitychange", onVis);
      cleanups.push(() => document.removeEventListener("visibilitychange", onVis));

      let prev = { spikes: 0, at: performance.now() };
      const timer = setInterval(() => {
        const now = performance.now();
        const sps = ((live.current.spikes - prev.spikes) / (now - prev.at)) * 1000;
        prev = { spikes: live.current.spikes, at: now };
        setStats((p) => ({ ...p, lit: live.current.lit, sps: Math.max(0, sps), sec: live.current.ms / 1000 }));
      }, 250);
      cleanups.push(() => clearInterval(timer));
    })().catch((err) => {
      setError(String(err?.message || err));
      setPhase("error");
    });

    return () => {
      alive = false;
      cleanups.forEach((f) => f());
    };
  }, []);

  const hold = (id: Channel, on: boolean) => {
    poke.current[id] = on ? POKE_HZ : 0;
    push.current();
  };
  const fmt = (n: number) => Math.round(n).toLocaleString();

  return (
    <section className="stage">
      <canvas ref={canvasRef} className="stage-canvas" />

      <div className="stage-title">
        <h1>A real fly brain, alive.</h1>
        <p>
          138,639 neurons and 15 million synapses, simulated in your browser and fed by live Robinhood Chain blocks.
        </p>
      </div>

      {phase !== "run" && (
        <div className="stage-load">
          {phase === "error" ? (
            <span>{error}</span>
          ) : (
            <>
              <span>{phase === "unpack" ? "unpacking the brain…" : `waking the brain… ${pct}%`}</span>
              <div className="bar">
                <i style={{ width: `${phase === "unpack" ? 100 : pct}%` }} />
              </div>
            </>
          )}
        </div>
      )}

      <div className="stage-foot">
        <div className="stats">
          <span><b>{fmt(stats.lit)}</b> neurons firing</span>
          <span><b>{fmt(stats.sps)}</b> spikes/s</span>
          <span><b>{stats.sec.toFixed(1)}</b> s of brain time</span>
          <span>block <b>{stats.block ? stats.block.toLocaleString() : "—"}</b> · <b>{fmt(stats.tx)}</b> tx/s</span>
        </div>
        <div className="pokes">
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              className={driven[c.id] ? "on" : ""}
              onPointerDown={() => hold(c.id, true)}
              onPointerUp={() => hold(c.id, false)}
              onPointerLeave={() => hold(c.id, false)}
              onPointerCancel={() => hold(c.id, false)}
            >
              <b>{c.label}</b>
              <small>{c.hint}</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
