"use client";

import { useState } from "react";

// chrome://extensions cannot be linked to.
//
// Chrome blocks navigation to chrome:// URLs initiated from web content, so an <a href> here
// would render as a link, get clicked, and do nothing at all - which is worse than plain text,
// because the reader concludes the site is broken rather than that they need to paste it.
//
// So it copies instead. One click, then the address bar. The tooltip says why.

export default function ChromeLink({ url = "chrome://extensions" }: { url?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the text is on screen and selectable */
    }
  };

  return (
    <button
      type="button"
      className="copyurl"
      onClick={copy}
      title="Copy it - browsers do not allow a web page to link to chrome:// pages"
      aria-label={`Copy ${url}`}
    >
      <code>{url}</code>
      <span>{copied ? "copied, now paste it in your address bar" : "copy"}</span>
    </button>
  );
}
