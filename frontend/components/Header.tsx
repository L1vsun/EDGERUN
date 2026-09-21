import ThemeToggle from "./ThemeToggle";
import { DEX_URL, EXTENSION_URL, GITHUB_USER_URL, TOKEN_TICKER, X_URL, asset } from "@/lib/config";

export default function Header() {
  return (
    <header className="top">
      <a href={asset("/")} className="brand" aria-label="EDGERUN home">
        <img src={asset("/lockup-ink.png")} alt="EDGERUN" />
      </a>

      <nav className="top-nav">
        <a href="#install">Install</a>
        <a href="#how">How it works</a>
        <a href="#council">The council</a>
      </nav>

      <div className="top-actions">
        <ThemeToggle />
        <a className="ico" href={X_URL} target="_blank" rel="noreferrer" aria-label="X" title="X">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path fill="currentColor" d="M18.9 2H22l-7.3 8.3L23.3 22h-6.8l-5.3-6.9L5.1 22H2l7.8-8.9L1.1 2h6.9l4.8 6.4L18.9 2Zm-1.1 18h1.9L7.3 3.9H5.3L17.8 20Z" />
          </svg>
        </a>
        <a className="ico" href={GITHUB_USER_URL} target="_blank" rel="noreferrer" aria-label="GitHub" title="GitHub">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="currentColor" d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.300-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2Z" />
          </svg>
        </a>
        <a className="btn" href={EXTENSION_URL} target="_blank" rel="noreferrer">
          Get the extension
        </a>
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
