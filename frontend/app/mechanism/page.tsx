export const metadata = { title: "Mechanism — edgerun" };

export default function MechanismPage() {
  return (
    <>
      <section className="page-head">
        <div className="container">
          <div className="eyebrow">mechanism</div>
          <h1>Two checks, run every time, reported separately</h1>
          <p>
            A token can pass one lane and fail the other — that split is the point. A perfectly
            locked, fixed-supply contract is still a scam if the name is one character off from
            something real.
          </p>
        </div>
      </section>

      <section className="block">
        <div className="container">
          <div className="lane-grid">
            <div className="lane-card glass glass-hover">
              <h3>contract safety</h3>
              <ul>
                <li>source verified on Blockscout, yes or no</li>
                <li>supply fixed at deploy vs a reachable <code>mint(address,uint256)</code> selector in bytecode — works even unverified, since bytecode is always public</li>
                <li>ownership renounced (live <code>eth_call</code> to <code>owner()</code>), cross-checked against pause/blacklist/setFee-style functions still present in the bytecode</li>
                <li>LP token holder and lock status, where the pair contract resolves</li>
              </ul>
            </div>
            <div className="lane-card glass glass-hover">
              <h3>impersonation</h3>
              <ul>
                <li>ticker edit-distance against every entry in the maintained reference list</li>
                <li>name similarity against every reference name</li>
                <li>near-misses reported as a specific claim — "1 edit from HOOD," not a fuzzy percentage</li>
                <li>reference list is established, already-deployed tokens — not an official Robinhood registry</li>
              </ul>
            </div>
          </div>

          <p style={{ marginTop: 24 }}>
            Both lanes report <b style={{ color: "var(--text)" }}>unresolved</b>, not a false pass,
            when the underlying data isn't there. An unverified contract isn't silently skipped —
            it's reported as its own condition, because unverified source is itself the single most
            common trait shared by contracts already documented as scams on this chain.
          </p>

          <div className="ascii-block glass">{`$ edgerun scan 0x1a2b3c4d5e6f...

  contract
    ok    source verified on blockscout
    ok    supply fixed at deploy, no mint function in verified source
    ok    ownership renounced
    warn  LP locked until 2027-01-14, 131 days from now — not permanent

  impersonation
    fail  ticker "H00D" — 1 edit from "HOOD" (edit_distance: 1)
    fail  name "Robinhood Official" matches no verified RH Chain entity
    ref   closest known match: HOOD (0x9f...) — not the same contract

  verdict: FAIL — likely impersonation of an existing token`}</div>
        </div>
      </section>
    </>
  );
}
