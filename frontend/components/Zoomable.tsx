"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Click a screenshot, see it at full size.
//
// These are dense UI captures - a side panel with seven checks in it - and at the width a
// gallery cell or a hero column gives them, the text they are showing off is unreadable. That
// is fine as long as reading it is one click away, and it lets the page use small thumbnails
// rather than fighting for space with images nobody can read anyway.
//
// No library, but it does need a PORTAL. Rendered in place, the overlay is a child of the
// figure it came from, so `.pshot img { max-height: clamp(190px, 30vh, 340px) }` - written to
// keep the hero thumbnail small - matched the full-size image too and the lightbox opened at
// 310px on a 1024px screen. The gallery has the same shape of problem waiting in
// `.shot-frame`, which is both `max-height: 560px` and `overflow: hidden`. Mounting on
// document.body means no page rule can reach in.
//
// Escape closes, the backdrop closes, and the page behind it stops scrolling while it is
// open - without that last part a trackpad scroll moves the page under the image and the
// overlay feels broken.

export default function Zoomable({
  src,
  alt,
  className,
  loading = "lazy",
  onError,
}: {
  src: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  onError?: () => void;
}) {
  const [open, setOpen] = useState(false);
  // portals need a DOM, and this page is prerendered to static HTML first
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button type="button" className={`zoom ${className || ""}`} onClick={() => setOpen(true)}
        aria-label={`${alt} - open full size`}>
        <img src={src} alt={alt} loading={loading} onError={onError} />
        <span className="zoom-cue" aria-hidden="true">⤢</span>
      </button>

      {open && mounted &&
        createPortal(
          // Escape is bound above and the close button is the keyboard path; clicking the
          // backdrop is a mouse affordance on top of those, not the only way out.
          <div className="lightbox" role="dialog" aria-modal="true" aria-label={alt}
            onClick={() => setOpen(false)}>
            <button type="button" className="lightbox-x" aria-label="Close">✕</button>
            <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
          </div>,
          document.body,
        )}
    </>
  );
}
