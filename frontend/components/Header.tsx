"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useChainPulse } from "@/lib/chain";
import { GITHUB_REPO_URL, TOKEN_TICKER } from "@/lib/config";
import LogoMark from "./LogoMark";

const TABS = [
  { href: "/", label: "Live Feed" },
  { href: "/mechanism", label: "Mechanism" },
  { href: "/limits", label: "Limits" },
  { href: "/onchain", label: "On-Chain" },
  { href: "/token", label: TOKEN_TICKER.replace("$", "") },
];

export default function Header() {
  const pathname = usePathname();
  const pulse = useChainPulse();

  return (
    <div className="header">
      <div className="header-inner">
        <Link href="/" className="brand">
          <LogoMark size={20} />
          <span className="brand-name">edgerun</span>
        </Link>

        <nav className="nav-tabs">
          {TABS.map((t) => {
            const active = t.href === "/" ? pathname === "/" : pathname?.startsWith(t.href);
            return (
              <Link key={t.href} href={t.href} className={`nav-tab${active ? " active" : ""}`}>
                {t.label}
              </Link>
            );
          })}
        </nav>

        <div className="chain-pulse">
          <span className="dot-live" />
          <span>
            BLK <b>{pulse.blockNumber ? pulse.blockNumber.toLocaleString() : "…"}</b>
          </span>
          {pulse.gasGwei !== null && (
            <span>
              GAS <b>{pulse.gasGwei.toFixed(3)}</b>
            </span>
          )}
          <span>
            CHAIN <b>4663</b>
          </span>
        </div>

        <div className="header-actions">
          {GITHUB_REPO_URL ? (
            <a className="btn" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
          ) : null}
          <Link href="/token" className="btn btn-accent">
            Buy {TOKEN_TICKER}
          </Link>
        </div>
      </div>
    </div>
  );
}
