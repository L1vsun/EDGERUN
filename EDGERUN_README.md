# edgerun

**Check a Robinhood Chain contract before you touch it. Not a score, a verdict.**

A rug and an impersonation are two different attacks. Checking for one tells you nothing
about the other.

```
git clone https://github.com/<org>/edgerun.git
cd edgerun
pip install -e .

edgerun scan 0x1a2b3c...
```

No wallet connection needed to run a scan. Read-only against Blockscout, nothing signed,
nothing custodied.

---

## Run it on a real contract

```
$ edgerun scan 0x1a2b3c4d5e6f...

  edgerun  0x1a2b...ef42  scanned 4s ago

  contract
    ok    source verified on blockscout
    ok    supply fixed at deploy, no mint function in verified source
    ok    ownership renounced
    warn  LP locked until 2027-01-14, 131 days from now — not permanent

  impersonation
    fail  ticker "H00D" — 1 edit from "HOOD" (edit_distance: 1)
    fail  name "Robinhood Official" matches no verified RH Chain entity
    ref   closest known match: HOOD (0x9f...) — not the same contract

  verdict: FAIL — likely impersonation of an existing token
  facts checked: 6 · unresolved: 0 · view on blockscout: robinhoodchain.blockscout.com/address/0x1a2b...
```

Two lanes, run every time, reported separately. A token can pass one and fail the other —
that split is the point. A perfectly locked, fixed-supply contract is still a scam if the
name is one character off from something real.

---

## What actually gets checked

**contract lane** — pulled straight from Blockscout, nothing inferred:
- source verified, yes or no
- supply fixed at deploy vs a reachable mint function in the verified source
- ownership renounced vs held, cross-checked against what the owner can still call
  (pause, blacklist, set-fee — a renounced-sounding contract with a live blacklist
  function is still a trap)
- LP token holder and lock status where the pair contract resolves — locked, unlocked,
  or unresolved, with the unlock date when there is one

**impersonation lane** — checked against a maintained list of established RH Chain
tokens (`data/known_tokens.json`, update this file, not the code):
- ticker edit-distance against every known ticker
- name similarity against every known name
- flags near-misses as a specific claim, not a fuzzy score: "1 edit from HOOD," not
  "73% similar"

Both lanes report **unresolved**, not a false pass, when the underlying data isn't there.
An unverified contract is not silently skipped — it's reported as its own condition,
because unverified source is itself the single most common trait shared by contracts
already documented as scams on this chain.

```
$ edgerun scan 0x9a8b7c...

  contract
    fail  source not verified — checks below are limited

  unresolved
    ??    supply / mint — cannot inspect unverified bytecode for a mint path
    ??    LP lock — pair contract not resolvable from creation tx

  verdict: CAUTION — unverified source, treat as elevated risk until verified
```

`??` is a real state, distinct from `ok` and `fail`. A tool that turns "we don't know"
into a pass is worse than no tool.

---

## The live feed

`edgerun watch` polls new deployments on Robinhood Chain and runs them through both
lanes automatically.

```
$ edgerun watch

  watching robinhood chain · poll every 45s

  14:02:11  0x4f2a...  CASHPUP        verdict: CAUTION  (unverified source)
  14:02:56  0x88c1...  SOLARDOG       verdict: PASS     (6/6 checked, LP locked 400d)
  14:03:40  0x0e9f...  H00D           verdict: FAIL     (impersonation: HOOD, edit 1)
  14:04:02  0x77bb...  RBNHD          verdict: FAIL     (impersonation: HOOD, edit 2)
```

This is what backs the live feed on the site — same pipeline, same two lanes, run
continuously instead of on demand.

---

## Config

One file. `known_tokens.json` is the part you'll actually touch — everything else is
the check pipeline.

```
{
  "reference_tokens": [
    {"ticker": "HOOD", "name": "Robinhood", "contract": "0x9f..."},
    {"ticker": "CASHCAT", "name": "Cash Cat", "contract": "0x4a..."}
  ],
  "thresholds": {
    "max_edit_distance_flag": 2,
    "lp_lock_warn_days_remaining": 180
  },
  "rpc": {
    "explorer_base": "https://robinhoodchain.blockscout.com"
  }
}
```

`max_edit_distance_flag: 2` means anything within 2 character edits of a known ticker
gets flagged. Lower it and you catch fewer near-misses; raise it and you start flagging
tokens that just share a common word. This number is a judgment call, not a constant —
tune it against real false-positive reports, don't guess once and leave it.

---

## What this does not catch

Say this part out loud, don't bury it.

- **Team-controlled unlocked supply.** LP can be perfectly locked while the deployer
  wallet still holds 90% of circulating supply across other addresses. That's not a rug
  vector this tool's LP check sees — it needs a separate holder-concentration check,
  which is on the roadmap, not shipped.
- **Post-launch admin key changes.** A contract can look clean at scan time and have its
  owner key transferred to a new, malicious address afterward. A scan is a snapshot, not
  a guarantee — this is why every verdict shows a scan timestamp and why `watch` re-scans
  on new activity rather than caching forever.
- **Off-chain social engineering.** Phishing links, hacked accounts promoting a token,
  fake support DMs — none of this is a contract-level signal, and this tool only looks
  at the contract.
- **Novel honeypot bytecode patterns.** Static analysis catches known patterns
  (blacklist functions, pausable transfers, hidden mint). A genuinely new obfuscation
  technique can slip past until the pattern is added.

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

---

## Install

```
git clone https://github.com/<org>/edgerun.git
cd edgerun
pip install -e .
```

Python 3.10+. Needs a Robinhood Chain Blockscout endpoint reachable at request time —
set it in `known_tokens.json` under `rpc.explorer_base`, defaults to the public instance.

---

## Docs

- `docs/checks.md` — every check, the exact Blockscout call behind it, and what an
  unresolved result means for that specific check
- `docs/impersonation.md` — how the edit-distance scoring works and why it's distance,
  not a percentage
- `ROADMAP.md` — holder-concentration check, admin-key-change re-scan triggers, what's
  not being built and why

---

## $EDGERUN

Token utility, kept to what it actually does:
- priority position in the scan queue during high-deployment periods
- access to the real-time verdict alert feed
- a vote on additions to `known_tokens.json` and new check modules

Not a signal service. A PASS is not a buy recommendation. Read the verdict, then read
the linked Blockscout page yourself before you decide anything.

MIT. Contract address and audit status: see `SECURITY.md`.
