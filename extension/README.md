# edgerun — browser extension

Puts a verdict next to the token wherever you already look at it: a post on X, a Dexscreener
pair, a Blockscout page. The question it answers first is the one that actually costs people
money on this chain — **is this the contract it says it is?**

## Install (unpacked)

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → pick this folder.
2. Open any post on X mentioning a Robinhood Chain token, or a Blockscout token page.

Chrome 137+ ignores `--load-extension` from the command line unless
`--disable-features=DisableLoadExtensionCommandLineSwitch` is also passed; loading from the
Extensions page is unaffected.

## Architecture: there is no backend

Every check runs in the extension's service worker, against the chain and Robinhood's own
published registry. The hosted edgerun backend is deliberately **not** in the path. Measured
against it on 2026-09-21:

| | measured |
|---|---|
| cold start (`/api/health`, Render free tier) | **31.6 s** |
| warm uncached scan (`/api/scan/<addr>?force=true`) | **14.1 s** |
| rate limit | **12 requests/minute/IP** |
| batch endpoint | none |
| the stock-token check on the canonical TSLA | **absent from the response** (the deployed build is stale — `/api/impersonators` 404s too, though it exists in `main.py`) |

A badge on a scrolling feed cannot be built on those numbers. Reading the chain directly
instead, the same work takes:

| | measured |
|---|---|
| one address, identity tier | **~200 ms** |
| five addresses, batched | **~206 ms total** (one HTTP round trip) |
| one address, full check | **~6.5–8 s** (explorer latency dominates) |

A service worker with `host_permissions` is also in a *better* position than a web page: no
CORS, and no page CSP on its requests.

## Two tiers

| tier | what it runs | cost | used by |
|---|---|---|---|
| `identity` | the registry + the reference list | one batched RPC call for up to 12 addresses | the X timeline |
| `full` | identity + source verification, mint selectors, ownership, LP lock, and a simulated transfer out of a live holder's wallet | ~2 explorer + ~3 RPC calls | token pages, the popup, "run full check" |

## Verdicts, and what each is allowed to mean

- **OFFICIAL** — this address is in Robinhood's published registry. A fact, not a score.
- **FAIL** — it claims an official asset and is not it, or holders provably cannot move it.
- **CAUTION** — the contract lane found something, or resolved nothing at all.
- **PASS** — the full check ran and found nothing. Only reachable at the `full` tier.
- **UNRESOLVED** — nothing established yet. An identity-clean token lands here *on purpose*:
  "not impersonating anything" is not "safe", and the badge must never let the first read as
  the second.

There is no path from a failed request to a green badge. A broken upstream is always
UNRESOLVED.

## Why a `$TICKER` alone is only ever answered from the registry

On this chain a ticker maps to many contracts — a ten-ticker sweep found 213 using an
official ticker that were not the official contract. So a bare `$TICKER` is resolved against
Robinhood's registry and nothing else: if it is an official stock ticker the badge names the
one true address, and if it is not, no badge is drawn. Picking one of 213 candidates would be
inventing an answer.

The strongest thing here is the cross-check: a post that says **$TSLA** and pastes a contract
that is not Robinhood's TSLA address is showing you a different token than the one it names.
That is provable from the registry alone.

## Design

Light, on purpose. This sits on other people's pages — X in dark mode, Dexscreener's near
black, Blockscout's grey — and a dark chip on a dark page is something you have to go looking
for. A bright card reads instantly against all three, and the status colour lands before any
text is read.

- **On X the badge is a strip under the post text**, not a chip in the action bar. The action
  bar is cramped, low-contrast and off the eye's path; a warning about a fake contract belongs
  in the reading flow where it cannot be scrolled past.
- **Only a fake gets full volume** — red fill, a two-pulse ring on arrival, then still. Clean
  and unverified results are quieter cards. If everything shouted, nothing would.
- **The panel is parented to the document root**, not to the badge. X puts `transform` on
  timeline containers, and `position: fixed` inside a transformed ancestor resolves against
  that ancestor rather than the viewport — which is why the panel used to open half off the
  right edge. It is now positioned from the badge's own rect, clamped to the viewport, flips
  above the badge when there is no room below, follows on scroll, and closes once its badge
  leaves the screen.
- **Fonts are declared on the inner elements**, not just `:host`. A page's own rules outrank
  `:host` rules on the host element, so the host page's font leaks in through inheritance.

## Layout

