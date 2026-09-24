<div align="center">

<img src="frontend/public/icon-192.png" width="88" alt="EDGERUN" />

# EDGERUN

**Is that the real contract? Answered before you finish reading the post.**

A browser extension that checks whether the token in front of you is the contract it claims to
be - on X, on Dexscreener, on the block explorer - in your own browser, against six chains,
with no server on the path. It also keeps the half every scanner throws away: **who put that
contract in front of you.**

[![chains](https://img.shields.io/badge/chains-6-cfff04?style=flat-square&labelColor=0B0B09)](#the-chains-it-reads-and-what-each-is-allowed-to-claim)
[![tests](https://img.shields.io/badge/engine%20tests-37%20passing-4FD1A5?style=flat-square&labelColor=0B0B09)](edgerun/tests)
[![extension tests](https://img.shields.io/badge/extension%20tests-12%20suites-4FD1A5?style=flat-square&labelColor=0B0B09)](extension/tests)
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

**And the copy usually lives on a different chain from the token it is copying.** A contract on
Robinhood Chain calling itself `Pump` impersonates nothing *on Robinhood Chain*, so every check
that knows one chain passes it - which is how a contract carrying the name and symbol of a
$1.8bn Solana token earned a green badge here on 2026-09-24. The token being copied does not
live on the chain being scanned. That is the whole trick, and looking harder at the bytecode
never catches it.

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
   session 23    flagged 4    watching 6    callers 18

   ✕  $TSLA  Robinhood Chain                           FAIL
      simulated transfer reverted "blacklisted", 3 of 3 holders
      5 accounts, 11 minutes
      2m ago · x.com · seen 3x

   ●  PUMP   Solana                                    PASS
      mint and freeze authority both revoked
      2m ago · x.com
```

Every row names the chain it is about. The same address exists on every EVM chain, so a
verdict with no chain on it is an answer to an unstated question.

- **The session ledger.** Everything checked this session, in order, across every tab. Scroll
  a timeline for ten minutes and the question stops being *"is this one real"* and becomes
  *"what did I just scroll past"* - which a popover structurally cannot answer, because it
  dies with the post. Each row remembers which page it came from, so walking from X to the
  explorer to look closer adds to the list instead of replacing it.
- **Who put it in front of you.** Every contract arrived attached to an account, and the
  panel keeps that half too: who posted it, who posted it *first*, and whether several
  accounts arrived on the same contract inside the same few minutes.
- **Claim against reality.** What the post said, what the address actually is, both
  addresses side by side.
- **The deployer dossier.** The wallet, what it has launched, and a table of what it has been
  calling on this token since.
- **Ticker collisions**, ranked by holders, reporting *contested* when there is no honest winner.
- **A watchlist that tells you what moved** - *was PASS, now FAIL* - instead of asking you to
  remember what it said last time.
- **One list, not one per tab.** You check something on X, open the contract on the explorer
  to look closer, and it is still there. The row remembers which page it came from.
- **Every token in a post, not the worst one.** A post naming three contracts gets three
  answers. Somebody who pastes three contracts is talking about three things.
- **A reply you can paste**, and a report that carries a [claim](docs/CLAIMS.md) plus the
  commands that check it.

---

## Verdicts, and what each is allowed to mean

| verdict | meaning |
|---|---|
| **OFFICIAL** | this address is in Robinhood's published registry. A fact, not a score |
| **FAIL** | it claims an official asset and is not it, or holders provably cannot move it |
| **CAUTION** | something was found: a failing check, a warning in any lane, or a lane that resolved nothing |
| **PASS** | the full check ran and found nothing at all - no failure, no warning. Only reachable at the `full` tier |
| **UNRESOLVED** | nothing established yet |

An identity-clean token is **UNRESOLVED on purpose**. "Not impersonating anything" is not
"safe", and the badge must never let the first read as the second. There is no path in this
codebase from a failed request to a green badge.

### And what each *chain* is allowed to mean

Robinhood publishes the authoritative contract for all 194 of its tokenised securities, which
is what lets this say *"that is not Tesla"* as a fact. **Nothing equivalent exists on Ethereum,
Base, Arbitrum or BNB Chain.** The best available answer there is a curated token list, and a
list is a weaker instrument in both directions:

| | Robinhood Chain | everywhere else |
|---|---|---|
| authority | the issuer's own registry | curated token lists |
| can say "this is not the real one" | **yes** | no |
| can say "the list disagrees about this symbol" | yes | yes |
| absence from the reference | meaningful | **proves nothing** |

Every token is unlisted on the day it launches and most legitimate ones stay unlisted forever,
so absence is reported as `unresolved` and never as a warning. Those two claims are not the
same size and the extension never renders them as though they were.

---

## The chains it reads, and what each is allowed to claim

| chain | reads | authority |
|---|---|---|
| **Robinhood Chain** (4663) | full contract lane + the issuer's registry | **registry** |
| Ethereum (1) | identity, curated lists, cross-chain name | list |
| Base (8453) | identity, curated lists, cross-chain name | list |
| Arbitrum One (42161) | identity, curated lists, cross-chain name | list |
| BNB Chain (56) | identity + lists. No Blockscout instance exists, so source, creator and holders stay unresolved rather than being faked from elsewhere | list |
| **Solana** | mint + freeze authority, transfer hooks, transfer fees, Token-2022 metadata | list |

Every endpoint is public, keyless and batched. There is no API key anywhere in this repo.

**Solana is a second provider, not another row.** A mint has no bytecode to scan, and what
replaces bytecode scanning is better than it: the powers that matter are *declared fields*.
`mintAuthority` names who can create supply out of nothing. `freezeAuthority` names who can
freeze your account at will - a blacklist that needs no code in the token at all.

**An `0x` address is not a token, it is a slot number every EVM chain has.** The same forty
characters can be a stablecoin on one chain, a honeypot on another and empty on a third, and
the post that pasted it rarely says which. So the panel asks all of them at once and reports
what came back. *"USDT on Ethereum only"* ends the question; *"deployed on 3 chains under
different symbols"* starts a better one.

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
- **Who has been handing you contracts.** A scanner sees a contract. Only the browser
  scrolling the feed sees who was holding it. Every address is recorded against the account
  that posted it, so the panel can answer *"this account has put 47 contracts in front of
  you in three weeks and nine of them failed"*, and *"this one arrived from six accounts
  inside eleven minutes"* - which is not six people independently noticing the same thing.
  Two rules keep it honest: a ticker mention is never a call (naming `$TSLA` is not handing
  you a contract), and an address only counts against the author when *they* wrote it, so
  quoting someone else's scam does not put it on your record. Same storage as everything
  else here: local, never uploaded, and one button in the panel forgets all of it.
- **Solana, read from the chain.** Not a chain-table row - a second provider. A Solana mint
  has no bytecode to scan, and what replaces bytecode scanning is better than it: the two
  powers that matter are *declared fields*. `mintAuthority` says who can create supply out of
  nothing; `freezeAuthority` says who can freeze your account at will, which is a blacklist
  that needs no code in the token at all. Token-2022 adds transfer hooks (arbitrary code on
  every transfer, which can reject it) and transfer fees. One call reads all of it.

  The care taken here: **real USDC holds both authorities**, because an issuer that could not
  mint or freeze could not do its job. So an authority is always reported and only becomes a
  warning on a token nobody has vouched for. Flagging the largest stablecoin on Solana would
  discredit the tool in one screenshot.
- **Whether it is wearing another chain's token.** A contract on Robinhood Chain calling
  itself "Pump" impersonates nothing *on Robinhood Chain*, so every check that only knows one
  chain passes it - which is how a contract carrying the name and symbol of a $1.8bn Solana
  token earned a green badge here on 2026-09-24. The token being copied does not live on the
  chain being scanned, and that is the whole trick. Curated lists cover 26 chains including
  Solana, so the check now names the real token, its chain and its address.
- **Which chain that address is actually on.** An `0x` address is not a token, it is a slot
  number every EVM chain has - the same forty characters can be a stablecoin on one chain, a
  honeypot on another and empty on a third, and the post that pasted it usually does not say
  which. So the panel asks all of them at once: Robinhood Chain, Ethereum, Base, Arbitrum and
  BNB Chain, one batched call each. *"USDT on Ethereum only"* ends the question; *"deployed on
  3 chains under different symbols"* starts a much better one.
- **Which colliding contract people actually hold.** `$PEPE`'s seven, by holder count:
  31,906 / 7,200 / 1,958 / 1,516 / 339 / 26. When one dominates it says so. When two are
  comparable, it reports **contested** rather than picking a winner.
- **Claims you can execute.** Every entry carries its evidence as *commands plus expected
  results*, not prose, so a claim can print the steps that check it and you never have to take
  anyone's word for it. Two rules: evidence must be runnable, and an accusation must establish
  both sides - "this is not the real TSLA" is uncheckable unless it also shows, reproducibly,
  what the real TSLA is. Format in [docs/CLAIMS.md](docs/CLAIMS.md).
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
  lib/          chains table, EVM + Solana providers, explorer, registry, verdict engine,
                curated token lists, blocklist, memory, deployer trail, exit-size sweep,
                cross-chain resolver, the caller graph, the session ledger, the claim format
  shared/       address, ticker and base58 detection, badge decisions, the shadow-DOM badge
  sites/        one thin adapter per surface (twitter, dexscreener, blockscout)
  sidepanel/    the side panel - the extension's main surface
  tests/        12 plain `node` suites, no dependencies: `node tests/ledger.test.mjs`
edgerun/        the original Python scan engine + CLI (37 tests)
backend/        FastAPI service - optional, not on the extension's path
docs/           what each check means, the impersonation rules, the claim format
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
