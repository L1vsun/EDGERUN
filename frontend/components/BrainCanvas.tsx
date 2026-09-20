"use client";

import { useEffect, useRef } from "react";

// The fly's olfactory circuit in its real 3-D anatomy, animated by the chain.
//
// Every token the page is watching sends its own wave through the circuit: the glomeruli
// its activity excites light up, the projection neurons they feed follow, then the Kenyon
// cells that win the sparse code, then the output neurons. The lines drawn between the
// projection and Kenyon layers are real synapses from the connectome, not decoration.

export interface Pulse {
  at: number; // may be in the future: waves are queued and released in turn
  gloms: number[]; // activation per glomerulus
  pn: Float64Array | null;
  code: number[]; // Kenyon cells that won
  strength: number;
  lead: boolean; // the token in focus — drawn with its synapses
}

const D = { ORN: 0, ALLN: 150, PN: 230, LH: 330, KC: 470, APL: 520, MBON: 700, DAN: 760 } as Record<string, number>;
const HOLD = 520; // how long one layer stays lit as the wave passes
const LIFE = 1500;
const COL: Record<string, [number, number, number]> = {
  ORN: [255, 255, 255], ALLN: [150, 170, 110], PN: [207, 255, 4], KC: [165, 235, 30],
  MBON: [255, 120, 120], DAN: [255, 208, 120], LH: [120, 145, 85], APL: [130, 210, 255],
};

