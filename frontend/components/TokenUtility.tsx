import { TOKEN_TICKER } from "@/lib/config";

export default function TokenUtility() {
  return (
    <section>
      <div className="container">
        <h3>{TOKEN_TICKER}</h3>
        <h2>Token utility, kept to what it actually does</h2>
        <ul className="utility-list">
          <li>Priority position in the scan queue during high-deployment periods</li>
          <li>Access to the real-time verdict alert feed</li>
          <li>A vote on additions to the impersonation reference list and new check modules</li>
        </ul>
        <p style={{ marginTop: 18 }}>
          Not a signal service. A PASS is not a buy recommendation. Read the verdict, then read
          the linked Blockscout page yourself before you decide anything.
        </p>
      </div>
    </section>
  );
}
