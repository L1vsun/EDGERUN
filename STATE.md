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

## Product (2026-09-20): the fly nose for Robinhood Chain

ONE page, no servers. Two halves that each stand on their own:

**1. Live token table (the useful part).** Every ERC-20 Transfer and DEX swap on the
chain, read straight from the public RPC in the visitor's browser over a rolling
3-minute window. Per token: flow/min, distinct wallets, wallets new since you opened
the page, share of flow touching one address, acceleration (last 45 s vs the window),
DEX swap count. Sortable. These are raw chain facts and need no brain.

**2. The fly's olfactory circuit scoring it.** Each token's numbers become an "odour"
across the 53 real glomeruli; the real ORN -> PN -> Kenyon -> MBON wiring turns that into
a sparse code (~5% of 5,177 Kenyon cells). Two outputs a trader can use:
- **novelty** — how unlike every activity shape already seen this session
- **smells like** — the token whose pattern is closest right now, with % code overlap

Why this works: the mushroom body is a similarity index. Published as FlyHash
(Dasgupta, Stevens & Navlakha, Science 2017); we run it on the real connectome instead
of a random matrix. It does NOT predict price — it compares patterns.

Files: `frontend/public/brain/{mb.bin.gz (1.6 MB), mb.json, flyhash.js}` (generated by
`brain/export_mb.py`), `frontend/lib/chain.ts` (RPC reader + odour encoding),
`frontend/components/Nose.tsx`, `app/{page,layout}.tsx`, `globals.css`.
Offline Python tools stay in `brain/` (`run.py`, `experiment.py`, `fly.py`, `atlas.py`,
`sim-core.js` + its Brian-derived golden test) but the SITE no longer uses them.

Verified 2026-09-20 (measured, not assumed)
- **Circuit is the real thing:** 9,515 neurons, 849,261 internal edges, 88% of their
  in-edges internal. Mean 5.7 PN inputs per Kenyon cell — biology says ~6.
- **Sparse coding works:** 259 of 5,177 KCs fire (5.0%). Unrelated inputs overlap
  0.01-0.08; a 5% perturbation still overlaps 0.96, decaying smoothly to 0.18 at full
  noise. That is the locality-sensitive property the product depends on. 0.9 ms per hash.
- **A full LIF simulation of this subnetwork does NOT work** — it saturates (69% of KCs,
  all odours identical, overlap 0.995). One glomerulus alone gives a realistic 3.8%, three
  or more ignite everything. Isolating the circuit loses the inhibition that sparsifies it.
  This is why the site uses the FlyHash formulation with explicit APL winner-take-all.
- **Live in Chrome (DevTools-driven, real chain):** page visible 252 ms, token table
  2.9 s on a throttled 5 Mbps link, total payload ~2 MB (was 37 MB). 4.5-minute session:
  heap flat at 14-22 MB, zero exceptions, acceleration spreads 0.0x-2.5x once the window
  fills (~60 s), novelty ~27 distinct values across 40 rows, habituation archive grows
  5 -> 108 shapes and decelerates. Sorting and row selection work. Checked at 1500 px and
  460 px (phone).
- **Chain supports it:** ~9 blocks/s, ~52 tx/s, 8,298 Transfer logs per 500 blocks, 336
  active tokens, 2,339 wallets/min, real V2+V3 DEX pools whose token0/token1/symbol
  resolve over plain eth_call. RPC sends `access-control-allow-origin: *`.
- Bandwidth is set by the chain, ~100 KB/s of logs while the tab is open; a poll is capped
  at 140 blocks so a slow tab samples rather than backfills. The RPC 429s on very large
  getLogs ranges (3,000 blocks failed) — stay under ~500.

**BLOCKER, still unresolved: data licence.** Third-party sources (not FlyWire's own terms;
unconfirmed) say FlyWire data is CC BY-NC 4.0 — non-commercial. The site ships
connectome-derived data and promotes a token. Resolve before launch: written permission,
drop the commercial/token framing, or change dataset. Credit to FlyWire + Dasgupta et al.
is in the footer (attribution is required either way).

Known limits: novelty depends on what the session has already seen, so it is high for
everything in the first minute; "new wallets" means new since page load, not new on chain;
acceleration needs ~60 s of window before it means anything; the 8 measurements -> 53
glomeruli mapping is our design.

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
