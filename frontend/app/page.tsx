import Link from "next/link";
import Hero from "@/components/Hero";
import LiveFeed from "@/components/LiveFeed";

export default function Home() {
  return (
    <>
      <Hero />

      <section className="block" style={{ paddingTop: 0, paddingBottom: 32, borderBottom: "none" }}>
        <div className="container">
          <div className="teaser-row">
            <Link href="/mechanism" className="teaser-card">
              <div className="eyebrow">mechanism</div>
              <h3>Two checks, run every time</h3>
              <p>Contract safety and impersonation — the exact call behind every line.</p>
              <span className="go">read the breakdown →</span>
            </Link>
            <Link href="/limits" className="teaser-card">
              <div className="eyebrow">say it out loud</div>
              <h3>What this doesn't catch</h3>
              <p>Holder concentration, admin-key changes, social engineering — named, not hidden.</p>
              <span className="go">see the limits →</span>
            </Link>
            <Link href="/onchain" className="teaser-card">
              <div className="eyebrow">trust mechanic</div>
              <h3>Verify it yourself</h3>
              <p>Every check links to the source it came from. Nothing here asks to be trusted blind.</p>
              <span className="go">check the sources →</span>
            </Link>
          </div>
        </div>
      </section>

      <LiveFeed />
    </>
  );
}
