# EDGERUN - build brief

## Token banner - required, above everything else

Before any product content, before the hero, before the scan box: a persistent banner
across the full width of the page, the very first thing rendered.

Contents, all visible without scrolling or clicking:
- "$EDGERUN" ticker, large and unambiguous
- the contract address, shown in full (not truncated in a way that hides characters -
  truncate visually with an ellipsis in the middle if space demands it, e.g.
  `0x1a2b...ef42`, but the copy action must copy the full untruncated address)
- a one-click copy button next to the address - click copies to clipboard, gives instant
  visual confirmation (checkmark or "copied" state for ~1.5s), no confirmation dialog,
  no extra step
- a direct link to the token's DEX/chart page (Dexscreener or the relevant RH Chain DEX
  once live - leave this as a config value, the token isn't deployed yet, so this link
  and the CA itself must be trivial to drop in from one config/env variable, not
  scattered across multiple files)

Make this element sticky (stays visible on scroll) or repeat it if a sticky header
conflicts with mobile layout - the requirement is that a visitor cannot reasonably miss
it or fail to find the address again after scrolling. Style it distinctly from the rest
of the site's dry/technical tone if needed to make it stand out - this is the one place
on the page allowed to look like a banner rather than a docs page.

The contract address must be a plain, selectable/copyable value in the actual page DOM
(not an image, not rendered only inside a script that could fail silently) - someone
pasting it into a wallet needs to trust it's the real text on the page, not something
that could silently break.

## What this is

EDGERUN is a live safety-check agent for new tokens on Robinhood Chain (Arbitrum L2,
chain ID 4663). It answers one question in under a minute: **is this contract safe to
touch, and does it impersonate something that already exists.**

Since mainnet (July 1, 2026) Robinhood Chain has taken real, documented damage from this
exact problem: fake $HOOD and $CASHCAT clones, a wallet-drainer that cost one holder
$56,000 through a poisoned contract, a Robinhood Wallet default-swap screen that
auto-populated a scam token and drained $600 in seconds, and a launchpad (Vlad.fun) that
had to halt operations over an internal integrity breach. None of this is hypothetical -
it's the documented state of the chain right now. EDGERUN is the tool that should have
existed before any of it happened.

Two checks, one verdict:

1. **Contract safety** - is liquidity locked (and until when), is supply fixed with no
   mint function reachable post-deploy, is source verified on Blockscout, does the
   contract carry a sell-tax / blacklist / pausable-transfer honeypot pattern.
2. **Impersonation** - does this token's name, ticker, or metadata resemble an
   already-established token closely enough to be mistaken for it (Levenshtein /
   token-similarity scoring against a maintained list of known legitimate RH Chain
   tokens, flagged for near-miss ticker collisions and copied branding).

Output is a single verdict, not a wall of stats: PASS / CAUTION / FAIL, with the specific
facts that produced it. No score out of 100, no vibes - three or four checkable claims a
reader can verify themselves on Blockscout in the time it takes to read them.

## Non-negotiable positioning

- This is a safety/verification tool, not investment advice, not a signal service, not a
  "buy this" indicator. Never phrase output as a buy/sell recommendation. "PASS" means
  "the structural rug vectors we check are absent," not "this will go up."
  Include a visible disclaimer on every scan result: not financial advice, verification
  only, always confirm independently.
- Never claim to catch every scam. State plainly what the checker does and does not
  cover (e.g. it cannot detect a rug where LP is legitimately locked but the team
  controls >90% of supply through unlocked wallets - flag that as a separate concern,
  don't hide the gap).
- No unverifiable superlatives ("the safest way to trade," "guaranteed protection").
  Every claim on the site must be a checkable fact about what the tool does.

## Product scope for launch (MVP, must actually work - not a mockup)

Build this as a real, functioning tool, even if coverage starts narrow. The audience
this ships to includes people who read Solidity and will test it within the hour. A
convincing fake is worse than an honest "beta, expanding coverage" - a fake gets
screenshotted and used against the project within a day.

### Core scan flow
1. User pastes a Robinhood Chain contract address (or the site auto-lists newest
   deployments it has already scanned, pulled on a poll loop).
2. Backend calls Robinhood Chain's Blockscout API (`robinhoodchain.blockscout.com` or
   the current official explorer API root - verify the live endpoint before building
   against it) to pull: contract source verification status, holder distribution, LP
   token holder/lock status if resolvable, and creation transaction / deployer wallet.
