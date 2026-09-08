// The sample terminal output. Real text from a real scan of 0xDAA8…CED3 —
// not mocked-up copy. `compact` trims the type for the narrow side rail.
export default function ScanPreview({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`term-card panel${compact ? " term-card-compact" : ""}`}>
      <div className="term-card-head">
        <span className="term-dot" />
        <span className="term-dot" />
        <span className="term-dot" />
        <span style={{ marginLeft: 4 }}>edgerun · real scan</span>
      </div>
      <div className="term-card-body">
        <span className="t-dim">$ edgerun scan 0xDAA8...CED3</span>
        {"\n\n  contract\n"}
        <span className="t-ok">    ok</span>
        {"    source verified on blockscout\n"}
        <span className="t-ok">    ok</span>
        {"    supply fixed at deploy, no mint\n"}
        <span className="t-dim">    ??</span>
        {"    owner() unreadable — no getter\n"}
        <span className="t-dim">    ??</span>
        {"    LP lock — no DEX factory set\n"}
        {"\n  impersonation\n"}
        <span className="t-ok">    ok</span>
        {"    no known ticker collision\n"}
        {"\n  "}
        <span className="t-ok">verdict: PASS</span>
        {"\n"}
        <span className="t-dim">  facts checked: 3 · unresolved: 2</span>
      </div>
    </div>
  );
}
