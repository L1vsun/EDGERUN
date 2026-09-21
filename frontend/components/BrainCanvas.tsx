"use client";

import { useEffect, useRef } from "react";

// The whole fly brain, with the smell circuit burning inside it.
//
// Three layers, back to front:
//   1. 26,000 neurons of the rest of the brain — the silhouette, so you can see it IS a brain
//   2. 7,000 real synapses of the olfactory circuit — the web, always faintly there
//   3. the circuit's own neurons, lighting up as each token is smelled
// Everything is in true anatomical position, on one shared scale.

export interface Pulse {
  at: number;
  gloms: number[];
  pn: Float64Array | null;
  code: number[];
  strength: number;
  lead: boolean;
}

// Where each council region sits in the brain. These are not decorative placements: the
// Scout is on the sensory neurons, the Historian on the Kenyon cells (the fly's actual
// memory), Synthesis on the mushroom-body output neurons where that computation converges,
// and the Gate on the descending neurons that carry a decision out of the brain.
export const MODULES = [
  { id: "scout", label: "SCOUT", sub: "antennal lobe · sensory in", layers: ["ORN"], order: 0 },
  { id: "skeptic", label: "SKEPTIC", sub: "lateral horn · innate valence", layers: ["LH", "APL"], order: 1 },
  { id: "historian", label: "HISTORIAN", sub: "mushroom body · memory", layers: ["KC"], order: 2 },
  { id: "synthesis", label: "SYNTHESIS", sub: "MBON · convergence", layers: ["MBON", "DAN"], order: 3 },
  { id: "gate", label: "GATE", sub: "descending · output", layers: ["PN"], order: 4 },
] as const;

export interface ModuleMark { id: string; x: number; y: number; depth: number; firing: number }

const CYCLE_MS = 2100;   // how long each region holds the floor

const D = { ORN: 0, ALLN: 150, PN: 230, LH: 330, KC: 470, APL: 520, MBON: 700, DAN: 760 } as Record<string, number>;
const HOLD = 520;
const LIFE = 1500;
// depth shading for the silhouette, precomputed
const SHELL_BANDS = 6;
const SHELL_FILL = Array.from({ length: SHELL_BANDS }, (_, b) =>
  `rgba(128,156,100,${(0.2 + 0.38 * (1 - b / (SHELL_BANDS - 1))).toFixed(3)})`);
const shellBand = (d: number) => Math.min(SHELL_BANDS - 1, Math.max(0, Math.floor((d + 0.5) * SHELL_BANDS)));

const COL: Record<string, [number, number, number]> = {
  ORN: [255, 255, 255], ALLN: [150, 170, 110], PN: [207, 255, 4], KC: [172, 240, 40],
  MBON: [255, 120, 120], DAN: [255, 208, 120], LH: [120, 145, 85], APL: [130, 210, 255],
};

