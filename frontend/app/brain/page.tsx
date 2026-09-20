import BrainReplay from "@/components/BrainReplay";

export const metadata = { title: "Fly Brain — edgerun" };

export default function BrainPage() {
  return (
    <>
      <section className="page-head">
        <div className="container-wide">
          <div className="eyebrow">
            <span className="live-dot" /> fly brain · recorded replay
          </div>
          <h1>A real fly brain, watching the chain</h1>
          <p>
            The whole adult <i>Drosophila</i> connectome — 138,639 neurons and 15 million synapses,
            mapped in electron microscopy — running as a simulation. edgerun&apos;s real scan results
            are fed into it as taste: a clean contract stimulates sugar-sensing neurons, a flagged one
            stimulates bitter-sensing neurons.
          </p>
          <p>
            What you see is how the brain responds. It is a biological signal, not a prediction, and it
            does not decide anything — the gate only trusts scan facts. Next to every reading is the same
            brain with its wiring scrambled, so you can see for yourself whether the structure matters.
          </p>
        </div>
      </section>
      <BrainReplay />
    </>
  );
}
