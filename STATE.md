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

## Product (2026-09-20): a live fly brain — single page, no servers

The site is ONE page: the real adult *Drosophila* connectome (FlyWire 783, 138,639
neurons, 15.09M synapses) **simulated live in the visitor's browser** by a web
worker, driven by live Robinhood Chain blocks fetched straight from the public RPC
(CORS `*`). No backend, no Render, no API keys. The scan engine / backend / watchtower
code still exists in `edgerun/` and `backend/` but the site no longer calls it. All
other tabs, alerts, disclaimers and the old replay page were removed at the owner's
request (git history has them).

Chain -> brain (design choice, arbitrary but simple): `touch` (2,656 mechanosensory
neurons) <- tx/s x0.6 Hz (cap 60); `sweet` (129 sugar neurons) <- 60 Hz while a
contract was deployed in the last poll; `bitter` (65 bitter neurons) <- 60 Hz while a
block used >3M gas (median ~0.7M). Visitors can also hold the three buttons. Neurons are
drawn as they fire: white = sensory, chartreuse = central/optic, coral = motor/descending.

Files
- `frontend/public/brain/sim-core.js` — event-driven LIF simulator (plain JS, also runs in Node)
- `frontend/public/brain/worker.js` — loads data, runs in real time, streams spikes
- `frontend/public/brain/{connectome.bin.gz (37 MB), positions.bin, classes.bin, groups.json}`
  — generated by `brain/export_web.py` from the Shiu/FlyWire data (`brain/fetch_data.sh` first)
- `frontend/components/BrainStage.tsx` (canvas + UI), `frontend/lib/feed.ts` (RPC polling),
  `frontend/components/Header.tsx`, `frontend/app/{page,layout}.tsx`, `globals.css` (all rewritten)
- `brain/` (Python) — offline tools: `run.py` (scan replay), `experiment.py`, `export_web.py`;
  tests: `brain/.venv/bin/python -m pytest brain/test_gate.py`, `node brain/test_sim_core.js`

Verified 2026-09-20 (ran it, not assumed)
- JS simulator vs Brian2 running the paper's code: 200 ms deterministic cascade, **all 138,639
  per-neuron spike counts identical** (3,336 spikes). Noisy Poisson-driven test, 10 trials each:
  JS 6516±213 spikes / 357±9 active vs Brian 6557±195 / 362±6. Rules that mattered (found by
  diffing): Brian drops synaptic input that arrives while a neuron is refractory; a spike's
  reset wipes same-step arrivals; step order drive -> integrate -> deliver -> reset.
- Speed: parking sub-threshold neurons (max(v,g) <= threshold cannot spike without input) and
  decaying them in closed form made it ~20x faster: chain-like load costs ~0.12x real time in
  Node (heavy chain ~0.23x). Naive per-step integration was 2.7x SLOWER than real time.
- Real Chrome (headless, DevTools-driven): wakes in <2 s locally, brain time tracks wall time
  1:1, ~3.8-4.2k neurons firing, live block/tx from the real chain, zero console errors, button
  hold works. Checked at `/` and under the Pages base path `/EDGERUN/`. **Not checked:** real
  GitHub Pages delivery of the 37 MB file (worker handles both Content-Encoding cases), phones.
- Chain sample (120 blocks): ~9 blocks/s, ~52 tx/s, median 5 tx/block, median 0.72M gas/block.

**BLOCKER to resolve before pushing/launch: data licence.** Search results (third-party
pages, not FlyWire's own terms — unconfirmed) say FlyWire data is **CC BY-NC 4.0**
(non-commercial). The site now SHIPS connectome-derived data (`connectome.bin.gz` etc.) and
promotes a token; that is likely commercial use. Options: get FlyWire's written permission,
drop the token/commercial framing, or switch dataset. A one-line credit to FlyWire and
Shiu et al. is in the page footer (attribution is a licence requirement either way).

Known limits: the brain is silent with no input (LIF has no spontaneous activity); after
input stops ~8k neurons keep firing for >0.9 s in the full model (biology vs artefact not
checked); ~37 MB first load and ~200 MB RAM (mobile untested); channel mapping is ours,
not a forecast of anything.

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
