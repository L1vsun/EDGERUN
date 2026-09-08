const LIMITS = [
  {
    title: "Team-controlled unlocked supply",
    body: "LP can be perfectly locked while the deployer wallet still holds 90% of circulating supply across other addresses. This tool's LP check doesn't see that — it needs a separate holder-concentration check, which is on the roadmap, not shipped.",
  },
  {
    title: "Post-launch admin key changes",
    body: "A contract can look clean at scan time and have its owner key transferred to a new, malicious address afterward. A scan is a snapshot, not a guarantee — every verdict shows a scan timestamp and the live feed re-scans on new activity rather than caching forever.",
  },
  {
    title: "Off-chain social engineering",
    body: "Phishing links, hacked accounts promoting a token, fake support DMs — none of this is a contract-level signal. This tool only looks at the contract.",
  },
  {
    title: "Novel honeypot bytecode patterns",
    body: "Static analysis catches known patterns (blacklist functions, pausable transfers, hidden mint). A genuinely new obfuscation technique can slip past until the pattern is added.",
  },
];

export default function Limitations() {
  return (
    <section>
      <div className="container">
        <h3>say this part out loud</h3>
        <h2>What this does not catch</h2>
        <p>
          A PASS verdict means the specific, listed structural checks came back clean. It does
          not mean safe in any broader sense. Read the facts, not the color.
        </p>
        <div className="limits-list">
          {LIMITS.map((l) => (
            <div className="limit-item" key={l.title}>
              <b>{l.title}.</b> {l.body}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
