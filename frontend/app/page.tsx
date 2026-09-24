import Hero from "@/components/Hero";
import Install from "@/components/Install";
import Chains from "@/components/Chains";
import Shots from "@/components/Shots";
import Nose from "@/components/Nose";
import Council from "@/components/Council";
import { DEX_URL, TOKEN_TICKER } from "@/lib/config";

export default function Home() {
  return (
    <>
      {/* The product first, then how to run it, then what it reads and what each chain
          can actually prove. The circuit below is how it thinks. */}
      <Hero />
      <Install />
      <Chains />
      <Shots />
      <Nose />
      <Council />
      <footer className="credit">
        <p className="credit-token">
          {DEX_URL ? (
            <a className="cta" href={DEX_URL} target="_blank" rel="noreferrer">Buy {TOKEN_TICKER}</a>
          ) : (
            <span className="credit-soon">{TOKEN_TICKER} is not live yet</span>
          )}
        </p>
        Circuit: <a href="https://flywire.ai" target="_blank" rel="noreferrer">FlyWire</a> connectome (Dorkenwald et al., 2024) ·
        sparse coding after <a href="https://www.science.org/doi/10.1126/science.aam9868" target="_blank" rel="noreferrer">Dasgupta, Stevens &amp; Navlakha, 2017</a> ·
        chain data read live from the public Robinhood Chain RPC
      </footer>
    </>
  );
}
