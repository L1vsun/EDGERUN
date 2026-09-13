# edgerun — project state

Handoff snapshot. Last updated 2026-09-13.

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

## Strategic decision pending

Competitors (Sheriff Cat, GPTHEIST, bodkin, graphrun) are all the same product:
memecoin rug-checking with a mascot. Notably **Sheriff Cat is labelled "SAMPLE
DATA" on every panel — a mockup with no backend.** `crowd` is the smart one: it
asks a single sharp question ("how many wallets are actually in this launch?")
rather than shipping a kitchen sink.

We drifted into the same kitchen-sink square. **Proposed repositioning, awaiting
the user's go-ahead:**

- Stop competing as "another safety checker". Own **tokenised-stock
  authenticity** — 194 real securities on this chain, 213 counterfeits found,
  nobody guarding them. Different category, different (less degen) audience,
  defensible because it needs the registry integration.
- One sentence: **"Is that actually Tesla?"**
- Replace the chart block with a live **real-vs-counterfeit** comparison
  (official token beside a real fake we caught — near identical).
- **Reduce visual noise** (user's explicit ask): drop the marquee, calm the
  grid, fewer competing blocks. `crowd` reads confident because it's quiet.
- **Token utility:** priority scan queue is worthless (scanning is free and
  instant). The defensible offer is surveillance — *bag watch*: register what
  you hold, get alerted the moment sellability breaks or a counterfeit of a
  stock you own appears. Built on the existing watchtower. Secondary: API
  access to the registry + counterfeit feed.

Nothing of this repositioning has been built yet.

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
