# edgerun

[![tests](https://img.shields.io/badge/tests-15%20passing-4FD1A5?style=flat-square&labelColor=0B0B09)](edgerun/tests)
[![python](https://img.shields.io/badge/python-%E2%89%A53.10-D8DEE9?style=flat-square&labelColor=0B0B09)](https://www.python.org/)
[![deps](https://img.shields.io/badge/runtime%20deps-2-D8DEE9?style=flat-square&labelColor=0B0B09)](edgerun/pyproject.toml)
[![chain](https://img.shields.io/badge/chain-4663-D8DEE9?style=flat-square&labelColor=0B0B09)](https://docs.robinhood.com/chain)
[![keys](https://img.shields.io/badge/keys%20held-none-4FD1A5?style=flat-square&labelColor=0B0B09)](SECURITY.md)
[![license](https://img.shields.io/badge/license-MIT-E8B339?style=flat-square&labelColor=0B0B09)](LICENSE)

**$EDGERUN** · `not launched yet`

<!-- AT LAUNCH: replace the line above with, on one line:
     **$EDGERUN** · `0xTHE_CONTRACT_ADDRESS`
     and set NEXT_PUBLIC_EDGERUN_CONTRACT_ADDRESS / EDGERUN_CONTRACT_ADDRESS
     per DEPLOY.md — that's the only other place it needs to change. -->

**Check a Robinhood Chain contract before you touch it. Not a score, a verdict.**

A rug and an impersonation are two different attacks. Checking for one tells you nothing
about the other.

```bash
git clone https://github.com/<org>/edgerun.git
cd edgerun/edgerun
pip install -e .

edgerun scan 0x1a2b3c...
```

No wallet connection needed to run a scan. Read-only against Blockscout, nothing signed,
nothing custodied.

---

## Run it on a real contract

```
$ edgerun scan 0xDAA8f3f54c66E9BE2c44C1B6b566cBD07229CED3

  edgerun  0xDAA8...CED3  scanned just now

  contract
    ok    source verified on blockscout
    ok    supply fixed at deploy, no mint function in verified source
    ??    owner() call reverted or contract has no Ownable-style owner()
    ??    no DEX factory configured — set dex.factory_address in known_tokens.json

  impersonation
    ok    this address is itself the reference-list entry for this ticker

  verdict: PASS
  facts checked: 3 · unresolved: 2 · view on blockscout: robinhoodchain.blockscout.com/...
```

Two lanes, run every time, reported separately. A token can pass one and fail the other —
that split is the point. A perfectly locked, fixed-supply contract is still a scam if the
name is one character off from something real. Nothing above is a mock — this is a live
scan against a real, currently-deployed Robinhood Chain contract.

---

## What actually gets checked

**contract lane** — pulled straight from Blockscout and a live `eth_call`, nothing inferred:
- source verified, yes or no
- supply fixed at deploy vs a `mint(address,uint256)` selector reachable in bytecode
  (works even on unverified contracts — bytecode is always public)
- ownership renounced (live `owner()` read) vs held, cross-checked against a bytecode
  scan for pause/blacklist/setFee-style functions the owner could still call
- LP token holder and lock status where the pair contract resolves — locked, unlocked,
  or unresolved, with the unlock date when there is one

**impersonation lane** — checked against a maintained list of established RH Chain
tokens (`edgerun/data/known_tokens.json`, update this file, not the code):
- ticker edit-distance against every known ticker
- name similarity against every known name
- flags near-misses as a specific claim, not a fuzzy score: "1 edit from HOOD," not
  "73% similar"

Both lanes report **unresolved**, not a false pass, when the underlying data isn't there.
An unverified contract is not silently skipped — it's reported as its own condition,
because unverified source is itself the single most common trait shared by contracts
already documented as scams on this chain. See `docs/checks.md` for the exact call
behind every line, and `docs/impersonation.md` for why the reference list is "established
tokens," not an official registry — there is no single canonical on-chain "$HOOD."

---

## The live feed

`edgerun watch` polls new deployments on Robinhood Chain and runs them through both
lanes automatically — the same pipeline that backs the live feed on the website
(`backend/app/poller.py`), run continuously instead of on demand.

```
$ edgerun watch

  watching robinhood chain · poll every 45s

  14:02:11  0x4f2a...  CASHPUP        verdict: CAUTION
  14:02:56  0x88c1...  SOLARDOG       verdict: PASS
  14:03:40  0x0e9f...  H00D           verdict: FAIL
```

---

## This repo

Three parts, one scan engine:

| path         | what it is                                                              |
| ------------ | ------------------------------------------------------------------------ |
| `edgerun/`   | the scan engine + `edgerun` CLI (pip-installable, no server needed)      |
| `backend/`   | FastAPI service wrapping the same engine — REST API + live-feed poller   |
| `frontend/`  | Next.js site (scan box, live feed, docs) — static-exportable for Pages   |
| `docs/`      | exact check-by-check mechanism docs                                      |

Run everything locally or deploy it — see **[DEPLOY.md](DEPLOY.md)** for both, including
the GitHub Pages + separate backend-host split a static frontend needs.

## Config

One file you'll actually touch: `edgerun/data/known_tokens.json`.

```json
{
  "reference_tokens": [
    {"ticker": "HOOD", "name": "GreenHood", "contract": "0x...", "note": "..."}
  ],
  "thresholds": { "max_edit_distance_flag": 2, "lp_lock_warn_days_remaining": 180 },
  "rpc": { "explorer_base": "https://robinhoodchain.blockscout.com" }
}
```

`max_edit_distance_flag: 2` means anything within 2 character edits of a known ticker
gets flagged. Lower it and you catch fewer near-misses; raise it and you start flagging
tokens that just share a common word. Tune it against real false-positive reports.

---

## What this does not catch

Say this part out loud, don't bury it.

- **Team-controlled unlocked supply.** LP can be perfectly locked while the deployer
  wallet still holds 90% of circulating supply across other addresses. Not shipped —
  see `ROADMAP.md`.
- **Post-launch admin key changes.** A scan is a snapshot, not a guarantee — every
  verdict shows a scan timestamp, and `watch` re-scans on new deployments.
- **Off-chain social engineering.** Phishing, hacked accounts, fake support DMs — none
  of this is a contract-level signal.
- **Novel honeypot bytecode patterns.** Static analysis catches known selectors. A
  genuinely new obfuscation technique can slip past until the pattern is added.

A PASS verdict means: the specific, listed structural checks came back clean. It does
not mean safe in any broader sense. Read the facts, not the color.

---

## Commands

|                          |                                                          |
| ------------------------ | -------------------------------------------------------- |
| `edgerun scan <address>` | run both lanes once on one contract                       |
| `edgerun watch`          | poll new deployments continuously, scan each on arrival  |
| `edgerun verify-config`  | check `known_tokens.json` and thresholds without scanning |
| `edgerun explain`        | print what each check does and what it needs to resolve  |

## Docs

- [`docs/checks.md`](docs/checks.md) — every check, the exact Blockscout/RPC call behind it
- [`docs/impersonation.md`](docs/impersonation.md) — why edit distance, and what the
  reference list actually is
- [`ROADMAP.md`](ROADMAP.md) — holder-concentration check, LP-lock resolution, what's
  not being built and why
- [`SECURITY.md`](SECURITY.md) — scope, contract address (once deployed), reporting

---

## $EDGERUN

Token utility, kept to what it actually does:
- priority position in the scan queue during high-deployment periods
- access to the real-time verdict alert feed
- a vote on additions to `known_tokens.json` and new check modules

Not a signal service. A PASS is not a buy recommendation. Read the verdict, then read
the linked Blockscout page yourself before you decide anything.

MIT. Contract address and audit status: see [`SECURITY.md`](SECURITY.md).
