# EDGERUN browser extension — architecture spec

## What this is

A Manifest V3 browser extension that surfaces EDGERUN verdicts (LP lock status, mint
safety, impersonation score) directly inside the pages people already use to look at
Robinhood Chain tokens — Dexscreener, Blockscout, Twitter/X — instead of requiring a
separate site visit. Two features are primary for launch (build these first, fully
working). Two are secondary (structure the codebase to add them, but they can ship
after launch without blocking it).

Priority order:
1. **Inline verdict injection** on Dexscreener / Blockscout token pages — PRIMARY
2. **Twitter/X feed scanning** — inline verdict badges next to tweets mentioning a CA
   or $TICKER — PRIMARY
3. **Transaction-time interception** (wallet approval/swap warnings) — SECONDARY,
   structure for it, don't block launch on it
4. **Local-only watchlist** (no backend, direct client-side RPC calls) — SECONDARY,
   can start backend-backed and move client-side later

## Shared foundation both primary features depend on

Build this core first — both features are just different injection surfaces on top of
the same verdict pipeline.

### Verdict fetch layer
- `background` service worker owns all network calls (MV3 requires this — content
  scripts can't reliably hold long-lived state or make cross-origin calls without going
  through the background worker)
- exposes one internal message-passing API: `getVerdict(contractAddress)` →
  `{verdict: 'PASS'|'CAUTION'|'FAIL'|'UNRESOLVED', facts: string[], scannedAt: timestamp}`
- this hits the EDGERUN backend API (same scan pipeline as the site — do not duplicate
  scan logic in the extension, the extension is a client of the existing backend)
- **cache aggressively, client-side, in the background worker**: `chrome.storage.local`
  keyed by contract address, TTL a few minutes for LP-lock-sensitive data, longer for
  static facts like source-verified status. Content scripts hit the cache through the
  background worker before ever triggering a network call — a user scrolling a feed
  with 40 tickers on screen must not fire 40 simultaneous backend requests
- batch requests when a content script finds multiple addresses in one pass (e.g. a
  Twitter feed scan) — one message to the background worker with an array of addresses,
  one batched backend call if the backend supports it, otherwise sequential with a
  small concurrency cap (3-4 in flight) to avoid hammering the API or Blockscout

### Verdict badge component (shared UI, injected by both features)
A small, consistent visual unit reused everywhere verdicts appear — build it once as a
shadow-DOM web component so host-page CSS can't clobber it:
- compact form: colored dot/icon (green/yellow/red/gray for PASS/CAUTION/FAIL/UNRESOLVED)
  + ticker or truncated address
- expanded form on hover/click: the actual facts list (same content the site's scan
  result shows), a "scanned Xm ago" timestamp, a link out to the full site verdict page
- shadow DOM is mandatory here — Dexscreener and Twitter both ship aggressive global
  CSS, and a badge that breaks visually on a host-page update becomes a support burden
  and a credibility problem (looks broken = looks unmaintained = looks untrustworthy for
  a security tool specifically)

### Detecting contract addresses / tickers in arbitrary page text
Both primary features need this, write it once:
- regex for EVM address pattern (`0x[a-fA-F0-9]{40}`) applied to text nodes via a
  `MutationObserver`-driven walker, not a one-time DOM scan — both Dexscreener and
  Twitter are SPAs that continuously mutate the DOM as the user scrolls
- ticker detection (`$TICKER` pattern) is inherently ambiguous — cross-check any matched
  ticker against a locally cached list of known RH Chain tickers-to-address mappings
  (pulled from the backend periodically) before treating it as a real hit; an
  unrecognized `$TICKER` with no resolvable address should not render a badge at all,
  since a wrong badge on the wrong token is worse than no badge
- debounce the mutation observer (~200-300ms) — do not re-run the text walk on every
  single DOM mutation, batch them

---

## Feature 1 — inline verdict injection (Dexscreener / Blockscout)

