"use client";

import { useEffect, useRef } from "react";
import { MODULES, ModuleMark } from "./BrainCanvas";

// Anatomical callouts, drawn the way a lab plate does it: the labels sit in the margin in
// a fixed stack, and a leader line runs from each one to the structure it names. The
// structures themselves are close together inside the brain, so labelling them in place
// just piles the text up — which is exactly what the margin-and-leader convention is for.
//
// BrainCanvas writes each module's live screen position into `marks` every frame; the
// leader lines follow without going through React state.

export default function ModuleHUD({
  marks,
  say,
}: {
  marks: React.MutableRefObject<ModuleMark[]>;
  say: Record<string, string>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = host.current;
    const s = svg.current;
    if (!el || !s) return;
    const cards = new Map<string, HTMLElement>();
    const lines = new Map<string, SVGPolylineElement>();
    for (const m of MODULES) {
      const c = el.querySelector<HTMLElement>(`[data-mod="${m.id}"]`);
      const l = s.querySelector<SVGPolylineElement>(`[data-line="${m.id}"]`);
      if (c) cards.set(m.id, c);
      if (l) lines.set(m.id, l);
    }
    let raf = 0;
    const tick = () => {
      const box = el.getBoundingClientRect();
      for (const mark of marks.current) {
        const card = cards.get(mark.id);
        const line = lines.get(mark.id);
        if (!card || !line) continue;
        const cb = card.getBoundingClientRect();
        // leave from the card's inner edge, elbow, then run to the structure
        const x0 = cb.left - box.left;
        const y0 = cb.top - box.top + cb.height / 2;
        const x1 = mark.x;
        const y1 = mark.y;
        const mid = x0 - Math.max(18, (x0 - x1) * 0.22);
        line.setAttribute("points", `${x0},${y0} ${mid},${y0} ${x1},${y1}`);
        line.setAttribute("opacity", String(0.16 + 0.5 * mark.firing));
        card.classList.toggle("firing", mark.firing > 0.25);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [marks]);

  return (
    <div className="hud" ref={host} aria-hidden="true">
      <svg className="hud-lines" ref={svg}>
        {MODULES.map((m) => (
          <g key={m.id}>
            <polyline data-line={m.id} fill="none" stroke="var(--chart)" strokeWidth="1" />
          </g>
        ))}
      </svg>
      <div className="hud-stack">
        {MODULES.map((m, i) => (
          <div className="hud-card" data-mod={m.id} key={m.id}>
            <span className="hud-n">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <b>{m.label}</b>
              <i>{m.sub}</i>
              {say[m.id] ? <em>{say[m.id]}</em> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
