import Mark from "./Mark";

// A band of the five questions, moving. It is decoration and it is also the table of
// contents: every phrase on it is something the extension answers under a post.
const WORDS = ["Which mint", "Who paid for the holders", "Who sold after posting", "Who launched it", "What happened after"];

export default function Marquee() {
  // the list twice, so the second copy slides in exactly as the first slides out
  const run = [...WORDS, ...WORDS];
  return (
    <div className="band" aria-hidden="true">
      <div className="band-run">
        {[0, 1].map((k) => (
          <div className="band-set" key={k}>
            {run.map((w, i) => (
              <span key={i}>{w}<Mark size={22} /></span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
