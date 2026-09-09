"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchStockTokens, fetchImpersonators, StockToken, Impersonator } from "@/lib/api";

export default function StockTokensPage() {
  const [official, setOfficial] = useState<StockToken[] | null>(null);
  const [fakes, setFakes] = useState<Impersonator[] | null>(null);
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchStockTokens(), fetchImpersonators(60)])
      .then(([o, f]) => {
        if (cancelled) return;
        setOfficial(o.items);
        setSource(o.source);
        setFakes(f.items);
      })
      .catch(() => !cancelled && setErr(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!official) return null;
    const s = q.trim().toLowerCase();
    if (!s) return official;
    return official.filter(
      (t) => t.ticker.toLowerCase().includes(s) || t.name.toLowerCase().includes(s)
    );
  }, [official, q]);

  return (
    <>
      <section className="page-head">
        <div className="container-wide">
          <div className="eyebrow">robinhood chain only</div>
          <h1>Real stocks, and everything pretending to be them</h1>
          <p>
            Robinhood Chain is the only chain carrying official tokenised equities — real
            securities issued by Robinhood Assets (Jersey) Limited, trading as ordinary ERC-20s.
            Robinhood publishes the authoritative contract address for every one of them, which
            means a fake <b>TSLA</b> isn&apos;t a similarity score here. It&apos;s a fact.
          </p>
          <p>
            This is what a contract-level scanner structurally cannot catch. A counterfeit
            &ldquo;Tesla • Robinhood Token&rdquo; is a perfectly clean ERC-20 — verified source,
            renounced ownership, fixed supply. Every code-level check passes it. It is a scam
            purely because of what it claims to be.
          </p>
        </div>
      </section>

      {err ? (
        <section className="block">
          <div className="container-wide">
            <div className="feed-empty">registry unavailable right now</div>
          </div>
        </section>
      ) : (
        <>
          <section className="block">
            <div className="container-wide">
              <h2 style={{ fontSize: 24 }}>Impersonators we have scanned</h2>
              <p>
                Drawn from contracts this tool actually checked — not a sweep of the whole chain.
              </p>
              {fakes === null ? (
                <div className="feed-empty">loading…</div>
              ) : fakes.length === 0 ? (
                <div className="feed-empty">
                  none in the current scan window. The poller only sees what it has scanned; the
                  chain has many more.
                </div>
              ) : (
                <div className="change-list">
                  {fakes.map((f) => (
                    <div className="change-item sev-critical" key={f.address}>
                      <div className="change-top">
                        <span className="change-headline">COUNTERFEIT STOCK TOKEN</span>
                        <span className="change-time">{f.ticker || "—"}</span>
                      </div>
                      <div className="change-body">
                        <span className="change-ticker">{f.name || "unnamed"}</span>
                        <a
                          className="change-addr"
                          href={`https://robinhoodchain.blockscout.com/address/${f.address}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {f.address.slice(0, 10)}…{f.address.slice(-8)}
                        </a>
                      </div>
                      <div className="change-detail">{f.detail}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="block">
            <div className="container-wide">
              <h2 style={{ fontSize: 24 }}>
                The official registry{official ? ` · ${official.length} tokens` : ""}
              </h2>
              <p>
                Straight from{" "}
                <a href={source} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
                  {source || "Robinhood's public API"}
                </a>
                . If an address below doesn&apos;t match the one you&apos;re about to buy, you are
                not buying that stock.
              </p>
              <div className="feed-controls">
                <input
                  className="mono"
                  placeholder="filter by ticker or company…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  spellCheck={false}
                />
              </div>
              {filtered === null ? (
                <div className="feed-empty">loading…</div>
              ) : filtered.length === 0 ? (
                <div className="feed-empty">nothing matches that filter.</div>
              ) : (
                <div className="panel" style={{ overflowX: "auto" }}>
                  <table className="dep-table">
                    <thead>
                      <tr>
                        <th>ticker</th>
                        <th>asset</th>
                        <th>official contract</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((t) => (
                        <tr key={t.address}>
                          <td className="dep-addr">{t.ticker}</td>
                          <td className="dep-tickers">{t.name.replace(" • Robinhood Token", "")}</td>
                          <td>
                            <a
                              href={`https://robinhoodchain.blockscout.com/address/${t.address}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t.address}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