export default function BrainCanvas({ circuit, pulses }: { circuit: any | null; pulses: React.MutableRefObject<Pulse[]> }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !circuit) return;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const { X, Y, Z, layer, N } = circuit.mb;
    const LAY: string[] = circuit.L;
    const IDX = circuit.idx as Record<string, number[]>;
    const gloms: number[][] = circuit.gloms.map((g: string) => circuit.meta.glomeruli[g]);

    // centre on the cloud's own centroid and measure its spread, so the circuit always
    // sits in the middle of the frame at a sensible size whatever the window shape
    const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < N; i++) { mx += X[i]; my += Y[i]; mz += Z[i]; }
    mx /= N * 65535; my /= N * 65535; mz /= N * 65535;
    const radii = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      px[i] = X[i] / 65535 - mx;
      py[i] = Y[i] / 65535 - my;
      pz[i] = Z[i] / 65535 - mz;
      radii[i] = Math.hypot(px[i], py[i], pz[i]);
    }
    // fit on the 95th-percentile radius: the body of the cloud fills the frame and a
    // handful of outlying neurons are allowed to sit near the edge
    const sorted = Float32Array.from(radii).sort();
    const R = sorted[Math.floor(N * 0.95)] || 0.3;
    const FIT = (0.46 * 1.55) / R;
    const sx = new Float32Array(N), sy = new Float32Array(N), sd = new Float32Array(N);
    const heat = new Float32Array(N);
    const order = new Int32Array(N);
    for (let i = 0; i < N; i++) order[i] = i;
    // layers that glow as a whole, kept as small lists so a wave is cheap to apply
    const BULK = ["ALLN", "LH", "MBON", "DAN", "APL"].filter((k) => IDX[k]?.length);

    let W = 0, H = 0, dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      H = canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    };
    resize();
    window.addEventListener("resize", resize);

    let yaw = -0.5, pitch = 0.2, drag: { x: number; y: number } | null = null, idle = 0;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      yaw += (e.clientX - drag.x) * 0.006;
      pitch = Math.max(-1.1, Math.min(1.1, pitch + (e.clientY - drag.y) * 0.005));
      drag = { x: e.clientX, y: e.clientY };
      idle = 0;
    };
    const up = () => { drag = null; };
    canvas.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);

    const bump = (i: number, v: number) => { if (v > heat[i]) heat[i] = v; };

    let raf = 0;
    let last = performance.now();

    function frame(now: number) {
      const dt = Math.min(64, now - last);
      last = now;
      if (!drag) {
        idle += dt;
        if (idle > 700) yaw += dt * 0.00011;
      }

      ctx.fillStyle = "#05070b";
      ctx.fillRect(0, 0, W, H);

      const cy = Math.cos(yaw), sny = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const scale = Math.min(W, H) * FIT;
      // nudged right on wide screens so the headline has room of its own
      const ox = W * (W > 1100 * dpr ? 0.56 : 0.5), oy = H * 0.5;
      for (let i = 0; i < N; i++) {
        const x0 = px[i], y0 = py[i], z0 = pz[i];
        const x1 = x0 * cy - z0 * sny;
        const z1 = x0 * sny + z0 * cy;
        const y1 = y0 * cp - z1 * sp;
        const z2 = y0 * sp + z1 * cp;
        const persp = 1 / (1.55 + z2);
        sx[i] = ox + x1 * scale * persp;
        sy[i] = oy + y1 * scale * persp;
        sd[i] = z2;
      }

      const fade = Math.exp(-dt / 500);
      for (let i = 0; i < N; i++) heat[i] *= fade;

      const live = pulses.current;
      let lead: Pulse | null = null;
      let leadAge = 0;
      for (let p = live.length - 1; p >= 0; p--) {
        const age = now - live[p].at;
        if (age > LIFE) { live.splice(p, 1); continue; }
        if (age < 0) continue; // queued, not released yet
        const u = live[p];
        const win = (d: number) => (age > d && age < d + HOLD ? (1 - (age - d) / HOLD) * u.strength : 0);

        // sensory neurons of the glomeruli this smell actually excites
        const ko = win(D.ORN);
        if (ko > 0) {
          for (let g = 0; g < u.gloms.length; g++) {
            const a = u.gloms[g];
            if (a <= 0.02) continue;
            const list = gloms[g];
            if (!list) continue;
            const v = ko * (0.4 + 0.6 * a);
            for (const i of list) bump(i, v);
          }
        }
        for (const name of BULK) {
          const k = win(D[name]);
          if (k > 0) for (const i of IDX[name]) bump(i, k * 0.8);
        }
        if (u.pn) {
          const k = win(D.PN);
          if (k > 0) {
            let max = 1;
            for (const v of u.pn) if (v > max) max = v;
            const list = IDX.PN;
            for (let j = 0; j < list.length; j++) {
              const v = u.pn[j];
              if (v > 0) bump(list[j], (v / max) * k);
            }
          }
        }
        const kk = win(D.KC);
        if (kk > 0) for (const c of u.code) bump(IDX.KC[c], kk);
        if (u.lead && age > D.PN && age < D.KC + HOLD) { lead = u; leadAge = age; }
      }

      // real synapses carrying the focused token: projection neuron -> winning Kenyon cell
      if (lead) {
        const k = Math.min(1, (leadAge - D.PN) / 160) * (1 - Math.max(0, leadAge - D.KC) / HOLD);
        if (k > 0.03) {
          ctx.lineWidth = Math.max(0.5, dpr * 0.4);
          ctx.strokeStyle = `rgba(207,255,4,${0.13 * k})`;
          ctx.beginPath();
          const code = lead.code;
          for (let c = 0; c < code.length; c += 2) {
            const target = IDX.KC[code[c]];
            const ins = circuit.kcInputs[code[c]];
            for (let m = 0; m < ins.length && m < 2; m++) {
              const src = IDX.PN[ins[m]];
              ctx.moveTo(sx[src], sy[src]);
              ctx.lineTo(sx[target], sy[target]);
            }
          }
          ctx.stroke();
        }
      }

      order.sort((a, b) => sd[b] - sd[a]);
      const base = Math.max(0.8, (Math.min(W, H) / 780) * dpr);
      for (let n = 0; n < N; n++) {
        const i = order[n];
        const h = heat[i];
        const near = 1 - (sd[i] + 0.5) * 0.6;
        const c = COL[LAY[layer[i]]];
        if (h < 0.04) {
          // the anatomy itself, always visible
          ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.3 * near})`;
          ctx.fillRect(sx[i] - base * 0.5, sy[i] - base * 0.5, base, base);
        } else {
          const r = base * (1 + h * 1.9);
          ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.3 + 0.7 * h})`;
          ctx.beginPath();
          ctx.arc(sx[i], sy[i], r, 0, 6.283);
          ctx.fill();
          if (h > 0.45) {
            ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.1 * h})`;
            ctx.beginPath();
            ctx.arc(sx[i], sy[i], r * 3.4, 0, 6.283);
            ctx.fill();
          }
        }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [circuit, pulses]);

  return <canvas ref={ref} className="brain-canvas" />;
}
