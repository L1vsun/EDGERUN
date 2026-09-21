"use client";

// The mascot. A fly, drawn top-down, wings beating. `alert` turns it red and makes it
// beat harder — used when something on the chain just tripped a flag.

export default function Fly({ size = 46, alert = false }: { size?: number; alert?: boolean }) {
  const c = alert ? "var(--bad)" : "var(--chart)";
  return (
    <svg className={`fly${alert ? " fly-alert" : ""}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <g className="wing wing-l" style={{ transformOrigin: "30px 26px" }}>
        <ellipse cx="17" cy="19" rx="14" ry="7" transform="rotate(-24 17 19)" fill={c} opacity="0.22" />
        <ellipse cx="17" cy="19" rx="14" ry="7" transform="rotate(-24 17 19)" fill="none" stroke={c} strokeWidth="1.3" opacity="0.65" />
      </g>
      <g className="wing wing-r" style={{ transformOrigin: "34px 26px" }}>
        <ellipse cx="47" cy="19" rx="14" ry="7" transform="rotate(24 47 19)" fill={c} opacity="0.22" />
        <ellipse cx="47" cy="19" rx="14" ry="7" transform="rotate(24 47 19)" fill="none" stroke={c} strokeWidth="1.3" opacity="0.65" />
      </g>
      {/* legs */}
      <g stroke={c} strokeWidth="1.6" strokeLinecap="round" opacity="0.8">
        <path d="M26 40 L16 50" /><path d="M38 40 L48 50" />
        <path d="M25 34 L13 38" /><path d="M39 34 L51 38" />
      </g>
      {/* abdomen + thorax */}
      <ellipse cx="32" cy="40" rx="9" ry="14" fill="#0a0e04" stroke={c} strokeWidth="2" />
      <path d="M24 38 H40 M25 44 H39 M27 50 H37" stroke={c} strokeWidth="1.4" opacity="0.55" />
      <ellipse cx="32" cy="23" rx="8.5" ry="7.5" fill="#0a0e04" stroke={c} strokeWidth="2" />
      {/* compound eyes */}
      <circle className="eye" cx="27" cy="20" r="3.4" fill={c} />
      <circle className="eye" cx="37" cy="20" r="3.4" fill={c} />
      {/* antennae — the part that does the smelling */}
      <path d="M29 16 L26 9 M35 16 L38 9" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="26" cy="8" r="1.7" fill={c} />
      <circle cx="38" cy="8" r="1.7" fill={c} />
    </svg>
  );
}
