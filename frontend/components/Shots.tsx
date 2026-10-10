"use client";

import { useState } from "react";
import { shot } from "@/lib/config";
import Zoomable from "./Zoomable";

// Real screenshots of the extension doing its job. Each one degrades to a labelled frame if
// the image is not there yet, so a missing file never renders as a broken icon - drop the
// PNG into frontend/public/shots/ with the filename below and it appears.

const SHOTS = [
  {
    file: "pumpfun.jpg",
    where: "On the token's own page",
    caption: "A coin page on pump.fun. This mint calls itself Fartcoin; the curated list gives that symbol to a different mint. The badge sits in a fixed corner, and its window opens beside it.",
    hint: "pump.fun/coin/<mint>",
  },
  {
    file: "panel.jpg",
    where: "In the side panel",
    caption: "The same mint in the panel: what the chain says about it, then the launch as an index records it - where it launched, how widely it is held, whose wallet made it.",
    hint: "the side panel - paste a mint and expand the row",
  },
  {
    file: "creator.jpg",
    where: "Dig deeper",
    caption: "One click further: whether any of the largest holders were paid for together, and the creator's record - 32 launches, 4 off the launchpad, and its two best other tokens no longer trading.",
    hint: "the side panel - dig deeper",
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
        <h2>Not a mockup.</h2>
        <small>Real captures of the extension on a live page and a live mint, read on the day they were taken.</small>
      </div>
      <div className="shot-grid">
        {SHOTS.map((s) => (
          <Shot key={s.file} s={s} />
        ))}
      </div>
    </section>
  );
}
