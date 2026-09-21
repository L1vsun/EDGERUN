import Hero from "@/components/Hero";
import Install from "@/components/Install";
import Nose from "@/components/Nose";
import Council from "@/components/Council";

export default function Home() {
  return (
    <>
      {/* The product first, then how to run it. The circuit below is how it thinks. */}
      <Hero />
      <Install />
      <Nose />
      <Council />
      <footer className="credit">
        Circuit: <a href="https://flywire.ai" target="_blank" rel="noreferrer">FlyWire</a> connectome (Dorkenwald et al., 2024) ·
        sparse coding after <a href="https://www.science.org/doi/10.1126/science.aam9868" target="_blank" rel="noreferrer">Dasgupta, Stevens &amp; Navlakha, 2017</a> ·
        chain data read live from the public Robinhood Chain RPC
      </footer>
    </>
  );
}