3. Static analysis pass on verified source (when available) for: mint functions callable
   post-deploy, ownership not renounced combined with dangerous functions
   (pause/blacklist/set-fee), proxy patterns that allow logic swaps after launch.
4. Impersonation pass: compare token name + ticker against a maintained reference list
   (seed it with the known real RH Chain tokens at launch - HOOD-related official
   assets, top-volume legitimate tokens - this list needs to be a config file that's
   easy to update, not hardcoded logic).
5. Verdict assembly: PASS / CAUTION / FAIL + the 3-5 facts behind it, each phrased as a
   plain, checkable claim ("LP locked until [date] in a Team Finance vault," "supply
   fixed at deploy, no mint function in verified source," "ticker is a 1-character
   edit distance from an existing token, flagged as possible impersonation").
6. Every verdict links out to the actual Blockscout page so the user can verify the
   underlying claim themselves - this is the credibility mechanism, don't skip it.

### What "coverage starts narrow" means in practice
If full static bytecode analysis for non-verified contracts is out of scope for launch,
say so in the UI ("source not verified - safety checks limited, treat as elevated risk"
is itself a valid and honest verdict, and it's also the single most useful flag this tool
can raise, since unverified source is itself the single biggest red flag pattern in the
documented RH Chain scams). Don't silently skip a check - surface what couldn't be
checked and why.

## Site structure

Single-page product site, not a marketing brochure. Tone: technical, dry, evidence-first
- closer to a security tool's docs page than a token launch page. No countdown timers,
no "to the moon" language, no stock crypto-site gradient-and-rocket aesthetic. Think
terminal/monospace-adjacent, dark, information-dense, more Vercel/Linear-style dev-tool
site than launchpad hype page.

0. **Token banner** (see section above - renders before this, not part of this list's
   scroll order, effectively position zero on the page).
1. **Hero**: one-line description of what it does (the honeypot/impersonation check, in
   plain language) + a live scan input box front and center. The product is usable from
   the hero, not hidden behind scrolling.
2. **Live feed**: a scrolling/updating list of recently scanned RH Chain tokens with
   their verdicts - this is the "wow, it's actually running" proof and the main content
   engine (new entries = something to screenshot and post, continuously, without writing
   new copy each time).
3. **How it works**: the two-check breakdown (contract safety / impersonation), written
   as plainly as the mechanism sections in good technical READMEs - name the actual
   checks performed, not marketing abstractions.
4. **What it doesn't catch**: an explicit, honest limitations section. This is a trust
   signal, not a weakness - a tool that admits its blind spots reads as built by people
   who understand the problem, not people selling a promise.
5. **$EDGERUN utility**: token holders get (a) priority/faster access to the scan queue,
   (b) access to a real-time alert feed (Telegram or on-site) for newly scanned tokens
   filtered by verdict, (c) a lightweight governance channel for submitting/voting on
   additions to the impersonation reference list and new check modules. Do not imply the
   token itself is an investment vehicle beyond this utility - keep this section as dry
   and factual as the rest of the site.
6. **Verify it yourself**: direct links to the contract address, GitHub repo, and the
   specific Blockscout queries the tool runs, so a skeptical reader can independently
   confirm the tool isn't faking output.

## Technical requirements

- Stack: your call, but the scan backend must make real API calls to Blockscout at
  request time (or on a scheduled poller for the live feed) - no hardcoded/mocked scan
  results shipped as if live.
- Cache scan results (a given contract doesn't need to be re-scanned every page load,
  but must reflect real data, refreshed on a reasonable interval e.g. every few minutes
  for LP-lock status which can change).
- The live feed needs a backend job that polls new contract deployments on RH Chain and
  runs them through the scan pipeline automatically - this is what makes the feed feel
  alive rather than manually curated.
- Rate-limit the public scan-by-address input to avoid the tool being used to hammer
  Blockscout's API into a rate-limit wall.
- Mobile-responsive - a large share of first traffic will come from Twitter on phones.

## Deliverable

A working site (scan input + live feed + static informational sections) deployed and
reachable by a public URL before the token goes live, plus the backend scan service it
calls. The GitHub repo (separate brief, README below) should contain the actual scan
logic, not just the frontend - this is what lets technical viewers verify the tool is
real by reading the code, which is the core trust mechanic the whole project depends on.
