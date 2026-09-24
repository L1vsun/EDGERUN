"use client";

import { useState } from "react";
import { shot } from "@/lib/config";
import Zoomable from "./Zoomable";

// Real screenshots of the extension doing its job. Each one degrades to a labelled frame if
// the image is not there yet, so a missing file never renders as a broken icon - drop the
// PNG into frontend/public/shots/ with the filename below and it appears.

const SHOTS = [
  {
    file: "x-fake.jpg",
    where: "On X",
    caption: "A post names $NVDA and pastes a contract. The badge lands under the text and says it is a different token - with both addresses and the chain it is on.",
    hint: "x.com - any post with a Robinhood Chain contract address in it",
  },
  {
    file: "solana.jpg",
    where: "On Solana",
    caption: "A mint read from the chain: who can create supply, who can freeze your account, and whether a transfer hook can reject the sale.",
    hint: "x.com - a post naming a Solana mint, or paste one into the panel",
  },
  {
    file: "explorer.jpg",
    where: "On the block explorer",
    caption: "The full report as a standing panel: source, mint selectors, ownership, and a simulated transfer out of a real holder's wallet.",
    hint: "robinhoodchain.blockscout.com/token/0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715",
  },
  {
    file: "dexscreener.jpg",
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
          <Zoomable src={shot(s.file)} alt={s.caption} onError={() => setFailed(true)} />
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
