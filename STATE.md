# edgerun — project state

Handoff snapshot. Last updated 2026-09-20.

---

## What this is

A contract safety + impersonation checker for **Robinhood Chain (Arbitrum Orbit
L2, chain ID 4663)**, plus the `$EDGERUN` token site around it.

Three deployables, one scan engine:

| path | what | where it runs |
|---|---|---|
| `edgerun/` | scan engine + `edgerun` CLI (pip package) | anywhere |
| `backend/` | FastAPI: REST API, poller, watchtower, share receipts | **Render** |
| `frontend/` | Next.js static export | **Netlify** (+ GitHub Pages as fallback) |

## Live deployments

- **Backend:** https://edgerun.onrender.com — still running, but the site no longer calls it
- **Frontend (primary since 2026-09-20): GitHub Pages** https://l1vsun.github.io/EDGERUN/
  via `.github/workflows/deploy-pages.yml` (Settings -> Pages -> Source: GitHub Actions).
  Repo *Variables*: `NEXT_PUBLIC_API_BASE`, `NEXT_PUBLIC_BASE_PATH=/EDGERUN` (exact
  case — `/edgerun/` 404s), `NEXT_PUBLIC_SITE_URL=https://l1vsun.github.io` (origin
  only; without it og:image pointed at the dead Netlify host — workflow fixed, variable
  must be set by the owner). Deploys only on pushes touching `frontend/**` or the
  workflow file; Pages caches ~10 min. `/brain/` is live there.
