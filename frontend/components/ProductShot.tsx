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
        alt="The EDGERUN badge in the header of a real Dexscreener pair page, and the side panel open on the same mint, flagging a symbol that the lists give to a different token"
        onError={() => setFailed(true)}
      />
      <figcaption>The badge on a real pair page and the panel open on the same mint - two real captures, side by side. Click to enlarge.</figcaption>
    </figure>
  );
}
