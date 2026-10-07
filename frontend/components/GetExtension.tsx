"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ChromeLink from "./ChromeLink";
import {
  EXTENSION_KB,
  EXTENSION_SHA256,
  EXTENSION_VERSION,
  EXTENSION_ZIP,
  GITHUB_REPO_URL,
} from "@/lib/config";

// The download dialog.
//
// Kept to one screen and one decision. Someone opening this wants the file and the three
// steps after it - everything else is reassurance they did not ask for yet, so the safety
// claims are four chips rather than four paragraphs, and the hash lives behind a disclosure
// for the minority who will actually check it. It stays available because handing out a zip
// with nothing to verify it against is not something a security tool should do.

type Props = {
  className?: string;
  children?: React.ReactNode;
};

export default function GetExtension({ className = "cta", children = "Get the extension" }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // whether the file has actually been asked for - the "what next" half waits for it
  const [got, setGot] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setCopied(false);
    setGot(false);
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
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
              <a className="dl" href={EXTENSION_ZIP} download onClick={() => setGot(true)}>
                Download v{EXTENSION_VERSION}
                <span>{EXTENSION_KB} KB</span>
              </a>

              <ol className={`steps-mini${got ? " live" : ""}`}>
                <li>Unzip the folder</li>
                <li>
                  Open <ChromeLink /> and turn on <b>Developer mode</b>
                </li>
                <li>
                  Click <b>Load unpacked</b> and pick that folder
                </li>
              </ol>

              <p className="modal-lead">
                Not in the Chrome Web Store yet, so it loads as an unpacked folder. Takes about a minute.
              </p>

              {/* Appears only once the file is actually on its way. Before that it is three
                  more things to read in a dialog whose one job is handing over a download;
                  after it, it is the only thing on screen worth reading - because installing
                  is the easy half and nobody arrives knowing what the thing does. */}
              {got && (
                <div className="after" role="status">
                  <b>Once it loads, three things to try</b>
                  <ol>
                    <li>
                      <b>Open X and scroll.</b> Posts naming a contract get a strip under them.
                      A post that only names a ticker gets one line saying how many mints share it.
                    </li>
                    <li>
                      <b>Open somebody&rsquo;s profile.</b> A card shows what they have put in
                      front of you and how it turned out. It starts empty &mdash; one button
                      fills it. No server has this; only your browser was there.
                    </li>
                    <li>
                      <b>Open the claims tab and hit &ldquo;try an example&rdquo;.</b> It runs a
                      real accusation against the chain in front of you, so believing it never
                      means believing the reporter.
                    </li>
                  </ol>
                </div>
              )}

              <ul className="chips">
                <li>no wallet</li>
                <li>no account</li>
                <li>no server</li>
                <li>4 sites only</li>
              </ul>

              <details className="verify">
                <summary>Verify this download</summary>
                <div className="hashline">
                  <code>{EXTENSION_SHA256}</code>
                  <button type="button" onClick={copyHash}>
                    {copied ? "copied" : "copy"}
                  </button>
                </div>
                <p className="hashnote">
                  Run <code>shasum -a 256</code> on the file you got. If it does not match, do not install it.
                </p>
              </details>
            </div>

            <div className="modal-foot">
              <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                Source on GitHub
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