### Where it renders
- **Dexscreener token page**: inject the badge next to the token name/ticker in the
  page header. Dexscreener's DOM structure changes across deploys — write the selector
  logic defensively (look for the element containing the ticker text near a recognizable
  anchor like the price display, don't hardcode a brittle class name chain) and fail
  silently (log to console, don't throw, don't show a broken badge) if the expected
  structure isn't found, rather than injecting into the wrong place
- **Blockscout contract/token page**: inject next to the contract address display and,
  separately, as a small panel near the "Read Contract" / holders section summarizing
  the same facts the badge shows on hover, since Blockscout users are already in a
  detail-reading mindset and a static panel serves them better than a hover-only badge

### Trigger flow
1. content script matches the current page against a small allowlist of URL patterns
   for Dexscreener and Blockscout RH Chain pages
2. extracts the contract address from the URL (both sites put it in the path) — this is
   more reliable than text-scanning the page for this feature specifically, since the
   page IS about one specific contract
3. requests verdict from background worker (cache-first)
4. injects badge at the identified anchor point
5. re-runs anchor detection on SPA navigation (`history.pushState` interception —
   Dexscreener is a client-side-routed SPA, a plain page-load listener will miss
   navigations between tokens)

### Failure modes to handle explicitly
- contract not yet scanned by EDGERUN backend → badge shows `UNRESOLVED — not yet
  scanned`, with a one-click "scan now" action that triggers an on-demand backend scan
  (rate-limited per user to prevent abuse)
- backend unreachable → badge shows a neutral "check unavailable" state, never a false
  PASS as a fallback — a broken check must never silently read as a clean bill of health

---

## Feature 2 — Twitter/X feed scanning

### Where it renders
- inline badge attached to each tweet's action-bar row (near reply/retweet/like icons)
  when that tweet's text or quoted content contains a detected CA or resolvable $TICKER
- one badge per tweet even if multiple addresses appear — show the worst verdict among
  them (FAIL beats CAUTION beats PASS for display priority) with the expanded view
  listing all detected tokens and their individual verdicts

### Trigger flow
1. `MutationObserver` on the timeline container watches for new tweet nodes as the user
   scrolls (Twitter virtualizes the DOM — tweets scrolled past get unmounted, tweets
   scrolled into view get (re)mounted, so this needs to handle re-processing the same
   tweet ID appearing again without double-injecting a badge)
2. tag processed tweet nodes with a data attribute (e.g. `data-edgerun-scanned="true"`)
   immediately on first sight to prevent duplicate work on remount
3. extract tweet text (including quote-tweet and linked-preview text where visible in
   DOM), run address/ticker detection
4. batch all addresses found in a scroll-triggered batch of new tweets into one
   background worker call
5. inject badges as verdicts return (they will arrive asynchronously, tweets may already
   be scrolled past by the time a slow verdict returns — inject anyway if the node is
   still in the DOM, checking via the data attribute, skip if the node was unmounted)

### Performance constraints (this is the feature most likely to visibly lag the page if
built carelessly, since Twitter's timeline is already DOM-heavy)
- never scan off-screen tweets eagerly beyond a small look-ahead buffer — use
  `IntersectionObserver` to only fully process tweets that are near the viewport, not
  every tweet that ever gets added to the DOM
- cap concurrent badge injections per scroll batch
- this feature should degrade gracefully to doing nothing rather than janking the host
  page — a security extension that makes Twitter feel slow gets uninstalled within a day
  regardless of how good the underlying checks are

### Scope guard
Only scan tweet text for addresses/tickers — do not attempt to scan images, video, or
linked external pages for this version. OCR-based ticker detection in screenshots is a
real gap (a lot of shill posts are screenshots, not text) but is a distinct, heavier
feature — note it in the repo's roadmap doc, don't build it into the MVP.

---

## Feature 3 — transaction-time interception (secondary, structure for it now)

Do not build the full implementation for launch, but make the architectural decision
now so feature 1/2 code doesn't have to be reworked later: this feature requires
injecting a script into the page's own JS context (not just the isolated content-script
world) to observe `window.ethereum` request calls, specifically watching for
`eth_sendTransaction` and `eth_signTypedData` calls with parameters matching an
`approve()` call with an unlimited allowance, or a swap whose destination token address
doesn't match the token the user believes they're swapping (cross-checked against the
page's own displayed token info).

Structure the codebase now so this slots in without a rewrite:
- keep the "verdict fetch" and "badge render" layers feature-agnostic (already true if
  built per the shared foundation above)
- add a `providers/injected.js` script path now (even if empty/stubbed) that a future
  MV3 `world: "MAIN"` content script registration can populate, since retrofitting main-
  world script injection into a content-script architecture that wasn't built with it in
  mind is the expensive part, not the interception logic itself

## Feature 4 — local-only watchlist (secondary)

Launch version: watchlist entries and scan requests go through the backend as normal.
Structure the storage layer so watchlist data lives in `chrome.storage.local` from day
one (never sync it to a backend-tied user account for launch) — this keeps the door open
to a later fully client-side RPC mode (calling Blockscout directly from the extension,
bypassing the EDGERUN backend entirely for users who want that) without a data-model
migration, even though the actual direct-RPC scan logic is post-launch work.

---

## Manifest V3 structure

```
manifest.json
  permissions: ["storage", "scripting"]
  host_permissions:
    - "https://dexscreener.com/robinhoodchain/*"   (adjust to actual RH Chain slug)
    - "https://robinhoodchain.blockscout.com/*"
    - "https://twitter.com/*"
    - "https://x.com/*"
  background: service_worker (verdict fetch, caching, backend API client)
  content_scripts:
    - matches: dexscreener + blockscout patterns
      js: [shared/detect.js, shared/badge.js, dexscreener.js]
    - matches: twitter/x patterns
      js: [shared/detect.js, shared/badge.js, twitter.js]
```

Keep `shared/detect.js` (address/ticker regex + resolution) and `shared/badge.js`
(shadow-DOM badge component) as genuinely shared modules imported by both site-specific
scripts — do not fork them per site, the whole point of the shared foundation is that
feature 1 and feature 2 are two thin adapters over one pipeline, not two separate tools.

## What "done for launch" means

Feature 1 and 2 fully working against real Dexscreener/Blockscout/Twitter DOM structure
as it exists at build time (these will drift — note in the repo README that selector
logic needs occasional maintenance as host sites update their markup, this is normal for
this category of extension, not a bug). Feature 3 and 4 scaffolded per the notes above
but not required to function. No mocked verdict data anywhere in the shipped build — if
the backend scan pipeline for a given contract isn't ready, the badge shows UNRESOLVED,
never a fabricated PASS.
