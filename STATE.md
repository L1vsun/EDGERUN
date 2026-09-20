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

- **Backend:** https://edgerun.onrender.com — healthy, poller running
- **Frontend:** https://edgerun.netlify.app (needs base dir `frontend`)
- **Pages fallback:** https://l1vsun.github.io/EDGERUN/ (needs `NEXT_PUBLIC_BASE_PATH=/EDGERUN`)
- **Repo:** https://github.com/l1vsun/edgerun

Render auto-deploys on push if enabled; **Netlify needs Base directory =
`frontend`** set in its UI (netlify.toml can't set that itself).

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

## Pivot (2026-09-20): fly-brain product — prototype in `brain/`

Product base moved from "safety checker" to a **live simulation of the real
*Drosophila* connectome reacting to Robinhood Chain**. The old "Is that actually
Tesla?" repositioning is **superseded**. User's draft (amygdala / C. elegans /
PFC / hippocampus / basal ganglia) was "just a draft" — take the good parts.

**Prototype (offline, works):** real scan events -> sensory channels -> real fly
brain + degree-preserving *shuffled* control -> rule-based read -> code gate ->
public trace. Signals only, no trading, no LLM yet.
```
brain/fetch_data.sh                       # ~135 MB into brain/data/fly/ (gitignored)
python3 -m venv brain/.venv && brain/.venv/bin/pip install -r brain/requirements.txt pytest
edgerun/.venv/bin/python brain/collect_events.py 40      # snapshot real scans (needs edgerun venv)
brain/.venv/bin/python brain/run.py       # ~40 s; writes frontend/public/brain/trace.json
brain/.venv/bin/python brain/experiment.py --trials 8   # ~1.5 min; writes .../experiment.json
cd brain && .venv/bin/python -m pytest test_gate.py -q
```
**Website:** `/brain` page (`frontend/app/brain/`, `frontend/components/BrainReplay.tsx`)
renders those two JSON files at build time — a RECORDED replay, clearly labelled
not live (the sim needs ~2 GB RAM + a compiler; Render free tier has neither).
To update the site: re-run the two scripts above, `cd frontend && npm run build`,
commit `frontend/public/brain/*.json`. Netlify rebuilds on push. View locally:
`cd frontend && npm run dev` -> http://localhost:3000/brain (only the static
build was checked: `frontend/out` served on :3311; dev mode not run).
Checked visually at 1400 px and 500 px (headless Chrome min width).
Files: `fly.py` (persistent LIF sim), `atlas.py` (annotated neuron groups),
`run.py` (pipeline + gate), `collect_events.py`, `experiment.py` (controlled input
runs), `THIRD_PARTY.md` (credits + data-licence caveat).

Verified 2026-09-20 (ran it, not assumed):
- Runs on this Mac: 138,639 neurons / 15.09M synapses, FlyWire **783**. Needs the
  compiled Brian2 backend: numpy 190 s vs cython 4.2 s per 1 s of fly time.
  First run pays ~13 s of Cython compile. Brian 2.10.1 works on Python 3.14.
- Port fidelity vs Shiu's own code, same 21 sugar neurons, 500 ms: 6.5–6.7k
  spikes / ~358 active (mine) vs 6.6–6.7k / ~360 (paper). Within ~3%.
- Annotation table (flyconnectome/flywire_annotations, supplemental file 1) is
  **release 783** and covers 138,625/138,639 sim neurons -> use 783 (the earlier
  "use v630" note is obsolete). Channels: gustatory sugar/water (129) = sweet,
  gustatory bitter (65) = bitter, mechanosensory (2,656) = jolt. Readouts: feeding
  motor (66), head motor (40), descending (1,299).
- Response is wiring-dependent: same stimulus, real brain ~8,600 active neurons,
  shuffled control ~300. Sweet 150 Hz -> feeding motor ~23 Hz (real) vs 0 (control).
- **Sticky state:** after input stops, ~8,100 neurons keep firing (descending ~4 Hz)
  for the full 900 ms measured; control dies. Not checked whether this is
  biological or a model artifact. Cycles are therefore NOT independent.
- Replay of 40 real scans: 36 PASS, 4 FAIL (all impersonation). Gate ALERTs exactly
  on the 4 FAIL cycles — by construction: brain weight is 0 in the gate.

Not verified / known limits:
- **Licence of the FlyWire data + annotations: not established** (annotation repo
  has no LICENSE; MIT covers only Shiu's code). Resolve before any token launch.
- Controlled run (`brain/experiment.py --trials 8`, sweet fixed at 120 Hz, fresh brain
  per trial, 300 ms): feeding motor 21.0±1.7 Hz alone, 17.8±1.8 with bitter 40,
  10.8±0.7 with bitter 80 (about -15% / -49%); bitter 80 alone is silent (121
  active). An earlier 5-trial run showed two brains igniting far less (active
  6.7k±3.1k) — NOT reproduced in the 8-trial rerun; treat as rare/stochastic.
  The replay's feeding dip was partly the 120 vs 160 Hz sweet difference.
- Sense->channel mapping (sweet=clear, bitter=flagged, jolt=watchtower critical)
  is a design choice, and 40 Hz/event is an arbitrary knob. `jolt` is unused: no
  watchtower diffs in a single snapshot.
- Flies have no cortex: draft's "cortical zones" = neuropils; only super_class /
  cell_class / cell_sub_class are used so far, not neuropil regions.
- No live price feed for new tokens (Open issue 3) — a market-driven amygdala has
  no input yet. Live backend DB is empty (ephemeral disk, Open issue 2), so replay
  uses its own captured snapshot in `brain/data/events.json`.

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