- **Netlify: free trial ended — do not rely on it** (was https://edgerun.netlify.app).
- **Pages CORS:** backend returned `access-control-allow-origin: https://l1vsun.github.io`
  (checked 2026-09-20), so the site can call it.
- **Repo:** https://github.com/l1vsun/edgerun

Render auto-deploys on push if enabled (a redeploy wipes its SQLite DB — open issue 2).

---

## Checks implemented

**Contract lane** — `edgerun/checks/contract_safety.py`
1. `source_verified` — Blockscout `is_verified`
2. `supply_mint` — bytecode selector scan for `mint(address,uint256)` + source regex
3. `ownership` — live `eth_call owner()` cross-checked against dangerous selectors
4. `lp_lock` — always `unresolved` (no confirmed RH Chain DEX factory address)
5. **`exit_test`** — simulates a real `transfer()` from top holders via `eth_call`

**Impersonation lane** — `edgerun/checks/impersonation.py`
- **stock-token authenticity** (the strongest check — see below)
- Levenshtein ticker/name distance vs `data/known_tokens.json`

**Watchtower** — `backend/app/watchtower.py`: re-scans known contracts and
records diffs (sellability lost, ownership re-acquired, mint appeared).

Also: deployer reputation index, shareable OG receipts (`/s/<addr>`, `/og/<addr>.png`).

---

## Verified technical facts (do not re-derive)

All confirmed live against the chain, not assumed:

- **Blockscout needs a `Referer` header.** Cloudflare returns 403 to requests
  without it — a User-Agent alone is NOT enough. This silently emptied the live
  feed once. See `blockscout.py::_browser_headers`.
- **New tokens have no price.** Blockscout `exchange_rate` is null for freshly
  deployed tokens (verified on 4 real ones); only aggregator-listed assets
  (LINK, CBBTC) have prices. `holders_count` IS populated from block one.
  Consequence: the price chart cannot work at launch. The chart auto-switches
  to the holders series.
- **Blockscout has no price history endpoint** (`/price-history` → 404). The
  backend records its own samples; history cannot be backfilled.
- **`eth_call` supports a `from` address** and returns structured revert data,
  which is what makes the exit test possible. State override (3rd param) was
  not needed. `eth_createAccessList` is unavailable.
- **Official stock registry:** `https://api.robinhood.com/rhj/assets` — public,
  no key, returns 194 tokenised securities deployed on chain 4663 with
  authoritative contract addresses. All named `"<Company> • Robinhood Token"`.
- **ERC-8056 fingerprint:** `uiMultiplier()` = `0xa60bf13d`. Real TSLA returns
  1e18; an ordinary meme token reverts.
- **Counterfeits are rampant:** a 10-ticker sample found **213 contracts using
  an official ticker that were not the official contract**, vs 10 genuine. Six
  contracts named exactly `"NVIDIA • Robinhood Token"`.
- Official TSLA: `0x322F0929c4625eD5bAd873c95208D54E1c003b2d`

## Bugs found and fixed (don't reintroduce)

- Exit test accused legitimate tokens (1INCH, SHRUB) of a "targeted blacklist"
  when the revert actually said *insufficient balance* — Blockscout's holder
  list is cached. Fixed by reading `balanceOf` live before simulating, plus
  string-level benign-revert matching. False positives went 5/45 → 0/100.
- Impersonation flagged `AI` as 2 edits from `HD`. Edit distance now scales
  with length (`shorter // 2`).
- Verdict returned PASS when the contract lane resolved *nothing* (explorer
  down). All-unresolved now → CAUTION.
- Filter buttons all rendered chartreuse: `.scanbox button` (0,1,1) overrode
  `.btn` (0,1,0). Now `.feed-controls` + `.chip`.
- Headline highlight overlapped across wrapped lines — a plain `background`
  paints the 1.32em inline content box, taller than the line advance. Fixed
  with an explicitly sized gradient band.
- Logo assets exported nearly invisible: faint background noise in the source
  art gave every pixel non-zero alpha, so `getbbox()` never trimmed. Fixed by
  flooring alpha below 25%.
- OG image resolved to `http://localhost:3000` — social cards never unfurled.
  Fixed with `metadataBase` / `NEXT_PUBLIC_SITE_URL`.

## Tests

`edgerun/tests/` 37 passing · `backend/tests/` 7 passing. Run:

```
cd edgerun  && .venv/bin/python -m pytest tests/ -q
cd backend  && PYTHONPATH=. .venv/bin/python -m pytest tests/ -q
```

---

## Open issues

1. **Registry has no disk cache — live vulnerability.** `api.robinhood.com` was
   timing out on 2026-09-13 (worked hours earlier). When it's unreachable the
   stock check degrades to `unresolved`, so our strongest feature goes dark.
   Needs an on-disk cache of the last known-good registry. **Do this first.**
2. **Render free tier has an ephemeral disk.** The SQLite DB — chart history,
   deployer index, watchtower events — is wiped on every deploy and on
   spin-down. Needs a persistent disk or external Postgres to accumulate.
3. **No Pons DEX factory/router address** for chain 4663. Blocks both the LP
   lock check and a real day-one price chart (pool reserves).
4. `lockup-chartreuse.png` is generated but currently unused.

---

## Launch (see LAUNCH.md)

Set the contract address in **two** places, redeploy both:
- Render env: `EDGERUN_CONTRACT_ADDRESS` (starts the price sampler)
- Netlify env: `NEXT_PUBLIC_EDGERUN_CONTRACT_ADDRESS` **then trigger a deploy**
  (baked in at build time)

Buy links auto-resolve to `https://www.ponsfamily.com/launchpad/<address>`.

---

## Product (2026-09-21): the fly nose for Robinhood Chain

ONE page, no servers. A trader should get the answer in a second and be able to act.

**What you can DO**
- **Paste any token address -> "smell it".** One address-filtered `eth_getLogs` pulls that
  token's own last ~17 minutes (9,000 blocks, ~0.9 s) and returns flags + what it moves
  like. Works for tokens not in the live list. Bad input fails with a plain message.
- **Star any token.** Persists in `localStorage` (wrapped in try/catch), pins it to the top
  of the table, and raises a toast the moment it picks up a flag it did not have before.
- **Drag the brain.** Click a row or an alert card to send that token through the circuit.

**What you SEE in one glance** — flags, not metrics. Each is a plain threshold on measured
activity and names the number behind it:
- `one wallet` (bad) — one address touches >90% of transfers: a single actor, not a crowd
- `printing` (bad) — >=4 mints from 0x0, >3x the burns: net new supply, not wrapper churn
- `heating` (good) — flow >=2x the token's own 3-min average in the last 45 s
- `fresh wallets` (good) — >65% of wallets never seen before (needs >=20 wallets)
- `dex live` (good) — >=3 real DEX swaps: there is a pool and it trades
- `cooling` / `just appeared` (neutral)
Default sort is "worth a look" (flag severity x how much is moving), not raw volume.

**The brain** is the full-bleed background and is meant to read as a brain, not a point
cloud. Three layers in one shared anatomical space:
1. `shell.bin.gz` — 26,000 neurons of the REST of the fly brain (151 KB), the silhouette
2. ~2,600 real synapses of the olfactory circuit as a faint web (short edges only: long
   ones cross the whole brain and turn it into a scribble)
3. the circuit's 9,515 neurons, lighting up as each token is smelled
Every token in the window sends its own wave, staggered across the poll, so it is always
firing with real traffic. The focused token's PN->KC lines are real connectome synapses.

**Mascot:** `components/Fly.tsx` — an SVG fly with beating wings; it turns red and beats
faster when a watched token trips a flag. Headline is "The fly knows which one stinks."

Files: `frontend/public/brain/{mb.bin.gz 1.66 MB, mb.json, flyhash.js}` (from
`brain/export_mb.py`), `frontend/components/{BrainCanvas,Nose}.tsx`, `frontend/lib/chain.ts`,
`app/{page,layout}.tsx`, `globals.css`. Offline research tools stay in `brain/`, unused by
the site.

Verified 2026-09-21 (measured in a real browser against the live chain)
- Circuit: 9,515 neurons, 849,261 internal edges, 88% of in-edges internal, mean 5.7 PN
  inputs per Kenyon cell (biology ~6), 53 real glomeruli. Sparse code 259/5,177 = 5.0%;
  unrelated inputs overlap 0.01-0.08, a 5% perturbation still overlaps 0.96. 0.9 ms/hash.
- **A full LIF sim of this subnetwork does NOT work** — saturates at 69% of KCs, all odours
  identical (0.995). Isolating the circuit loses the inhibition that sparsifies it; hence
  FlyHash with explicit APL winner-take-all.
- Rendering 60 fps at 1600x1050 and at 500 px with the whole brain + web drawn; heap 20-27 MB;
  zero console exceptions. Draw calls are batched (shell by depth band, resting neurons by
  layer) — doing it per-point cost 26,000 fillStyle changes a frame and dropped it to 48 fps.
  Frames 260 ms apart differ substantially, so the animation is data-driven.
- Load: visible ~250 ms, table ~2.9 s on throttled 5 Mbps, ~2 MB total (was 37 MB).
- Scan tested live: SPCX returned 1,898 transfers / 193 wallets over 17 min; `hello`
  returned "that is not a contract address"; star persisted to localStorage and pinned.
- **FlyWire coords are 4x4x40 nm voxels** — z must be scaled x10 or the brain renders flat.
- Signal thresholds were tuned against live data, not guessed: WETH first tripped `printing`
  (wrappers mint on every deposit -> now requires net issuance), `no dex` fired on nearly
  everything (most tokens have no pool -> inverted to `dex live`), and the one-wallet share
  was reported at half its true value (concentration counts two wallet slots per transfer).
- A failed poll now keeps the last good numbers on screen and shows "reconnecting" instead
  of blanking the ticker to zeros.
- Chain: ~9 blocks/s, ~52 tx/s, 8,298 Transfer logs / 500 blocks, ~336 active tokens. RPC
  sends `access-control-allow-origin: *`; it 429s on large unfiltered getLogs (3,000 blocks
  failed) but address-filtered queries over 9,000 blocks are fine. ~100 KB/s while open.

## Design language + modules in the brain (2026-09-21)

**The council modules now live inside the specimen.** Each is anchored to the neurons that
actually do that job, not to an arbitrary spot:

    SCOUT      antennal lobe (ORN)    sensory in
    SKEPTIC    lateral horn + APL     innate valence
    HISTORIAN  mushroom body (KC)     the fly's real memory
    SYNTHESIS  MBON + DAN             where that computation converges
    GATE       projection neurons     output

They fire in sequence on a 2.1 s relay; the anchored neurons light up as each takes its
turn, and the firing card shows that region's **actual line from the latest council round**
(`council.json` is fetched and keyed by region id). Labels sit in the margin as a numbered
stack with SVG leader lines to the moving anatomy — the lab-plate convention. Placing them
at the structures directly was tried first and failed: KC/MBON/LH centroids are close
together, so the text piled up.

**Design language: instrument, not dashboard.** Graph-paper ground, cold graphite instead
of black, chartreuse kept only as the signal colour, `RESTRICTED` stamp, specimen rail
(`SPECIMEN / PREP / FEED / SIGNAL`), corner registration marks, tick rules top and bottom,
a scale caption under the specimen, monospace labels throughout, hard edges and no blur
except the instrument panels. Deliberately avoids the generic dark-gradient-and-glow look.

Rendering still 60 fps at 1600x1050 and at 500 px, heap ~21 MB, zero console errors. The
module stack is hidden below 1080 px (leader lines have nowhere to go on a phone).

## Site pass: header, install guide, typography (2026-09-21)

- **Header** carries nav (Install / How it works / The council), X and GitHub icon links
  (`X_URL`, `GITHUB_USER_URL` in `lib/config.ts`) and a "Get the extension" button. It was
  otherwise empty apart from the logo.
- **`GITHUB_REPO_URL` now defaults to `https://github.com/L1vsun/EDGERUN`** instead of `""`,
  which is why the hero CTA was linking to `#`. `EXTENSION_URL` is the single place the
  download link comes from.
- **`components/Install.tsx`** - three install steps plus what happens on each surface, placed
  on the front page rather than behind a route. The user asked for less friction, and making
  somebody navigate to find out how to run it is the friction.
- **The hero says what it covers**: X, Dexscreener, Blockscout, and paste-an-address. It read
  as an X-only tool before.
- **Demo fix**: the "checking" state was a full-width white bar with two words in it, which
  read as a broken element. It is a compact pill with a spinner now (193 px, verified in a
  live frame).
- Demo handle changed from a plausible-looking one to `@someaccount` - the mock post accuses
  its author of shilling a honeypot, and that should not land on a name anyone could hold.
- **All em/en dashes replaced with `-`** across site, extension, Python engine, council
  prompts and the published round data: 205 + 125 in source, plus JSON `—` escapes in
  `council.json`, `council_log.json` and the extension manifest name (grep missed those
  because Python's `json.dump` escapes non-ASCII by default). The one deliberate exception is
  `normalizeName`'s character class in `lib/registry.js`, which must keep `-–—` to fold
  "Tesla – Robinhood Token" onto the official "Tesla • Robinhood Token" - verified still equal
  across all three forms. `edgerun/tests` 37 passing afterwards; page renders 0 long dashes.

## Extension: the four things a contract scan cannot do (2026-09-21)

Built on top of the base extension, all verified live:

- **Deployer behaviour** (`lib/deployer.js`). The creator field is usually a launchpad
  factory; the human is whoever signed the creation transaction. But the stronger signal
  turned out to be *what that wallet calls on the token afterwards*: the fake TSLA's deployer
  spent **40 `setBlacklistBatch` + 7 `setBlacklist` calls on its own token, 47 of its last 50
  transactions**. The contract reads clean. The wallet does not. The official TSLA's deployer
  shows nothing, correctly. On demand, ~4 explorer requests, cached an hour.
- **Local memory** (`lib/memory.js`). Every address and ticker the extension has shown you,
  with notes when the story changes: verdict flips ("was PASS 5 days ago, FAIL now") and
  ticker migration ("you saw $PEPE yesterday pointing at a different contract"). Recorded on
  fresh scans only, so a cached read cannot inflate the counts. Pruned at 4,000 addresses.
- **Ranking a ticker collision** (`rankCandidates`). $PEPE's seven contracts by holders:
  31,906 / 7,200 / 1,958 / 1,516 / 339 / 26 → reported as **contested**, because 31.9k vs 7.2k
  is only 4.4x and the threshold for a clear winner is 5x. It does not pick when the data
  does not.
- **Public blocklist** (`frontend/public/blocklist.json` + `lib/blocklist.js`). Fetched hourly
  from Pages; each entry carries its evidence and `git log` carries its provenance. Seeded
  with the two verified honeypots. Needs `https://l1vsun.github.io/*` host permission — added.
- **Copy proof** — a pasteable reply with the claim, the real contract, two measured facts and
  the explorer link.

**Blocklist is not live until the next push** — the extension fetches
`https://l1vsun.github.io/EDGERUN/blocklist.json`, which 404s until Pages deploys it. Until
then the listing check simply does not appear (a missing list contributes nothing; it never
turns into a pass).

Icons regenerated from `brand/logo.png`: the mark occupied 43% of the tile with a large
chartreuse margin, which is why it looked tiny at 16px. Now cropped to the mark and re-rendered
at 86% fill for every size (extension 16/48/128, site 192/512/apple-touch/favicon, and the
transparent mark-* assets).

## The browser extension (2026-09-21) — `extension/`

MV3 extension that puts a verdict next to the token on X, Dexscreener and Blockscout. Full
notes in `extension/README.md`; the decisions that matter here:

**It does not use the backend.** The spec in `EDGERUN_extension_architecture.md` had the
extension as "a client of the existing backend". Measured that backend live before building:
cold start **31.6 s**, warm uncached scan **14.1 s**, rate limit **12/min/IP**, no batch
endpoint — and it does not return the stock-token check at all on the canonical TSLA (a
forced, uncached scan shows only the Levenshtein check; `/api/impersonators` 404s although it
exists in `main.py`, so **the Render deploy is stale**). Reading the chain directly instead:
~200 ms for one address, **206 ms for five batched**. The service worker owns every request,
so there is no CORS and no page CSP either.

**Two tiers.** `identity` (registry + reference list, one batched RPC for up to 12 addresses)
badges a whole timeline; `full` (source, mint selectors, ownership, LP lock, live exit test)
runs on token pages and on click, ~6.5–8 s, explorer-bound.

**Five verdict states, not four.** OFFICIAL / FAIL / CAUTION / PASS / UNRESOLVED. An
identity-clean token is UNRESOLVED on purpose — "not impersonating anything" is not "safe",
and only the full tier can reach PASS. No path exists from a failed request to a green badge.

**The killer feature is the cross-check**, not PASS/FAIL: a post saying $TSLA next to a
contract that is not Robinhood's TSLA address is naming one token and linking another. Comes
free from the registry. A bare `$TICKER` is only ever answered from the registry — on this
chain a ticker maps to many contracts, so anything not official gets no badge at all.

Live findings while testing (real contracts, not fixtures): `0xD18F5e73…` (symbol TSLA, name
"memestock") is a **honeypot** — simulated transfer reverted `"blacklisted"` for all three
live holders. `0x066aD1C8…`, named exactly "Tesla • Robinhood Token", blocks some holders and
not others: a targeted blacklist.

Verified: the engine against real contracts; the real content scripts against a timeline with
X's DOM contract; the Blockscout surface on the **live explorer** (badge in the `h1`, one
panel, seven checks, no console errors); pair resolution for both a v3 pair address and a v4
pool id. **Not verified:** the Dexscreener DOM (Cloudflare challenges headless Chrome, so the
symbol anchor was tested on a harness), the `declarativeNetRequest` Referer rule as applied by
Chrome (the 403-without/200-with requirement is verified; Chrome 153 no longer honours
`--load-extension`, so it was never exercised inside a loaded extension), and X's real
timeline.

Chain facts this depends on: Dexscreener's slug is **`robinhood`** (`robinhoodchain` and
`rhchain` both return `[]`) and its URLs carry the **pair**, not the token — some of which are
Uniswap v4 pool ids (32 bytes). That also means LP lock cannot be checked the v2/v3 way here;
the check reports `unresolved` and says why rather than guessing.

