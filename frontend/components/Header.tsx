import { DEX_URL, GITHUB_REPO_URL, TOKEN_TICKER, asset } from "@/lib/config";

export default function Header() {
  return (
    <header className="top">
      <a href={asset("/")} className="brand" aria-label="edgerun home">
        <img src={asset("/lockup-ink.png")} alt="edgerun" />
      </a>
      <div className="top-actions">
        {GITHUB_REPO_URL ? (
          <a className="btn" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        ) : null}
        {DEX_URL ? (
          <a className="btn btn-accent" href={DEX_URL} target="_blank" rel="noreferrer">
            Buy {TOKEN_TICKER}
          </a>
        ) : (
          <span className="btn btn-accent">{TOKEN_TICKER} · soon</span>
        )}
      </div>
    </header>
  );
}