export default function BrainCanvas({
  circuit,
  pulses,
  marks,
}: {
  circuit: any | null;
  pulses: React.MutableRefObject<Pulse[]>;
  marks?: React.MutableRefObject<ModuleMark[]>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !circuit) return;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const { X, Y, Z, layer, N } = circuit.mb;
    const LAY: string[] = circuit.L;
    const IDX = circuit.idx as Record<string, number[]>;
    const gloms: number[][] = circuit.gloms.map((g: string) => circuit.meta.glomeruli[g]);
    const web: Int32Array = circuit.web;
    const shell = circuit.shell as { n: number; X: Uint16Array; Y: Uint16Array; Z: Uint16Array } | null;

    // one centre and one scale for brain and circuit alike
    const SN = shell ? shell.n : 0;
    let cx = 0, cy0 = 0, cz = 0;
    const total = N + SN;
    for (let i = 0; i < N; i++) { cx += X[i]; cy0 += Y[i]; cz += Z[i]; }
    for (let i = 0; i < SN; i++) { cx += shell!.X[i]; cy0 += shell!.Y[i]; cz += shell!.Z[i]; }
    cx /= total * 65535; cy0 /= total * 65535; cz /= total * 65535;

    const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
    for (let i = 0; i < N; i++) { px[i] = X[i] / 65535 - cx; py[i] = Y[i] / 65535 - cy0; pz[i] = Z[i] / 65535 - cz; }
    const hx = new Float32Array(SN), hy = new Float32Array(SN), hz = new Float32Array(SN);
    const radii = new Float32Array(total);
    for (let i = 0; i < SN; i++) {
      hx[i] = shell!.X[i] / 65535 - cx; hy[i] = shell!.Y[i] / 65535 - cy0; hz[i] = shell!.Z[i] / 65535 - cz;
      radii[N + i] = Math.hypot(hx[i], hy[i], hz[i]);
    }
    for (let i = 0; i < N; i++) radii[i] = Math.hypot(px[i], py[i], pz[i]);
    const R = Float32Array.from(radii).sort()[Math.floor(total * 0.96)] || 0.35;
    const FIT = (0.47 * 1.55) / R;

    const sx = new Float32Array(N), sy = new Float32Array(N), sd = new Float32Array(N);
    const qx = new Float32Array(SN), qy = new Float32Array(SN), qd = new Float32Array(SN);
    const heat = new Float32Array(N);
    const order = new Int32Array(N);
    for (let i = 0; i < N; i++) order[i] = i;
    const BULK = ["ALLN", "LH", "MBON", "DAN", "APL"].filter((k) => IDX[k]?.length);
    // the neurons each module is anchored to, resolved once
    const modNeurons = MODULES.map((m) => m.layers.flatMap((l) => IDX[l] || []));

    let W = 0, H = 0, dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      H = canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    };
    resize();
    window.addEventListener("resize", resize);

    let yaw = -0.5, pitch = 0.18, drag: { x: number; y: number } | null = null, idle = 0;
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
      if (!drag) { idle += dt; if (idle > 700) yaw += dt * 0.00010; }

      ctx.fillStyle = "#05070b";
      ctx.fillRect(0, 0, W, H);

      const cyr = Math.cos(yaw), syr = Math.sin(yaw), cpr = Math.cos(pitch), spr = Math.sin(pitch);
      const scale = Math.min(W, H) * FIT;
      const ox = W * (W > 1100 * dpr ? 0.55 : 0.5), oy = H * 0.5;
      const project = (x0: number, y0: number, z0: number, out: Float32Array, od: Float32Array, i: number, oxs: Float32Array) => {
        const x1 = x0 * cyr - z0 * syr;
        const z1 = x0 * syr + z0 * cyr;
        const y1 = y0 * cpr - z1 * spr;
        const z2 = y0 * spr + z1 * cpr;
        const p = 1 / (1.55 + z2);
        oxs[i] = ox + x1 * scale * p;
        out[i] = oy + y1 * scale * p;
        od[i] = z2;
      };
      for (let i = 0; i < N; i++) project(px[i], py[i], pz[i], sy, sd, i, sx);
      for (let i = 0; i < SN; i++) project(hx[i], hy[i], hz[i], qy, qd, i, qx);

      // 1. the rest of the brain: the silhouette the circuit sits inside.
      // Drawn in a few depth bands so the fill colour is set 6 times, not 26,000.
      const sdot = Math.max(0.9, (Math.min(W, H) / 900) * dpr);
      for (let b = 0; b < SHELL_BANDS; b++) {
        ctx.fillStyle = SHELL_FILL[b];
        for (let i = 0; i < SN; i++) {
          if (shellBand(qd[i]) !== b) continue;
          ctx.fillRect(qx[i], qy[i], sdot, sdot);
        }
      }

      const fade = Math.exp(-dt / 500);
      for (let i = 0; i < N; i++) heat[i] *= fade;

      const live = pulses.current;
      let lead: Pulse | null = null;
      let leadAge = 0;
      for (let p = live.length - 1; p >= 0; p--) {
        const age = now - live[p].at;
        if (age > LIFE) { live.splice(p, 1); continue; }
        if (age < 0) continue;
        const u = live[p];
        const win = (d: number) => (age > d && age < d + HOLD ? (1 - (age - d) / HOLD) * u.strength : 0);
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
            for (let j = 0; j < list.length; j++) if (u.pn[j] > 0) bump(list[j], (u.pn[j] / max) * k);
          }
        }
        const kk = win(D.KC);
        if (kk > 0) for (const c of u.code) bump(IDX.KC[c], kk);
        if (u.lead && age > D.PN && age < D.KC + HOLD) { lead = u; leadAge = age; }
      }

      // 2. the circuit's own wiring, always visible, brighter where it is carrying signal
      ctx.lineWidth = Math.max(0.4, dpr * 0.32);
      ctx.strokeStyle = "rgba(150,200,60,0.05)";
      ctx.beginPath();
      for (let e = 0; e < web.length; e += 2) {
        const a = web[e], b = web[e + 1];
        if (heat[a] > 0.25 || heat[b] > 0.25) continue; // drawn hot below
        ctx.moveTo(sx[a], sy[a]);
        ctx.lineTo(sx[b], sy[b]);
      }
      ctx.stroke();
      ctx.lineWidth = Math.max(0.5, dpr * 0.5);
      ctx.strokeStyle = "rgba(207,255,4,0.22)";
      ctx.beginPath();
      for (let e = 0; e < web.length; e += 2) {
        const a = web[e], b = web[e + 1];
        if (heat[a] <= 0.25 && heat[b] <= 0.25) continue;
        ctx.moveTo(sx[a], sy[a]);
        ctx.lineTo(sx[b], sy[b]);
      }
      ctx.stroke();

      // 3. the focused token's own synapses into the cells that won
      if (lead) {
        const k = Math.min(1, (leadAge - D.PN) / 160) * (1 - Math.max(0, leadAge - D.KC) / HOLD);
        if (k > 0.03) {
          ctx.lineWidth = Math.max(0.5, dpr * 0.42);
          ctx.strokeStyle = `rgba(230,255,140,${0.16 * k})`;
          ctx.beginPath();
          for (let c = 0; c < lead.code.length; c += 2) {
            const target = IDX.KC[lead.code[c]];
            const ins = circuit.kcInputs[lead.code[c]];
            for (let m = 0; m < ins.length && m < 2; m++) {
              const src = IDX.PN[ins[m]];
              ctx.moveTo(sx[src], sy[src]);
              ctx.lineTo(sx[target], sy[target]);
            }
          }
          ctx.stroke();
        }
      }

      // 4. the circuit's neurons
      const base = Math.max(0.9, (Math.min(W, H) / 760) * dpr);
      // resting neurons, grouped by layer so each colour is set once
      for (let l = 0; l < LAY.length; l++) {
        const list = IDX[LAY[l]];
        if (!list) continue;
        const c = COL[LAY[l]];
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.38)`;
        for (const i of list) {
          if (heat[i] >= 0.04) continue;
          ctx.fillRect(sx[i] - base * 0.5, sy[i] - base * 0.5, base, base);
        }
      }
      // then the ones that are firing, back to front
      // ---- module anchors: centroid of the neurons each region owns ----
      const speaking = Math.floor(now / CYCLE_MS) % MODULES.length;
      const phase = ((now % CYCLE_MS) / CYCLE_MS);
      const out: ModuleMark[] = [];
      for (let m = 0; m < MODULES.length; m++) {
        const list = modNeurons[m];
        if (!list.length) continue;
        let ax = 0, ay = 0, ad = 0;
        for (const i of list) { ax += sx[i]; ay += sy[i]; ad += sd[i]; }
        ax /= list.length; ay /= list.length; ad /= list.length;
        // a short swell as each region takes its turn, so the sequence reads as a relay
        const fire = m === speaking ? Math.sin(Math.min(1, phase * 1.6) * Math.PI) : 0;
        out.push({ id: MODULES[m].id, x: ax / dpr, y: ay / dpr, depth: ad, firing: fire });
        if (fire > 0.05) {
          for (const i of list) bump(i, Math.max(heat[i], fire * 0.5));
        }
        // anchor mark
        ctx.strokeStyle = `rgba(207,255,4,${0.22 + 0.6 * fire})`;
        ctx.lineWidth = Math.max(0.7, dpr * 0.7);
        const r = (7 + fire * 9) * dpr;
        ctx.beginPath();
        ctx.arc(ax, ay, r, 0, 6.283);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax - r - 4 * dpr, ay); ctx.lineTo(ax - r + 3 * dpr, ay);
        ctx.moveTo(ax + r - 3 * dpr, ay); ctx.lineTo(ax + r + 4 * dpr, ay);
        ctx.moveTo(ax, ay - r - 4 * dpr); ctx.lineTo(ax, ay - r + 3 * dpr);
        ctx.moveTo(ax, ay + r - 3 * dpr); ctx.lineTo(ax, ay + r + 4 * dpr);
        ctx.stroke();
      }
      if (marks) marks.current = out;

      order.sort((a, b) => sd[b] - sd[a]);
      for (let n = 0; n < N; n++) {
        const i = order[n];
        const h = heat[i];
        const c = COL[LAY[layer[i]]];
        if (h < 0.04) {
          continue;
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