## The council runs in the browser now (2026-09-21)

The page no longer just reads a JSON file written half an hour ago. `frontend/lib/council.ts`
is a TS port of `brain/council_rules.py` — same four seats, same thresholds, same gate — and
it runs **on every poll, in the visitor's tab, on the numbers already on screen**.
`frontend/components/Cortex.tsx` is the board it draws:

- five modules relay in execution order (620 ms each, `RELAY_STEP` in `lib/council.ts`), with a
  read-head sweep on the seat that holds the floor and a packet crossing the wire to the next
- **the same clock drives the anatomy**: `relay.current.at` is passed into `BrainCanvas`, so the
  region behind each seat lights as that seat speaks. The old free-running 2.1 s cycle is the
  fallback when no relay ref is passed
- each seat draws its own working: Scout a per-round sparkline of chain flow, Skeptic a split bar
  (trap / clean / too small to judge), Historian a tick row of how many rounds it remembers,
  Synthesis a confidence meter with the 0.55 gate bar marked, Gate the SPEAK/SILENCE history strip
- clickable: a seat expands to "what it saw" (job, what it is allowed to read, what it consumed);
  a symbol inside a line focuses that token in the specimen; a SPEAK verdict offers "pull its
  paper trail", which runs the scanner + OSINT dossier on the named address
