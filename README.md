<div align="center">

<img src="frontend/public/icon-192.png" width="88" alt="EDGERUN" />

# EDGERUN

**The post says buy. The wallet says sold.**

A browser extension that checks the token in the post you are reading: which mint it really
is, who paid for its holders, and what the poster's own wallet did with it. On X, on
Dexscreener, on a token's own page - in your own browser, on Solana and five EVM chains, with
no server on the path. It keeps the half every scanner throws away: **who put that contract in
front of you, what they did with it, and what the price did after they posted it.**

[![chains](https://img.shields.io/badge/chains-6-FF3D9A?style=flat-square&labelColor=17060F)](#the-chains-it-reads-and-what-each-is-allowed-to-claim)
[![tests](https://img.shields.io/badge/engine%20tests-37%20passing-4FD1A5?style=flat-square&labelColor=17060F)](edgerun/tests)
[![extension tests](https://img.shields.io/badge/extension%20tests-22%20suites-4FD1A5?style=flat-square&labelColor=17060F)](extension/tests)
[![backend](https://img.shields.io/badge/servers%20required-none-4FD1A5?style=flat-square&labelColor=17060F)](#no-backend-and-why-that-was-a-measurement-not-a-preference)
[![keys](https://img.shields.io/badge/keys%20held-none-4FD1A5?style=flat-square&labelColor=17060F)](SECURITY.md)
[![license](https://img.shields.io/badge/license-MIT-E8B339?style=flat-square&labelColor=17060F)](LICENSE)

`$EDGERUN` · not launched yet

</div>

---

## The problem, in numbers

Measured live on 2026-10-07, from public endpoints anyone can query:

| | |
|---:|---|
| **4** | holders of a mint calling itself `PUMP`, thirteen hours old. The `PUMP` on every curated list is a different mint, held by 311,000 wallets |
| **3,648** | other token launches attributed to the wallet behind one fresh mint. 63 of them ever reached an open pool |
| **5 of 15** | freshly listed tokens with an X link whose link was **one post**, not an account. Two more linked a community anyone can open |
| **5x** | the 24h volume a graduated token still showed on its finished bonding curve - a pool holding nothing - against the pool it actually trades in |

A ticker is not an identifier. Minting a second `$ANYTHING` costs less than lunch, and the mint
itself is clean every time: supply fixed, nothing freezable, nothing to find in the code. A
scanner that only reads the contract gives all of them a green light, because for most rugs
the contract was never the weapon.

On a chain where an issuer publishes a registry, the same thing has a harder edge. A ten-ticker
sample of one found **213** contracts using a registered stock ticker that were not the
registered contract, **6** of them named exactly like the real `NVIDIA` token, against **195**
real ones the issuer lists - every fake a structurally clean ERC-20.

**And the copy often lives on a different chain from the token it is copying.** An EVM contract
calling itself `Pump` impersonates nothing *on its own chain*, so every check that knows one
chain passes it - which is how a contract carrying the name and symbol of a $1.8bn Solana token
earned a green badge here on 2026-09-24. The token being copied does not live on the chain
being scanned. That is the whole trick, and looking harder at the bytecode never catches it.

---

## What you see

A post pastes a contract under a ticker. The badge lands under the text before you have
finished reading it:

```
  !  PUMP · Solana · caution                                           details
     The curated Solana list gives PUMP to pumpCmXq... (Pump.fun). This is a
     different mint using that symbol.
     pump.fun · 13 h old · 4 holders · top 10 hold 58%
```

Open it and you get every check, each naming what it read:

```
  ● SYMBOL ALREADY     the curated Solana list gives PUMP to pumpCmXq...9Dfn (Pump.fun).
    TAKEN              This is a different mint using that symbol.
  ● MINT AUTHORITY     revoked - the supply cannot be increased by anyone
  ● FREEZE AUTHORITY   revoked - no account can be frozen, by anyone
  ● NAME AND SYMBOL    fixed - the metadata has no update authority
  ○ TOKEN PROGRAM      Token-2022 with metadataPointer, tokenMetadata

  the launch
  ○ LAUNCHED           first traded 13 hours ago on pump.fun. It has not graduated from
                       the launchpad's own curve
  ○ HOLDERS            4 wallets hold it, and the ten largest hold 58.3% of supply -
                       Jupiter's count, not read from the chain
  ● CREATOR, MANY      Jupiter attributes this mint to 4zSh8yN2..., which it counts 112
    LAUNCHES           token launches for. That is one operator or a shared launch tool
```

The mint is clean and the answer is still *caution*, because nothing about that token's
problem is in its code. The first block was read from the chain. The second is an index's
count, drawn apart and labelled as one, and none of it can move the verdict.

Where an issuer publishes a registry, the same check is a fact rather than a list entry:

```
  ✕  $TSLA · Robinhood Chain · not the real one                        details
     This post names $TSLA, which its issuer publishes at 0x322f0929... -
     but the contract in the post is 0xd18f5e73..., a different token.

  ● STOCK TOKEN        ticker "TSLA" is an OFFICIAL Robinhood tokenised stock
                       deployed at 0x322f...3b2d - this contract is 0xd18f...7715
  ● PUBLIC BLOCKLIST   listed 2026-09-21 - holders cannot move this token
  ● EXIT TEST          simulated transfer FAILED for all 3 holders tested -
                       reverted: "blacklisted"
  ● WHAT THE DEPLOYER  called setBlacklistBatch x40, setBlacklist x7 on this token -
    DOES               47 of its last 50 transactions
```

Every line above is real output on a real contract, not an illustration.

Under the verdicts sits the part no scanner can produce - who handed it to you:

```
  @somehandle   6 accounts put this contract in your feed inside 11 minutes.
                47 contracts over 21 days, 9 flagged.
                5 of 6 priced calls are down more than half since the post. Median -83%.
                @acct_a  @acct_b  @acct_c
```

That line speaks **even when every contract in the post is clean**. Nothing is wrong with the
token; the shape of the arrival is the finding, and six accounts landing on one contract
inside eleven minutes is not six people independently noticing the same thing. The eleven
minutes are between the **posts**, not between the moments you scrolled past them.

It also says when you are reading a token's own account. A token names an X account by writing
a link into its metadata, which proves nothing - until the account holding the contract out is
the one the contract names. Then the link holds in both directions, and the strip says so.

A post that names a ticker and hands over **no contract** gets one line, when several Solana
mints answer to that ticker - which is nearly always:

```
  ?  $PUMP · Solana · 2 mints                                          details
     The listed $PUMP is pumpCm…9Dfn, held by 311,143 wallets. At least 1 other
     mint uses the same symbol, and this post gives no contract.

  !  $HASHERS · Solana · 16 mints                                      details
     At least 16 mints use $HASHERS and no list vouches for any of them. The
     most-held is 85WdpE…uxML, with 2,074 wallets. This post does not say which.
```

Quiet when a list vouches for one of them, a caution when none does - because then there is
no right answer to point at, which is exactly where somebody is standing when they go and buy
"the" token off a ticker. A currency (`$SOL`, `$USDC`) is never a line, and neither is a
ticker only one mint uses.

It stays quiet otherwise. An account with no record says nothing.

### The wallet behind the post

A launchpad mint is clean nearly every time, so the mint scan passes and has told you almost
nothing. What matters is who holds the token and who is telling you to buy it. When a public
index has a wallet on file for the account that wrote the post, a second line goes under it:

```
  WALLET  @somehandle's listed wallet bought 4m 12s before this post,
          sold 61% of it since.                                        details
```

That is the shape of the line with a placeholder account - a real one is not printed here,
because a real account next to somebody else's numbers would be an accusation. What it reads
is real: the index's holder list carries, beside some wallets, the X account it files them
under, and it lists every trade one wallet made in one token, timed. Checked before being
believed - for one such wallet the trades (bought 18,870,382, sold 14,705,362) left exactly
the balance the holder list showed (4,165,020).

Three rules keep it honest. **Only the account that wrote the mint itself** - quoting somebody
else's contract is not calling it. **Only amber in one case**: the wallet held the token when
the post went out and has sold most of that since. And **every sentence says whose record it
is**: the wallet-to-account link is the index's attribution, not something read from the post.
Most accounts have no wallet on file, and then nothing is drawn.

Every holder list the extension reads also teaches it which wallet belongs to which account,
and it keeps those pairs locally - an account that sold everything last week is in nobody's
holder list today, and that is exactly when its next post matters.

### Dig deeper: who paid for the holders, and what else the creator made

One click on a Solana row, and three more blocks land. Real output, read 2026-10-10:

```
  who paid for the holders
  ○ ONE FUNDER         3 of the largest wallets, holding 1.09% of supply between them,
                       were first funded by one address (D54q…t8VY) within 1 minute

  the creator
     32 launched     4 graduated     0 this week
     $DUCK $11k, no longer trading      $Pets $4k, no longer trading
  ○ CREATOR'S OWN      the creator wallet bought $466 of its own token and has sold none
    TRADES             of it
```

Wallets paid for by one address inside one hour are usually one holder wearing several. It
becomes a warning only at three wallets holding a twentieth of supply - and only when the
payer is **not an exchange**, because four people who all withdrew from Binance share a funder
and nothing else. That is told from the payer's own traffic, read from the chain: a thousand
signatures inside a day is a service. If that read fails, the finding is stated without
colour. A "creator" with thousands of launches is a launch service signing for its users, and
is named as one rather than blamed as one.

---

## On a profile: the whole record, and how it gets there

Open somebody's profile and a card sits under the tab bar with what that account has actually
put in front of you.

```
  EDGERUN  @somehandle
   9          47          21
   flagged    contracts   days

  5 of 6 priced calls are down more than half since the post. Median -83%.
  3 of these tokens name this account as their own X account in their metadata.
  340 ticker mentions - mostly $PUMP, $WIF, $BONK. Naming a ticker is not
  posting a contract, so this is not counted against anyone.

  TOKENA    8xu4aFUUJ1…   -86%    PASS
  TOKENB    BTQ1RdUxu5…   +19.5%  PASS

  [ read more posts ]  [ what happened after ]  [ open the record ]
```

The record only fills with posts you have actually scrolled past, which on a fresh install
means it is empty for days - so `read their recent posts` spends ten seconds scrolling their
timeline for you, with the same detection and the same attribution rules, and tells you what
it read. It asks before it starts: taking somebody's page over for ten seconds unannounced is
how a tool gets uninstalled.

**What happened after** is the price half of the record, and it is asked for rather than
automatic. Each call is priced from the close of the bar its post landed in to now, out of
public pool candles - a few calls a run, because the candle source allows very little. A post
written before a launchpad token graduated is priced on the curve it was posted on and read
against the pool it trades in today; a post older than every pool is measured from the first
trade, and says so. It describes and never marks an account: somebody warning you about a
contract has posted it too, and its price falling afterwards is them being right.

---

## The side panel

The badge answers one question about one token. The panel is what the extension
*accumulates* - click the toolbar icon, or any badge, and it opens beside the page and stays
there while you read.

```
  EDGERUN                                            ◐    clear
  ┌────────────────────────────────────────────────────────┐
  │ paste a Solana mint or a contract address     [check]  │
  └────────────────────────────────────────────────────────┘
   session 23    flagged 4    watching 6    callers 18    claims

   !  PUMP   Solana                                    CAUTION
      the curated Solana list gives PUMP to pumpCmXq… - a different mint
      5 accounts, 11 minutes
      2m ago · x.com · seen 3x

   ✕  $TSLA  Robinhood Chain                           FAIL
      simulated transfer reverted "blacklisted", 3 of 3 holders
      2m ago · dexscreener.com
```

Every row names the chain it is about - and so does every badge. The same ticker exists on
every chain and the same `0x` address exists on every EVM one, so a verdict with no chain on
it is an answer to an unstated question.

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
  calling on this token since. On Solana, **the launch**: where and when it first traded,
  whether it has graduated, how widely it is held, the wallet an index attributes it to and
  how many others that wallet has launched - every row saying whose count it is.
- **The token's own X link, checked against your feed.** Whether it points at an account, at
  one post, or at a community anyone can open - and whether that account has ever actually
  posted the contract in front of you.
- **What happened after**, per account: each call priced from its post to now.
- **Ticker collisions**, ranked by holders, reporting *contested* when there is no honest winner.
- **A watchlist that tells you what moved** - *was PASS, now FAIL* - instead of asking you to
  remember what it said last time.
- **One list, not one per tab.** You check something on X, open the contract on the explorer
  to look closer, and it is still there. The row remembers which page it came from.
- **Every token in a post, not the worst one.** A post naming three contracts gets three
  answers. Somebody who pastes three contracts is talking about three things.
- **A reply you can paste**, and a report that carries a [claim](docs/CLAIMS.md) plus the
  commands that check it.
- **A claims tab that runs somebody else's accusation.** Paste what they sent you - raw JSON,
  a quoted chat message, a fenced block from a pull request - and the evidence in it executes
  here, against the endpoints the claim names. It comes back **reproduced**, **contradicted**,
  **partial** or **unproven**, and nothing about the reporter is consulted at any point. A
  real claim ships with it, so the tab is usable before anybody has sent you one.
- **The trades**, as a second witness rather than a price readout: volume, price change and
  buys against sells at 5m / 1h / 6h / 24h, plus liquidity and pool age. Four hundred buys and
  three sells is the exit test's question asked of the money instead of the code. With it,
  what somebody has **paid** for on the token's chart page - a profile, adverts, a takeover -
  stated when the source lists it and never scored. Only a positive is shown: the same source
  listed an order for one token and returned nothing for it hours later, so its silence is
  not allowed to read as "not paid".
- **A chart**, on a **log** axis and with real OHLC candles. Log is not a preference: on a
  linear axis a pool that went 0.0002 -> 0.9 -> 0.0002 is one spike and a flat line on the
  floor, with the collapse - the part worth seeing - drawn as nothing.

---

## Verdicts, and what each is allowed to mean

| verdict | meaning |
|---|---|
| **OFFICIAL** | this address is in its issuer's published registry. A fact, not a score |
| **FAIL** | it claims an official asset and is not it, or holders provably cannot move it |
| **CAUTION** | something was found: a failing check, a warning in any lane, or a lane that resolved nothing |
| **PASS** | the full check ran and found nothing at all - no failure, no warning. On an EVM chain, only reachable at the `full` tier. On a Solana mint the badge reads **mint is clean**, because that is all it means |
| **UNRESOLVED** | nothing established yet |

An identity-clean token is **UNRESOLVED on purpose**. "Not impersonating anything" is not
"safe", and the badge must never let the first read as the second. There is no path in this
codebase from a failed request to a green badge.

### And what each *chain* is allowed to mean

On one of the six chains an issuer publishes the authoritative contract for every tokenised
security it deploys, which is what lets this say *"that is not Tesla"* as a fact. **Nothing
equivalent exists anywhere else** - not on Solana, not on Ethereum. The best available answer
there is a curated token list, and a list is a weaker instrument in both directions:

| | a chain with a registry | everywhere else |
|---|---|---|
| authority | the issuer's own registry | curated token lists |
| can say "this is not the real one" | **yes** | no |
| can say "the list gives this symbol to another address" | yes | yes |
| absence from the reference | meaningful | **proves nothing** |

Every token is unlisted on the day it launches and most legitimate ones stay unlisted forever,
so absence is reported as `unresolved` and never as a warning. Those two claims are not the
same size and the extension never renders them as though they were.

---

## The chains it reads, and what each is allowed to claim

| chain | reads | authority |
|---|---|---|
| **Solana** | the mint account in one request: mint + freeze authority, permanent delegate, transfer hooks, fees and pauses, accounts that start frozen, and the token's name from its metadata | list |
| Ethereum (1) | identity, curated lists, cross-chain name | list |
| Base (8453) | identity, curated lists, cross-chain name | list |
| Arbitrum One (42161) | identity, curated lists, cross-chain name | list |
| BNB Chain (56) | identity + lists. No Blockscout instance exists, so source, creator and holders stay unresolved rather than being faked from elsewhere | list |
| Robinhood Chain (4663) | full contract lane + an issuer's registry | **registry** |

Every endpoint is public, keyless and batched. There is no API key anywhere in this repo.

**Solana is a second provider, not another row.** A mint has no bytecode to scan, and what
replaces bytecode scanning is better than it: the powers that matter are *declared fields*.
`mintAuthority` names who can create supply out of nothing. `freezeAuthority` names who can
freeze your account at will - a blacklist that needs no code in the token at all. A
`permanentDelegate` can move tokens out of anybody's account. All of it arrives in one request.

**Who holds it, read from the chain - on request.** The RPC the mint scan uses refuses
`getTokenLargestAccounts`; of fifteen public endpoints tried on 2026-10-07, one answers it
keyless to a browser. So *dig deeper* on a Solana row reads the twenty largest accounts, who
owns each, **which program controls the owner** and whether the account is **frozen right
now**. A pool or a launchpad's curve is drawn as a program's account and counted apart, which
is the difference between "one wallet holds 58% of supply" and every launch reading "one
holder owns 80%". The total holder *count* is still an index's figure, and says so.

**An `0x` address is not a token, it is a slot number every EVM chain has.** The same forty
characters can be a stablecoin on one chain, a honeypot on another and empty on a third, and
the post that pasted it rarely says which. So the panel asks all of them at once and reports
what came back. *"USDT on Ethereum only"* ends the question; *"deployed on 3 chains under
different symbols"* starts a better one.

---

## Install

**From the site.** [edgerun.pro](https://edgerun.pro) -> *Get the extension* -> download the
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

- **When the checks are clean and the pool is a graveyard.** A token came back **PASS** - mint
  and freeze revoked, source verified, three real holders able to transfer - while being down
  **100%** with three dollars of liquidity left. Both answers were correct. A rug does not
  require a malicious contract; usually the contract is fine and a person sold all of it. So
  the price history is read as its own witness: down 90%+ from the window's high and still
  there, up 5x and all the way back, one bar doing nearly all of the damage, volume gone. Each
  is written as a **price fact and never as fraud** - plenty of honest things are down 99% -
  and none of it touches the verdict, which has to stay reproducible from chain state alone.
  What it does is refuse to let a bare PASS sit next to a chart like that unexplained.
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
  Two rules keep it honest. A ticker mention is recorded but is **never a call** - naming
  `$TSLA` is not handing anybody a contract, so mentions live in a separate field that none of
  the counts which can mark an account ever read. And an address only counts against the
  author when *they* wrote it, so quoting someone else's scam does not put it on your record. Same storage as everything
  else here: local, never uploaded, and one button in the panel forgets all of it.
- **Solana, read from the chain.** Not a chain-table row - a second provider. A Solana mint
  has no bytecode to scan, and what replaces bytecode scanning is better than it: the powers
  that matter are *declared fields*. `mintAuthority` says who can create supply out of
  nothing; `freezeAuthority` says who can freeze your account at will, which is a blacklist
  that needs no code in the token at all. Token-2022 adds more, and all of them are read: a
  **permanent delegate** (move or burn anybody's tokens), accounts that **start frozen** (you
  can be sent it and cannot move it), transfer hooks, fees, a **pause** switch, and whether
  any of those is merely unarmed with somebody still holding the key. One request reads all
  of it, and the token's name with it - a legacy mint does not know its own name, so its
  metadata account is derived locally and read in the same batch.

  The care taken here: **real USDC holds both authorities**, and PayPal's PYUSD carries a
  permanent delegate on purpose. An issuer that could not mint, freeze or recover could not
  do its job. So a power is always reported and only becomes a warning on a token nobody has
  vouched for. Two things do not soften for anyone, because they are states rather than
  powers: a token that is **paused right now**, and one that cannot be transferred at all.
- **Who already holds that symbol.** A clean mint calling itself `PUMP` is checked against
  the mints that curated lists and Jupiter's verified set already give that symbol to.
  List-grade evidence, so it is a warning that names the other mint and how many wallets hold
  it - never the word "fake".
- **Who actually holds it.** Not a count from an index: the largest accounts themselves, with
  pools and curves set aside, and each one's frozen state. Every one of the largest wallets
  frozen is the Solana form of a failed exit test, and it is read rather than simulated.
- **Bundled buys, bot holders, the creator wallet's age.** Jupiter's own token pages carry
  these; the panel repeats them on request, as *its* counts and classifications, apart from
  anything read here. Bundles that at their peak held a quarter of supply are a warning on an
  unvouched token. Nothing else in that block can be.
- **Contracts behind links.** A post that links `pump.fun/coin/…` or a Dexscreener pair page
  instead of pasting the mint is read too: the full text of every link, and a linked pair
  resolved to the token it trades.
- **Whether the token's X account is its X account.** A token claims an account by writing a
  link into its own metadata, and nothing checks the link. Of fifteen fresh tokens carrying
  one, five pointed at a single post and two at a community. The only test is the other
  direction - has that account ever posted this contract - and the only witness to that is
  the feed. So the panel says which of the two states is true, and what the link does and
  does not prove.
- **What the price did after each call.** Not a leaderboard somebody else maintains: your own
  feed, priced in your own browser from public pool candles, with the arithmetic stated. A
  call made on a bonding curve is priced on the curve; today's price comes from the pool the
  token trades in now, because a finished curve keeps its last price forever.
- **Whether it is wearing another chain's token.** An EVM contract calling itself "Pump"
  impersonates nothing *on its own chain*, so every check that only knows one chain passes it - which is how a contract carrying the name and symbol of a $1.8bn Solana
  token earned a green badge here on 2026-09-24. The token being copied does not live on the
  chain being scanned, and that is the whole trick. Curated lists cover 26 chains including
  Solana, so the check now names the real token, its chain and its address.
- **Which chain that address is actually on.** An `0x` address is not a token, it is a slot
  number every EVM chain has - the same forty characters can be a stablecoin on one chain, a
  honeypot on another and empty on a third, and the post that pasted it usually does not say
  which. So the panel asks all five at once, one batched call each. *"USDT on Ethereum only"* ends the question; *"deployed on
  3 chains under different symbols"* starts a much better one.
- **Which colliding contract people actually hold.** One chain's seven `$PEPE`s, by holder count:
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
  lib/          chains table, EVM + Solana providers, metadata-account derivation, the
                launch index, the holder read, the crowd (funders, named wallets, a wallet's
                trades, the creator's record), explorer, registry, verdict engine, curated token lists,
                blocklist, memory, deployer trail, exit-size sweep, cross-chain resolver, the
                caller graph, call outcomes, the session ledger, the claim format, the claim
                verifier, the trades reader, OHLC candles + rug detection
  shared/       address, ticker, base58 and profile detection, badge and account decisions,
                the shadow-DOM badge, the account strip, the profile card
  sites/        one thin adapter per surface (twitter, dexscreener, solana-pages, blockscout)
  sidepanel/    the side panel - the extension's main surface
  tests/        22 plain `node` suites, no dependencies: `node tests/ledger.test.mjs`
edgerun/        the original Python scan engine + CLI (37 tests)
backend/        FastAPI service - optional, not on the extension's path
docs/           what each check means, the impersonation rules, the claim format
frontend/       the site (Next.js static export) + the public blocklist
brain/          the council: five modules reading the tape, offline tools
scripts/        pack-extension.sh - builds the download and records its hash
                art/ - the brand art: the mark traced to an outline, rendered as objects,
                and built into every icon, card and picture (see scripts/art/README.md)
brand/          logo, link preview and X header, made by scripts/art
```

The extension has no build step and no dependencies. What is in the folder is what runs.

---

## The rules this was built under

- **Never a false pass.** `unresolved` is a real state and is used often.
- **No invented numbers.** No "X people watching", no fabricated stats, anywhere.
- **Every claim names its evidence** and links to the explorer so it can be checked - and
  now carries that evidence in a form the reader can re-run, rather than prose about it.
- **A source being down is never evidence.** A rate-limited endpoint does not make a claim
  false, an unreachable chart says nothing about the token, and neither is allowed to turn
  into a finding.
- **State what is not covered.** LP lock cannot be established on the EVM chain the contract
  lane runs on, and the check says exactly that instead of guessing. Every Solana figure
  says whether it was read from the chain or is an index's count.
- **A number that can accuse stays strict; a number that describes may be generous.** A price
  falling after a post, a wallet with a thousand launches, a paid chart profile: all stated,
  none of them allowed to colour a verdict or mark an account.

It is a security tool for an audience that reads Solidity and will test it within the hour.
A false accusation against a legitimate token costs more than a missing feature.

---

## Also here

The site runs a live view of Solana's five-minute tape - what is trending and what just
launched - with five modules arguing about what is moving and a code gate that stays silent
unless three separate signs line up on a token with real volume behind it. It runs in your browser too. See [`brain/README-council.md`](brain/README-council.md).

---

<div align="center">

[Site](https://edgerun.pro) · [X](https://x.com/L1vsun) · [Security](SECURITY.md) · [Roadmap](ROADMAP.md)

Circuit data: [FlyWire](https://flywire.ai) connectome (Dorkenwald et al., 2024).
Market data read live from a public index; chain data from public RPCs.

</div>
