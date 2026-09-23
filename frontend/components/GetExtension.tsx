"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EXTENSION_KB,
  EXTENSION_SHA256,
  EXTENSION_VERSION,
  EXTENSION_ZIP,
  GITHUB_REPO_URL,
} from "@/lib/config";

// The download dialog.
//
// Handing someone a zip and telling them to load it unpacked is, on its face, exactly what a
// malicious extension would ask for. So the dialog does not say "trust us" - it hands over
// the things that let someone not have to: the SHA-256 of the file they are about to get,
// the source to build it from, and a plain statement of what the thing can and cannot reach.
// Every claim here is checkable against the manifest in the same archive.

type Props = {
  className?: string;
  children?: React.ReactNode;
};

export default function GetExtension({ className = "cta", children = "Get the extension" }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setCopied(false);
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // the page behind a modal should not scroll away under it
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  const copyHash = async () => {
    try {
      await navigator.clipboard.writeText(EXTENSION_SHA256);
      setCopied(true);
    } catch {
      /* clipboard blocked: the hash is on screen and selectable anyway */
    }
  };

  return (
    <>
      <button ref={openerRef} type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>

      {open && (
        <div className="modal-wrap" role="presentation" onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ext-title">
            <div className="modal-head">
              <h3 id="ext-title">Install EDGERUN</h3>
              <button ref={closeRef} type="button" className="modal-x" onClick={close} aria-label="Close">
                ×
              </button>
            </div>

            <div className="modal-body">
              <p className="modal-lead">
                It is not in the Chrome Web Store yet, so it installs as an unpacked extension. That takes
                about a minute and you can read every line of it first.
              </p>

              <ul className="safe">
                <li>
                  <b>No account, no wallet, no server.</b> Checks run in your browser against the chain,
                  Robinhood&rsquo;s published registry and a public blocklist.
                </li>
                <li>
                  <b>It cannot reach your funds.</b> There is no wallet connection and no signing - the code
                  requests no such permission, which you can confirm in the manifest.
                </li>
                <li>
                  <b>It only wakes on four sites.</b> X, Dexscreener, the Robinhood Chain explorer, and this
                  one. Everything else you browse is invisible to it.
                </li>
                <li>
                  <b>Nothing is sent anywhere.</b> Your watchlist and session history stay on the machine.
                </li>
              </ul>

              <a className="dl" href={EXTENSION_ZIP} download>
                Download v{EXTENSION_VERSION}
                <span>{EXTENSION_KB} KB &middot; .zip</span>
              </a>

              <div className="hashline">
                <span>SHA-256</span>
                <code>{EXTENSION_SHA256}</code>
                <button type="button" onClick={copyHash}>
                  {copied ? "copied" : "copy"}
                </button>
              </div>
              <p className="hashnote">
                Run <code>shasum -a 256</code> on the file you downloaded. If it does not match this, do not
                install it.
              </p>

              <ol className="steps-mini">
                <li>Unzip it somewhere you will not delete by accident.</li>
                <li>
                  Open <code>chrome://extensions</code> and turn on <b>Developer mode</b>.
                </li>
                <li>
                  Click <b>Load unpacked</b> and pick the unzipped folder.
                </li>
                <li>Open a post with a contract address in it. The badge appears by itself.</li>
              </ol>
            </div>

            <div className="modal-foot">
              <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                Read the source on GitHub
              </a>
              <span>Build it yourself and you never have to trust this file.</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
