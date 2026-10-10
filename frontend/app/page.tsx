import Hero from "@/components/Hero";
import Marquee from "@/components/Marquee";
import Catches from "@/components/Catches";
import Install from "@/components/Install";
import Chains from "@/components/Chains";
import Shots from "@/components/Shots";
import Nose from "@/components/Nose";
import Council from "@/components/Council";
import Mark from "@/components/Mark";
import { DEX_URL, GITHUB_REPO_URL, TOKEN_TICKER, X_URL } from "@/lib/config";

export default function Home() {
  return (
    <>
      {/* The claim, what it catches, what it looks like, how to run it, what each chain can
          prove. The lab at the bottom is the other half of the project: the same reading of
          the market, done out loud. */}
      <Hero />
      <Marquee />
      <Catches />
      <Shots />
      <Install />
      <Chains />
      <div className="lab" id="lab">
        <Nose />
        <Council />
      </div>
      <footer className="end">
        <div className="end-in">
          <div className="end-word"><Mark size={84} /><b>EDGERUN</b></div>
          <p className="end-line">Read the wallet, not the post.</p>
          <div className="end-links">
            {DEX_URL ? (
              <a className="cta cta-bone" href={DEX_URL} target="_blank" rel="noreferrer">Buy {TOKEN_TICKER}</a>
            ) : (
              <span className="cta cta-bone soon">{TOKEN_TICKER} is not live yet</span>
            )}
            <a href={X_URL} target="_blank" rel="noreferrer">X</a>
            <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">Source</a>
          </div>
          <p className="end-credit">
            Circuit: <a href="https://flywire.ai" target="_blank" rel="noreferrer">FlyWire</a> connectome (Dorkenwald et al., 2024) ·
            sparse coding after <a href="https://www.science.org/doi/10.1126/science.aam9868" target="_blank" rel="noreferrer">Dasgupta, Stevens &amp; Navlakha, 2017</a> ·
            market data read live from a public index, in your browser
          </p>
        </div>
      </footer>
    </>
  );
}
