<div align="center">

<img src="frontend/public/icon-192.png" width="88" alt="EDGERUN" />

# EDGERUN

**Is that the real contract? Answered before you finish reading the post.**

A browser extension for [Robinhood Chain](https://docs.robinhood.com/chain) that checks the
token in front of you - on X, on Dexscreener, on the block explorer - in your own browser,
against the chain and Robinhood's published stock-token registry.

[![chain](https://img.shields.io/badge/chain-4663-cfff04?style=flat-square&labelColor=0B0B09)](https://docs.robinhood.com/chain)
[![tests](https://img.shields.io/badge/engine%20tests-37%20passing-4FD1A5?style=flat-square&labelColor=0B0B09)](edgerun/tests)
[![extension tests](https://img.shields.io/badge/extension%20tests-passing-4FD1A5?style=flat-square&labelColor=0B0B09)](extension/tests)
[![backend](https://img.shields.io/badge/servers%20required-none-4FD1A5?style=flat-square&labelColor=0B0B09)](#no-backend-and-why-that-was-a-measurement-not-a-preference)
[![keys](https://img.shields.io/badge/keys%20held-none-4FD1A5?style=flat-square&labelColor=0B0B09)](SECURITY.md)
[![license](https://img.shields.io/badge/license-MIT-E8B339?style=flat-square&labelColor=0B0B09)](LICENSE)

`$EDGERUN` · not launched yet

</div>

---

## The problem, in numbers from this chain

| | |
|---:|---|
| **213** | contracts using an official stock ticker that are **not** the official contract, across a ten-ticker sample |
| **7** | different contracts using `$PEPE`. Six use `$HOOD`. Five use `$DOGE` |
| **6** | contracts named exactly `NVIDIA • Robinhood Token` |
| **194** | real tokenised securities Robinhood publishes addresses for |

A ticker is not an identifier here. Every one of those fakes is a structurally clean ERC-20 -
verified source, no mint function, ownership renounced - so a scanner that only reads the
contract gives all of them a green light.

---

## What you see

A post pastes a contract under a ticker. The badge lands under the text before you have
finished reading it:

```
  ✕  $TSLA · not the real one                                          details
     This post names $TSLA, which Robinhood publishes at 0x322f0929... -
     but the contract in the post is 0xd18f5e73..., a different token.
```

Open it and you get every check, each naming the number behind it:

```
  ● STOCK TOKEN        ticker "TSLA" is an OFFICIAL Robinhood tokenised stock
                       deployed at 0x322f...3b2d - this contract is 0xd18f...7715
  ● PUBLIC BLOCKLIST   listed 2026-09-21 - holders cannot move this token
  ● EXIT TEST          simulated transfer FAILED for all 3 holders tested -
                       reverted: "blacklisted"
  ● WHAT THE DEPLOYER  called setBlacklistBatch x40, setBlacklist x7 on this token -
    DOES               47 of its last 50 transactions
  ○ LP LOCK            no confirmed DEX factory on this chain and the pools seen are
                       Uniswap v4 - cannot be established, and is not being guessed at
```

Every line above is real output on a real contract, not an illustration.

---

## The side panel

The badge answers one question about one token. The panel is what the extension
*accumulates* - click the toolbar icon, or any badge, and it opens beside the page and stays
there while you read.

```
  EDGERUN                                            ◐    clear
  ┌────────────────────────────────────────────────────────┐
  │ paste a contract address                      [check]  │
  └────────────────────────────────────────────────────────┘
   session 23      flagged 4      watching 6

   ✕  $TSLA                                            FAIL
      simulated transfer reverted "blacklisted", 3 of 3 holders
      2m ago · x.com · seen 3x
```

- **The session ledger.** Everything this tab has checked, in order. Scroll a timeline for
  ten minutes and the question stops being *"is this one real"* and becomes *"what did I just
  scroll past"* - which a popover structurally cannot answer, because it dies with the post.
- **Claim against reality.** What the post said, what the address actually is, both
  addresses side by side.
- **The deployer dossier.** The wallet, what it has launched, and a table of what it has been
  calling on this token since.
- **Ticker collisions**, ranked by holders, reporting *contested* when there is no honest winner.
- **A watchlist that tells you what moved** - *was PASS, now FAIL* - instead of asking you to
  remember what it said last time.
- **A reply you can paste**, and a report that opens a prefilled blocklist issue.

---

## Verdicts, and what each is allowed to mean

| verdict | meaning |
|---|---|
| **OFFICIAL** | this address is in Robinhood's published registry. A fact, not a score |
| **FAIL** | it claims an official asset and is not it, or holders provably cannot move it |
| **CAUTION** | the contract lane found something, or resolved nothing at all |
| **PASS** | the full check ran and found nothing. Only reachable at the `full` tier |
| **UNRESOLVED** | nothing established yet |

An identity-clean token is **UNRESOLVED on purpose**. "Not impersonating anything" is not
"safe", and the badge must never let the first read as the second. There is no path in this
codebase from a failed request to a green badge.

---

## Install

**From the site.** [edgerun.live](https://edgerun.live) -> *Get the extension* -> download the
zip. The dialog carries that archive's SHA-256, so you can check the file you received before
you run it. The hash and the file are generated in the same build step and cannot drift apart.

**From here.**

```
Download this repo  ->  chrome://extensions  ->  Developer mode  ->  Load unpacked
                        pick the extension/ folder
```

No account, no API key, nothing to configure. Chrome, Brave, Edge, Arc. The side panel needs
Chrome 114 or newer.

Not in the Chrome Web Store yet, which means you can read every line before you run it.

---

## What it checks that a contract scan cannot

- **What the deployer *does*.** Not just what a wallet launched - what it has been calling on
  this token since. The fake TSLA at `0xD18F5e73…` reads perfectly clean as a contract. Its
  deployer spent **40 `setBlacklistBatch` and 7 `setBlacklist` calls on it, 47 of its last 50
  transactions**: an operator blocking buyers in bulk. No bytecode scan will ever show that.
- **How much can actually leave.** A 1-wei transfer test passes on any contract with a
  `maxTxAmount`, a sell limit, or a blacklist that only bites above a threshold - and those
  are exactly the traps that keep a chart looking alive. So the panel sweeps sizes instead of
  asserting one: 1 wei, then 1%, 10%, 50% and 100% of a real holder's *own* balance, and
  reports the size where it stops working. Three holders x five sizes is fifteen `eth_call`s
  in a single batched request. Nothing is signed, nothing is sent, no wallet is involved.
- **What you have seen before.** The extension is the only witness to your own feed, so it
  remembers: *"this was PASS when you checked it 5 days ago - it is FAIL now"*, *"you saw
  $PEPE yesterday pointing at a different contract"*. A rug is a sequence, not a single bad
  contract. Stored locally; it is never uploaded and there is nowhere for it to go.
- **Which colliding contract people actually hold.** `$PEPE`'s seven, by holder count:
  31,906 / 7,200 / 1,958 / 1,516 / 339 / 26. When one dominates it says so. When two are
  comparable, it reports **contested** rather than picking a winner.
- **A blocklist you can read.** [`frontend/public/blocklist.json`](frontend/public/blocklist.json) -
  each entry carries the evidence that put it there, and `git log` carries who added it.
  Open a PR to add one; a reproducible observation is required, not a report.

---

## No backend, and why that was a measurement, not a preference

Every check runs in the extension's service worker. The hosted API was measured first:

| | hosted backend | reading the chain directly |
|---|---|---|
| first request of the day | **31.6 s** (free-tier cold start) | - |
| one address | **14.1 s** uncached | **~200 ms** |
| five addresses | 5 requests, rate limited | **206 ms**, one round trip |
| rate limit | **12 req/min/IP** | the node's own, spent per user |
| batch endpoint | none | native JSON-RPC batching |

A badge on a scrolling feed cannot be built on the left-hand column. A service worker with
`host_permissions` is also better placed than a web page: no CORS, and no page CSP on its
requests.

---

## Repository

```
extension/      the browser extension - MV3, no build step, no dependencies
  lib/          chain RPC, explorer, registry, verdict engine, blocklist, memory,
                deployer trail, exit-size sweep, the session ledger
  shared/       address + ticker detection, the shadow-DOM badge
  sites/        one thin adapter per surface (twitter, dexscreener, blockscout)
  sidepanel/    the side panel - the extension's main surface
  tests/        plain `node` suites, no dependencies: `node tests/ledger.test.mjs`
edgerun/        the original Python scan engine + CLI (37 tests)
backend/        FastAPI service - optional, not on the extension's path
frontend/       the site (Next.js static export) + the public blocklist
brain/          the council: five modules reading the whole chain, offline tools
scripts/        pack-extension.sh - builds the download and records its hash
```

The extension has no build step and no dependencies. What is in the folder is what runs.

---

## The rules this was built under

- **Never a false pass.** `unresolved` is a real state and is used often.
- **No invented numbers.** No "X people watching", no fabricated stats, anywhere.
- **Every claim names its evidence** and links to the explorer so it can be checked.
- **State what is not covered.** LP lock cannot be established on this chain today, and the
  check says exactly that instead of guessing.

It is a security tool for an audience that reads Solidity and will test it within the hour.
A false accusation against a legitimate token costs more than a missing feature.

---

## Also here

The site runs a live view of the whole chain: five modules reading every block, arguing about
what is moving, with a code gate that stays silent unless confidence and evidence clear a
fixed bar. It runs in your browser too. See [`brain/README-council.md`](brain/README-council.md).

---

<div align="center">

[Site](https://edgerun.live) · [X](https://x.com/L1vsun) · [Security](SECURITY.md) · [Roadmap](ROADMAP.md)

Circuit data: [FlyWire](https://flywire.ai) connectome (Dorkenwald et al., 2024).
Chain data read live from the public Robinhood Chain RPC.

</div>
