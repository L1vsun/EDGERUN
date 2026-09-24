"use client";

import { useState } from "react";
import { shot } from "@/lib/config";
import Zoomable from "./Zoomable";

// One real screenshot, high on the page.
//
// The animation above it is a diagram of what happens; this is the thing itself. A visitor
// who scrolls no further should still have seen the actual product once, so it sits inside
// the first screen's block rather than down in the gallery.
//
// It removes itself if the file is not there. A hero with a broken image is worse than a
// hero with no image, and this must never be the reason the top of the page looks unfinished.

export default function ProductShot() {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <figure className="pshot">
      <Zoomable
        src={shot("product.jpg")}
        alt="The EDGERUN side panel open next to a post on X, flagging a contract that does not match the ticker it was posted under"
        onError={() => setFailed(true)}
      />
      <figcaption>The panel, open on a real post. Every number in it was read from the chain. Click to enlarge.</figcaption>
    </figure>
  );
}
