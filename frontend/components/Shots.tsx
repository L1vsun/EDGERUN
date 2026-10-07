"use client";

import { useState } from "react";
import { shot } from "@/lib/config";
import Zoomable from "./Zoomable";

// Real screenshots of the extension doing its job. Each one degrades to a labelled frame if
// the image is not there yet, so a missing file never renders as a broken icon - drop the
// PNG into frontend/public/shots/ with the filename below and it appears.

const SHOTS = [
  {
    file: "solana.jpg",
    where: "In the panel",
    caption: "A Solana mint read from the chain, the launch as an index records it, and - on request - who actually holds it: here one wallet with 58% of supply, and the launchpad's curve drawn as what it is.",
    hint: "the side panel - paste a mint, expand the row, dig deeper",
  },
  {
    file: "dexscreener.jpg",
    where: "On Dexscreener",
    caption: "Next to the ticker in the pair header, before you trade it. This mint calls itself PUMP; the lists give that symbol to a different one.",
    hint: "dexscreener.com/solana/<any pair>",
  },
  {
    file: "pumpfun.jpg",
    where: "On the token's own page",
    caption: "A fixed corner of the launchpad's page, so it can never land in the wrong row. Same check, same answer.",
    hint: "pump.fun/coin/<mint>",
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
