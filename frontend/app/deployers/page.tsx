"use client";

import { useEffect, useState } from "react";
import { fetchDeployers, Deployer } from "@/lib/api";

function short(addr: string): string {
  return addr.length <= 16 ? addr : `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function ago(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function DeployersPage() {
  const [items, setItems] = useState<Deployer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { items } = await fetchDeployers(40, 2);
        if (!cancelled) {
          setItems(items);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "unavailable");
      }
    }
    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <>
      <section className="page-head">
        <div className="container-wide">
          <div className="eyebrow">deployer reputation</div>
          <h1>Who keeps shipping these</h1>
          <p>
            A contract is a snapshot; a wallet is a pattern. Every scan records the deployer, so a
            wallet that ships one impersonation after another becomes visible here — something you
            cannot see looking at a single contract at a time. Sorted worst first: most FAIL
            verdicts, then most launches.
          </p>
        </div>
      </section>

      <section className="block">
        <div className="container-wide">
          {error ? (
            <div className="feed-empty">deployer index unavailable: {error}</div>
          ) : items === null ? (
            <div className="feed-empty">loading…</div>
          ) : items.length === 0 ? (
            <div className="feed-empty">
              no deployer has shipped more than one scanned contract yet — the index fills in as the
              poller sees repeat wallets.
            </div>
          ) : (
            <div className="panel" style={{ overflowX: "auto" }}>
              <table className="dep-table">
                <thead>
                  <tr>
                    <th>deployer</th>
                    <th>launches</th>
                    <th>record</th>
                    <th>tickers seen</th>
                    <th>last</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((d) => {
                    const total = Math.max(1, d.launches);
                    return (
                      <tr key={d.deployer}>
                        <td className="dep-addr">{short(d.deployer)}</td>
                        <td>{d.launches}</td>
                        <td>
                          <div className="bar" style={{ gap: 10 }}>
                            <span className="rep-bar">
                              <span className="rep-seg pass" style={{ width: `${(d.pass / total) * 100}%` }} />
                              <span className="rep-seg caution" style={{ width: `${(d.caution / total) * 100}%` }} />
                              <span className="rep-seg fail" style={{ width: `${(d.fail / total) * 100}%` }} />
                            </span>
                            <span className="bar-num">
                              {d.pass}/{d.caution}/{d.fail}
                            </span>
                          </div>
                        </td>
                        <td className="dep-tickers">{d.tickers.join(" · ") || "—"}</td>
                        <td className="dep-tickers">{d.last_seen ? ago(d.last_seen) : "—"}</td>
                        <td>{d.fail >= 2 ? <span className="rep-flag">repeat offender</span> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p style={{ marginTop: 22, fontSize: 13.5 }}>
            Read this as history, not prophecy. A wallet with a clean record can still rug the next
            one, and a deployer inherits nothing from an address that merely funded it. What this
            shows is exactly what we scanned, nothing inferred.
          </p>
        </div>
      </section>
    </>
  );
}
