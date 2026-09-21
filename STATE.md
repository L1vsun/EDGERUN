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
