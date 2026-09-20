import BrainStage from "@/components/BrainStage";

export default function Home() {
  return (
    <>
      <BrainStage />
      <footer className="credit">
        Connectome: <a href="https://flywire.ai" target="_blank" rel="noreferrer">FlyWire</a> (Dorkenwald et al., 2024) ·
        model: <a href="https://github.com/philshiu/Drosophila_brain_model" target="_blank" rel="noreferrer">Shiu et al., 2023</a>
      </footer>
    </>
  );
}
