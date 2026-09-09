import ChangeFeed from "@/components/ChangeFeed";

export const metadata = { title: "Changes — edgerun" };

export default function ChangesPage() {
  return (
    <>
      <section className="page-head">
        <div className="container-wide">
          <div className="eyebrow">
            <span className="live-dot" /> watchtower
          </div>
          <h1>What changed after the scan</h1>
          <p>
            A scan is a snapshot, and a snapshot goes stale. A contract that passed every check
            an hour ago can have ownership re-acquired, a mint added, or transfers switched off —
            and nothing about the original verdict would tell you. edgerun re-scans everything it
            has seen and records the moment a fact stops being true.
          </p>
          <p>
            Each entry below is a disagreement between two real scans of the same contract. Nothing
            here is predicted or inferred; a change is logged only when we checked twice and got
            different answers.
          </p>
        </div>
      </section>

      <section className="block">
        <div className="container-wide">
          <ChangeFeed />
        </div>
      </section>
    </>
  );
}
