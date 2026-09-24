import ChromeLink from "./ChromeLink";
import GetExtension from "./GetExtension";

// Deliberately on the front page rather than behind a link. Someone who has just read what
// this does should not have to navigate to find out how to run it - three steps and the
// download, in the same scroll.

const STEPS = [
  {
    n: "01",
    t: "Download it",
    d: (
      <>
        <GetExtension className="cta cta-sm">Download the .zip</GetExtension> and unzip it somewhere you
        will not delete by accident. The dialog carries the file&rsquo;s SHA-256 so you can check what you
        got, and a link to the source if you would rather build it yourself.
      </>
    ),
  },
  {
    n: "02",
    t: "Load it in your browser",
    d: (
      <>
        Open <ChromeLink />, turn on <b>Developer mode</b> (top right), click{" "}
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
    what: "Scroll normally. A post naming a contract address or a Solana mint gets a badge under the text - one per token, because a post naming three contracts is talking about three things. A bare $TICKER with no address stays quiet on purpose.",
  },
  {
    where: "Who posted it",
    what: "Every contract arrived attached to an account, and the panel keeps that half: how many contracts an account has put in front of you, how many came back flagged, and whether several accounts arrived on the same contract inside the same few minutes. Local only, with one button that forgets all of it.",
  },
  {
    where: "On Dexscreener and the explorer",
    what: "Open any pair or token page. The badge sits in the header and runs the full check: source verification, mint selectors, ownership, deployer history, and a simulated transfer out of a real holder's wallet.",
  },
  {
    where: "Anywhere else",
    what: "Click the toolbar icon and paste a contract address or a Solana mint - one box, both alphabets. Same checks, plus a watchlist that tells you what moved since you last looked.",
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
        Every badge names the number behind it and links to the explorer, and a report carries
        the exact commands that check it - so a red verdict is never something you have to take
        on trust. A token with no flags is not safe, only unremarkable.
      </p>
    </section>
  );
}
