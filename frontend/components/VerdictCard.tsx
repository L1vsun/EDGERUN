import { ScanResult, CheckStatus } from "@/lib/api";

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
    <div className="card">
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

      <div className="card-footer">
        <span>
          facts checked: {result.facts_checked} · unresolved: {result.unresolved}
          {result.cached ? " · cached" : " · live"}
        </span>
        <a className="card-link" href={result.blockscout_url} target="_blank" rel="noreferrer">
          view on blockscout ↗
        </a>
      </div>
      <div className="disclaimer">
        Not financial advice. A PASS means the listed structural checks came back clean — it is
        not a buy signal. Verify independently before you act.
      </div>
    </div>
  );
}