- the Historian's log is real and persists in `localStorage` (`edgerun.rounds`, last 40). It says
  "none yet" until it has 3 rounds and reports precedent only from rounds this browser logged.
- honesty: the badge reads `RULES · IN THIS TAB`, and `components/Council.tsx` (retitled "The
  published round") still shows the scheduled off-page round. Nothing claims a model wrote this.

Supporting change: `TokenStat.pools` (distinct DEX pools a token appears in) is now computed in
`lib/chain.ts`, which is how Synthesis skips quote assets client-side — same rule the Python
snapshot uses.

**Fly branding removed** (the user's call: "not meta"). `components/Fly.tsx` and its CSS are gone,
the headline is "Five modules read every block.", the rail reads CIRCUIT / COUNCIL / FEED, the
specimen caption says CONNECTOME 783, page + OG titles no longer say "fly brain", and "smell it"
is "run it". The FlyWire citation stays in the footer — it is attribution, not branding.

**Bug fixed while verifying:** the live table's `<thead>` had 10 cells against 11 body cells, so
every numeric header was shifted one column left (flow/min sat over wallets, and so on). A `flags`
header was missing.

Verified 2026-09-21 in headless Chrome against the live chain: rounds run on every poll, the relay
lights the matching anatomy mid-flight (captured at stage 2, Skeptic firing), the Historian returned
real precedent once the log passed 3 rounds ("WETH carried the same flags at 2,212/min and its flow
held to 1,956/min over 13 rounds"), zero console errors, no horizontal overflow at 390 px, and
`npm run build` passes. Not verified: many hours of accumulated log, and the reduced-motion path
(CSS only, code-reviewed).

## OSINT: the paper trail (2026-09-21)

`frontend/lib/osint.ts` + the dossier block under a scan result. Public records only,
straight from the block explorer, **no key and no backend** — it sends
`access-control-allow-origin: *`, so the browser asks it directly. It is the same trail
anyone can click through by hand; this just follows it in one go.

What it establishes for any address:
- **the real deployer, not the factory.** Most tokens here are launched through a
  launchpad, so `creator_address_hash` is the factory. The wallet that signed the
  *creation transaction* is the human — that is the one followed.
- **what else that wallet has launched**, with the date span. Verified live: SPCX's
  deployer `0x5516B3…E000` has launched **at least 50 contracts** through the same factory
  between 2026-07-27 and 2026-09-09 — "a production line, not a project".
- **who paid for the gas** (earliest inbound transfers), which is the thread that leads to
  an operator's other wallets.
- verification status, whether the code is factory boilerplate, the explorer's own
  `is_scam` / `reputation` fields, and any non-boilerplate URLs published in the source.

Measured / learned:
- Blockscout **403s a request with no `Referer` at all**; any value satisfies it
  (blockscout, github.io and localhost all return 200). Browsers attach one automatically
  and scripts are forbidden from setting it, so nothing needs doing client-side — but the
  Python/server path must set one.
- Rate limit is **150 per window** (`x-ratelimit-limit`), and a dossier spends ~5. So it
  runs **on demand only** (on a scan), never for all 40 table rows, and results are cached.
- The transaction-list endpoints are slow (a full dossier takes ~15-25 s), so the panel
  **fills progressively** via an `onPartial` callback. It deliberately does not state the
  factory verdict before the creation transaction is read — an earlier version claimed
  "not stamped out by a factory" during the partial phase and then corrected itself.

**Not built, and why:** reading X/Twitter for "who posted this CA". The X API is paid and
cannot be called from a static page, and scraping it breaks their terms. The clean route
is a research region in the council using Claude's `web_search` server tool, which runs
server-side where the key already lives — that is a v2 item, not a v1 gap.

## The council (2026-09-21): four regions, two versions

The "cortical structures as agents" idea. Four regions with different jobs and different
slices of the data, then a CODE gate that decides whether to say anything:

    SCOUT      sensory cortex          the chain numbers      -> what is happening
    SKEPTIC    inhibitory prefrontal   numbers + Scout        -> why it is a trap
    HISTORIAN  hippocampus             numbers + the run log  -> what followed before
    SYNTHESIS  association cortex      all three              -> one call + confidence
    GATE       basal ganglia           code, not a model      -> SPEAK or SILENCE

**Two interchangeable versions, one schema, one gate:**
- **v1 `--rules`** (`brain/council_rules.py`) — each region decides by rule. No API key,
  no cost, real live chain data. This is what ships at launch. It is NOT a mock of v2: it
  is the deterministic version of the same pipeline, and every sentence is computed from a
  number measured on-chain seconds earlier.
- **v2 live** (`brain/council.py` + `brain/council/cortex_*.md`) — the same four seats, each
  an `claude-opus-5` call with its own prompt. Flip with one repo variable.

The page states which version produced the round (`mode` in the JSON, a badge in the UI).
It never implies a model wrote rule output — the site's whole pitch is calling out faked
activity, so faking the reasoning would be the same sin and is trivially checkable.

`.github/workflows/council.yml` runs `--rules` every 30 min for free. To go live: add
`ANTHROPIC_API_KEY` as an Actions secret and set repo variable `COUNCIL_MODE=live`.
Needs Settings -> Actions -> Workflow permissions = read and write (it commits the round).

Verified 2026-09-21 against the live chain
- `python brain/council.py --rules` produces a real round end to end, writes
  `frontend/public/brain/council.json`, appends to `brain/council_log.json`, costs $0.
- The panel renders all four regions + the gate in Chrome; build passes.
- **Quote-asset detection:** a token on 2+ different pools is what everything is priced
  against (WETH, USDG detected automatically) and is excluded from being the focus —
  without it Synthesis just picked WETH every round, which is plumbing, not a call.
- The Historian does real precedent matching over `council_log.json` (flag-set overlap,
  then what that token's flow actually did after) and correctly returns "none yet" while
  the log is short. The log is the only thing that compounds — commit it.
- The gate frequently says SILENCE. That is the design, not a bug.
- **NOT verified: a live (model) round.** No `ANTHROPIC_API_KEY` and no `ant` CLI in this
  environment, so no region has ever been run by a model. Cost estimate for v2 stands at
  ~$0.10-0.15/round, unmeasured.
- **RPC blocks bot User-Agents** (403 on Python's default). `chain_snapshot.py` sets one
  that passes, but Actions runs from datacenter IPs — run the workflow by hand once first.

## Launch robustness — measured 2026-09-21

Everything below is measured against the live chain, not estimated.

**Per visitor, after the hardening in `lib/chain.ts`:** ~0.43 RPC requests/s and
**~5.6 KB/s** of wire traffic (Chrome DevTools protocol accounting, 75 s sample).
Earlier "48 KB/s" figures were wrong: they came from a Python probe that did not send
`Accept-Encoding`. **The RPC gzips ~12.7x** (636 KB -> 50 KB on a 100-block getLogs), so
the browser pays a fraction of the raw size.

**What the public RPC tolerates:** 12 simultaneous getLogs served in 0.6 s, no errors.
Not probed harder on purpose — it is someone else's endpoint. It **429s on very large
ranges** (a 3,000-block getLogs failed; stay under ~500) and **403s bot User-Agents**
(Python's default `Python-urllib/*` is blocked; `curl/*`, a browser UA, and
`edgerun-council/1.0` all pass). That last one matters for the scheduled council runner —
`chain_snapshot.py` sets a UA that works, but GitHub Actions runs from datacenter IPs and
Cloudflare may judge those differently; **run the workflow manually once before trusting
the cron.**

**Extrapolated concurrency** (linear in visitors, since each browser pulls the whole log
stream independently): 100 concurrent ~= 43 req/s and 0.6 MB/s; 1,000 ~= 430 req/s and
5.6 MB/s; 10,000 ~= 4,300 req/s and 56 MB/s. There is no SLA and no recourse on that
endpoint, and every visitor fails at the same moment if it throttles by origin.

**GitHub Pages:** ~2 MB per first visit (mb.bin.gz 1.65 MB + shell 151 KB + JS/fonts).
Pages' soft bandwidth limit is ~100 GB/month, so roughly **50,000 first visits/month**
before GitHub throttles. A viral launch day can exceed that alone.

Hardening already applied to `lib/chain.ts`: 9 s poll (was 5 s) with 35% jitter so a crowd
does not synchronise, swap logs only every 4th cycle, `MAX_BLOCKS` 200 cap, exponential
backoff to 90 s on failure, hidden tabs drop to 60 s, instant catch-up on refocus, and the
last good numbers stay on screen during an outage. **Not verified: the hidden-tab path** —
Chrome's visibility override no longer takes in headless, so that branch is code-reviewed
only. Polling less often does NOT cut bytes proportionally (the same blocks are covered
either way); only sampling, or a shared snapshot, does.

**BLOCKER, still unresolved: data licence.** Third-party sources (not FlyWire's own terms;
unconfirmed) say FlyWire data is CC BY-NC 4.0 — non-commercial. The site ships
connectome-derived data and promotes a token. Resolve before launch: written permission,
drop the commercial/token framing, or change dataset. Raised four times, not yet decided.

Known limits: novelty is session-relative (everything looks novel in the first minute);
"new wallets" means new since page load; acceleration needs ~60 s of window; a manual scan
cannot show `dex live` because it does not count swaps; the 8 measurements -> 53 glomeruli
mapping is our design, not biology.

---

## Working notes

- Commit messages follow the user's `updateN` / short-description style.
  **Do not add Co-Authored-By trailers** — the user asked for them removed
  from the public repo.
- The user pushes; don't push for them unless asked.
- Brand source art lives in `brand/`, generated web assets in `frontend/public/`.
- Honesty rules that shaped this codebase: never a false pass, `unresolved` is
  a real state, no invented numbers in the UI, no fabricated "X people
  watching" filler.
