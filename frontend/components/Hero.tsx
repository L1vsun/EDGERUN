"use client";

import { useEffect, useState } from "react";
import { GITHUB_REPO_URL } from "@/lib/config";

// What the product actually is, shown rather than described: a post, the badge landing on
// it, the verdict. The demo is the extension's real output on a real contract — the fake
// TSLA at 0xD18F… is a live honeypot, and $PEPE really is seven different contracts.
//
// One loop, four steps, no libraries. Anything more elaborate here would be a worse use of
// the first five seconds than simply showing the thing working.

const POST = "$TSLA is live on Robinhood Chain 🚀 CA: 0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715 — send it";

const STEPS = [
  { at: 0, type: 0 },          // empty
  { at: 600, type: 1 },        // typing
  { at: 3400, type: 2 },       // badge appears, checking
  { at: 4600, type: 3 },       // verdict
  { at: 11000, type: 0 },      // hold, then loop
];
const LOOP = 11600;

export default function Hero() {
  const [phase, setPhase] = useState(0);
  const [typed, setTyped] = useState("");
  const [still, setStill] = useState(false);

  useEffect(() => {
    // someone who asked for less motion gets the finished frame, not a loop
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setStill(true); setPhase(3); setTyped(POST); return; }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) % LOOP;
      let p = 0;
      for (const s of STEPS) if (t >= s.at) p = s.type;
      setPhase(p);
      if (p === 1) {
        const k = Math.min(1, (t - 600) / 2600);
        setTyped(POST.slice(0, Math.round(k * POST.length)));
      } else if (p >= 2) setTyped(POST);
      else setTyped("");
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <section className="lead">
      <div className="lead-in">
        <span className="kicker">Robinhood Chain · browser extension</span>
        <h1>
          The ticker in that post<br />
          is not one token.
        </h1>
        <p>
          Seven different contracts use <b>$PEPE</b> on this chain. Six use <b>$HOOD</b>. Anyone
          can deploy a token called <b>Tesla • Robinhood Token</b> — and 213 of them already have.
          edgerun checks the contract while you are still reading the post, in your browser,
          against the chain and Robinhood&apos;s own published registry.
        </p>
        <div className="lead-cta">
          <a className="cta" href={GITHUB_REPO_URL || "#"} target="_blank" rel="noreferrer">Get the extension</a>
          <a className="cta cta-ghost" href="#council">See how it decides</a>
        </div>
        <div className="lead-facts">
          <div><b>194</b><span>official stock tokens, from Robinhood&apos;s registry</span></div>
          <div><b>213</b><span>counterfeits found across ten tickers</span></div>
          <div><b>~200ms</b><span>to check an address, with no server involved</span></div>
        </div>
      </div>

      <div className={`demo${still ? " still" : ""}`} aria-hidden="true">
        <div className="demo-chrome"><i /><i /><i /><span>x.com</span></div>
        <div className="post">
          <div className="post-who"><span className="av" />@degen_calls</div>
          <p className="post-text">
            {typed}
            {phase === 1 && <i className="caret" />}
          </p>

          {phase >= 2 && (
            <div className={`badge${phase >= 3 ? " done" : " busy"}`}>
              {phase >= 3 ? (
                <>
                  <span className="g">✕</span>
                  <span className="b-body">
                    <b>$TSLA · not the real one</b>
                    <span>
                      This post names $TSLA, which Robinhood publishes at 0x322f0929… — but the
                      contract in the post is 0xd18f5e73…, a different token.
                    </span>
                  </span>
                  <span className="b-more">details</span>
                </>
              ) : (
                <>
                  <span className="g">·</span>
                  <span className="b-body"><b>checking the chain…</b></span>
                </>
              )}
            </div>
          )}

          <div className="post-bar"><span>12</span><span>48</span><span>301</span></div>
        </div>
      </div>
    </section>
  );
}
