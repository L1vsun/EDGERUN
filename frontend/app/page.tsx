import Nose from "@/components/Nose";

export default function Home() {
  return (
    <>
      <Nose />
      <footer className="credit">
        Circuit: <a href="https://flywire.ai" target="_blank" rel="noreferrer">FlyWire</a> connectome (Dorkenwald et al., 2024) ·
        sparse coding after <a href="https://www.science.org/doi/10.1126/science.aam9868" target="_blank" rel="noreferrer">Dasgupta, Stevens &amp; Navlakha, 2017</a> ·
        chain data read live from the public Robinhood Chain RPC
      </footer>
    </>
  );
}
