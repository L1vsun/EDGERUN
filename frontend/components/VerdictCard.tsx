import { ScanResult, CheckStatus, shareUrl } from "@/lib/api";

const ICON: Record<CheckStatus, string> = { ok: "ok", warn: "warn", fail: "fail", unresolved: "??" };

function CheckRow({ status, detail }: { status: CheckStatus; detail: string }) {
  return (
    <div className="check-row">
      <span className={`check-icon ${status}`}>{ICON[status]}</span>
      <span className="check-detail">{detail}</span>
    </div>
  );
}

export default function VerdictCard({ result }: { result: ScanResult }) {
  const short = `${result.address.slice(0, 6)}...${result.address.slice(-4)}`;
  const label = result.token_symbol ? `${result.token_symbol} · ${short}` : short;

  return (
    <div className="card panel">
      <div className="card-head">
        <span className="card-addr">{label}</span>
        <span className={`verdict-badge verdict-${result.verdict}`}>{result.verdict}</span>
      </div>

      <div className="lane">
        <div className="lane-title">contract</div>
        {result.contract.checks.map((c) => (
          <CheckRow key={c.id} status={c.status} detail={c.detail} />
        ))}
      </div>

      <div className="lane">
        <div className="lane-title">impersonation</div>
        {result.impersonation.checks.map((c) => (
          <CheckRow key={c.id} status={c.status} detail={c.detail} />
        ))}
      </div>

      {result.contract.deployer ? (
        <div className="lane">
          <div className="lane-title">deployer</div>
          <div className="check-row">
            <span className="check-detail">{result.contract.deployer}</span>
          </div>
        </div>
      ) : null}

      <div className="card-footer">
        <span>
          facts checked: {result.facts_checked} · unresolved: {result.unresolved}
          {result.cached ? " · cached" : " · live"}
        </span>
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a className="card-link" href={result.blockscout_url} target="_blank" rel="noreferrer">
            blockscout ↗
          </a>
          {/* Server-rendered receipt: unfurls as a verdict card when pasted. */}
          <a className="share-btn" href={shareUrl(result.address)} target="_blank" rel="noreferrer">
            share receipt ↗
          </a>
        </span>
      </div>
      <div className="disclaimer">
        Not financial advice. A PASS means the listed structural checks came back clean — it is
        not a buy signal. Verify independently before you act.
      </div>
    </div>
  );
}
