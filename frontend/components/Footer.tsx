import Link from "next/link";
import { GITHUB_REPO_URL, asset } from "@/lib/config";

export default function Footer() {
  return (
    <footer>
      <div className="container">
        <img className="foot-mark" src={asset("/mark-ink.png")} alt="edgerun" />
      </div>
      <div className="container foot-links">
        <Link href="/">live feed</Link>
        <Link href="/stock-tokens">stock tokens</Link>
        <Link href="/changes">changes</Link>
        <Link href="/deployers">deployers</Link>
        <Link href="/mechanism">mechanism</Link>
        <Link href="/limits">limits</Link>
        <Link href="/onchain">on-chain</Link>
        <Link href="/token">token</Link>
        {GITHUB_REPO_URL ? (
          <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
            github
          </a>
        ) : null}
      </div>
      <div className="container">
        edgerun is a verification tool, not investment advice or a signal service. It cannot
        catch every scam — see "limits" above. Always confirm independently.
      </div>
    </footer>
  );
}
