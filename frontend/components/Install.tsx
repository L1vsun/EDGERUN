import { EXTENSION_URL } from "@/lib/config";

// Deliberately on the front page rather than behind a link. Someone who has just read what
// this does should not have to navigate to find out how to run it - three steps and the
// download, in the same scroll.

const STEPS = [
  {
    n: "01",
    t: "Download it",
    d: (
      <>
        Grab the repo from{" "}
        <a href={EXTENSION_URL} target="_blank" rel="noreferrer">
          GitHub
        </a>{" "}
        (Code &rarr; Download ZIP) and unzip it. The extension is the <code>extension/</code> folder.
      </>
    ),
  },
  {
    n: "02",
    t: "Load it in your browser",
    d: (
      <>
        Open <code>chrome://extensions</code>, turn on <b>Developer mode</b> (top right), click{" "}
        <b>Load unpacked</b> and pick that <code>extension/</code> folder. Works in Chrome, Brave,
        Edge and Arc.
      </>
    ),
  },
  {
    n: "03",
    t: "That is it - no account, no key",
    d: (
      <>
        Nothing to sign up for and nothing to configure. The checks run in your own browser against
        the chain, so there is no server to trust and nothing of yours leaves the machine.
      </>
    ),
  },
];

const USES = [
  {
    where: "On X",
    what: "Scroll normally. Any post naming a contract address or a ticker gets a badge under the text: red if the contract is not what the post claims, amber if the ticker is ambiguous, quiet otherwise.",
  },
  {
    where: "On Dexscreener",
    what: "Open any Robinhood Chain pair. The badge sits next to the ticker in the header and runs the full contract check on the token being traded.",
  },
  {
    where: "On the block explorer",
    what: "Any token or address page gets the whole report as a panel: source verification, mint selectors, ownership, and a simulated transfer out of a real holder's wallet.",
  },
  {
    where: "Anywhere else",
    what: "Click the toolbar icon and paste an address. Same checks, plus a local watchlist that never leaves your browser.",
  },
];

export default function Install() {
  return (
    <section className="install" id="install">
      <div className="fhead">
        <h2>Install it in two minutes</h2>
        <small>not in the Chrome Web Store yet - loaded from the repo, which means you can read every line first</small>
      </div>

      <div className="steps">
        {STEPS.map((s) => (
          <div className="step" key={s.n}>
            <span className="step-n">{s.n}</span>
            <b>{s.t}</b>
            <p>{s.d}</p>
          </div>
        ))}
      </div>

      <div className="uses" id="how">
        <h3>Then just use the internet</h3>
        <div className="use-grid">
          {USES.map((u) => (
            <div className="use" key={u.where}>
              <b>{u.where}</b>
              <p>{u.what}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="install-note">
        A red badge is a claim you can check yourself: every panel names the number behind it and
        links to the explorer. Nothing here is advice, and a token with no flags is not safe - it is
        only unremarkable right now.
      </p>
    </section>
  );
}
