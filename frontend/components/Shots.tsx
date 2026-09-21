"use client";

import { useState } from "react";
import { asset } from "@/lib/config";

// Real screenshots of the extension doing its job. Each one degrades to a labelled frame if
// the image is not there yet, so a missing file never renders as a broken icon - drop the
// PNG into frontend/public/shots/ with the filename below and it appears.

const SHOTS = [
  {
    file: "x-fake.png",
    where: "On X",
    caption: "A post names $TSLA and pastes a contract. The badge lands under the text and says it is a different token.",
    hint: "x.com - any post with a Robinhood Chain contract address in it",
  },
  {
    file: "x-ticker.png",
    where: "An ambiguous ticker",
    caption: "$PEPE is seven different contracts on this chain. The panel lists every one of them.",
    hint: "x.com - a post that says a bare $TICKER with no address",
  },
  {
    file: "explorer.png",
    where: "On the block explorer",
    caption: "The full report as a standing panel: source, mint selectors, ownership, and a simulated transfer out of a real holder's wallet.",
    hint: "robinhoodchain.blockscout.com/token/0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715",
  },
  {
    file: "dexscreener.png",
    where: "On Dexscreener",
    caption: "Next to the ticker in the pair header, before you trade it.",
    hint: "dexscreener.com/robinhood/<any pair>",
  },
];

function Shot({ s }: { s: (typeof SHOTS)[number] }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="shot">
      <div className="shot-frame">
        {failed ? (
          <div className="shot-todo">
            <b>{s.where}</b>
            <span>screenshot pending</span>
            <code>{s.hint}</code>
          </div>
        ) : (
          <img src={asset(`/shots/${s.file}`)} alt={s.caption} loading="lazy" onError={() => setFailed(true)} />
        )}
      </div>
      <figcaption>
        <b>{s.where}</b>
        {s.caption}
      </figcaption>
    </figure>
  );
}

export default function Shots() {
  return (
    <section className="shots" id="shots">
      <div className="fhead">
        <h2>What it looks like</h2>
        <small>real output on real contracts, not mockups</small>
      </div>
      <div className="shot-grid">
        {SHOTS.map((s) => (
          <Shot key={s.file} s={s} />
        ))}
      </div>
    </section>
  );
}
