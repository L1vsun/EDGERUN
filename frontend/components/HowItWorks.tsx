export default function HowItWorks() {
  return (
    <section>
      <div className="container">
        <h3>mechanism</h3>
        <h2>Two checks, run every time, reported separately</h2>
        <p>
          A token can pass one lane and fail the other — that split is the point. A perfectly
          locked, fixed-supply contract is still a scam if the name is one character off from
          something real.
        </p>

        <div className="lane-grid">
          <div className="lane-card">
            <h3>contract safety</h3>
            <ul>
              <li>source verified on Blockscout, yes or no</li>
              <li>supply fixed at deploy vs a reachable mint(address,uint256) selector</li>
              <li>ownership renounced (live eth_call to owner()), cross-checked against
                pause/blacklist/setFee-style functions still present in the bytecode</li>
              <li>LP token holder and lock status, where the pair contract resolves</li>
            </ul>
          </div>
          <div className="lane-card">
            <h3>impersonation</h3>
            <ul>
              <li>ticker edit-distance against every entry in the maintained reference list</li>
              <li>name similarity against every reference name</li>
              <li>near-misses reported as a specific claim — "1 edit from HOOD," not a
                fuzzy percentage</li>
              <li>reference list is established, already-deployed tokens — not an official
                Robinhood registry (see docs/impersonation.md)</li>
            </ul>
          </div>
        </div>

        <p style={{ marginTop: 20 }}>
          Both lanes report <b style={{ color: "var(--text)" }}>unresolved</b>, not a false pass,
          when the underlying data isn't there. An unverified contract isn't silently skipped —
          it's reported as its own condition, because unverified source is itself the single most
          common trait shared by contracts already documented as scams on this chain.
        </p>
      </div>
    </section>
  );
}