```
manifest.json            MV3
rules/referer.json       puts a Referer on explorer calls (see below)
background/worker.js     the only code that touches the network
lib/chain.js             batched JSON-RPC, ABI decoding
lib/blockscout.js        explorer v2
lib/registry.js          Robinhood's stock-token registry, cached an hour
lib/verdict.js           the checks and the verdict assembly
lib/selectors.js         4-byte selectors, revert tables
lib/known.js             the maintained reference list
lib/budget.js            per-upstream spend caps
shared/detect.js         address/ticker detection, DOM watching, messaging
shared/badge.js          the shadow-DOM badge
sites/{twitter,dexscreener,blockscout}.js
providers/injected.js    inert — see "transaction interception"
popup/                   paste-an-address + the local watchlist
```

**Blockscout needs a `Referer`.** It 403s a request that carries none (verified: 403 without,
200 with). A service worker's `fetch` sends none and scripts are forbidden from setting that
header, so `rules/referer.json` puts one back via `declarativeNetRequest`. If that rule ever
stops applying, every explorer call returns 403 — which surfaces as UNRESOLVED, never as a
pass.

**Budgets are counted in HTTP requests, not calls.** A JSON-RPC batch of 48 `eth_call`s is one
request. Caps live in `lib/budget.js` and are held in `chrome.storage.session` so an MV3
worker restart cannot hand out a fresh allowance mid-window. They sit well under the
explorer's own 150-per-window, because that limit is now spent from the user's IP.

## Selector drift is normal maintenance

Host pages change their markup. Two defences, both deliberate:

- **Blockscout** — the address comes from the URL; the badge waits for the real `h1` rather
  than grabbing whatever exists at `document_idle`.
- **Dexscreener** — the URL carries the *pair*, not the token (and on this chain some are
  Uniswap v4 pool ids, 32 bytes, not addresses), so the pair is resolved first. The anchor is
  then found by looking for the token's **own ticker** in the top of the page, not by a
  class-name chain — Dexscreener's classes are hashed and change across deploys.

If no anchor is found, the badge goes in a floating panel of its own. Injecting a security
badge into the wrong row is worse than putting it in an obvious corner.

## Transaction interception (feature 3) is scaffolded, not built

`providers/injected.js` exists so the wiring decision is already made: it is the only script
that would ever run in the page's own JS world (`world: "MAIN"`), and nothing else depends on
being there. Two things must be settled before it does anything:

1. **EIP-6963.** Patching `window.ethereum` is no longer enough — wallets announce themselves
   through `eip6963:announceProvider` and a page may use a provider that never touches
   `window.ethereum`.
2. **Trust.** Wrapping a wallet provider is mechanically what a drainer does. Observe only;
   never modify `params`, never delay or block a call, never touch a signature payload.

## Verified, and not

Verified live on 2026-09-21 against Robinhood Chain:

- The engine, run outside a browser against real contracts: official TSLA → OFFICIAL; two
  real clones → FAIL with the official address named. One of them
  (`0xD18F5e73…`, symbol TSLA, name "memestock") is a **honeypot**: the simulated transfer
  reverted `"blacklisted"` for all three live holders. The other (`0x066aD1C8…`, named exactly
  "Tesla • Robinhood Token") blocks *some* holders and not others — a targeted blacklist.
- The real content scripts driven against a timeline with X's DOM contract: four badges, the
  cross-check message correct, the fifth post (no tokens) correctly left alone.
- The panel against a harness with the same transformed ancestors X uses: opens fully on
  screen (`left 126 → right 526` in a 1200px viewport), follows the badge on scroll
  (`top 183 → 33` after 150px), and hides once the badge scrolls away.
- The Blockscout surface on the **live explorer**: badge in the `h1`, one panel, all seven
  checks rendered, no console errors.
- Pair resolution through the real worker for both a v3 pair address and a v4 pool id.

Not verified:

- **The Dexscreener DOM.** The site serves a Cloudflare challenge to headless Chrome, so the
  symbol anchor was tested against a header harness, not the real page. Check it by hand.
- **The `declarativeNetRequest` Referer rule as applied by Chrome.** The requirement is
  verified (403 without, 200 with) and the rule is written for it, but Chrome 153 no longer
  honours `--load-extension`, so it was not exercised in a loaded extension. Load the folder
  by hand and open a token page: if the explorer checks read "the explorer blocked this
  request", that rule is the thing to look at.
- Anything on X's real timeline, for the same reason — the DOM contract it depends on
  (`article[data-testid="tweet"]`, `[data-testid="tweetText"]`, `[role="group"]`) is stable
  and widely relied on, but it was exercised against a harness.
