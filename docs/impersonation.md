# Impersonation

## The strongest check: official stock tokens

Robinhood Chain is not a generic EVM chain. It carries **194 real tokenised
securities** — TSLA, NVDA, AAPL, SPY, GME — issued by Robinhood Assets (Jersey)
Limited as ordinary ERC-20s, and Robinhood publishes the authoritative contract
address for every one at a public endpoint:

    https://api.robinhood.com/rhj/assets      (no key, 60 req/s, 15s cache)

That makes impersonation of a stock token a **matter of fact rather than
similarity**. Everywhere else this tool says "2 edits from a token we consider
established"; here it says "the official Tesla token is 0x322F0929…, and this
contract is not it."

**Why a contract scanner cannot catch this.** A counterfeit
"Tesla • Robinhood Token" is a structurally perfect ERC-20: source verified,
ownership renounced, supply fixed, no mint, transfers work. Every code-level
check passes it, because nothing about the *code* is wrong. It is a scam purely
because of what it claims to be — a claim only the registry can falsify.

**The scale of it.** Searching ten tickers against the live chain on 2026-09-09
returned **213 contracts using an official ticker that were not the official
contract**, against 10 genuine ones. Six separate contracts were named exactly
"NVIDIA • Robinhood Token".

Three signals, in order of strength:
1. address is in the official registry -> `ok`, verified genuine
2. ticker matches an official asset but the address does not -> `fail`
3. name copies the "• Robinhood Token" convention (all 194 official tokens use
   it) without being registered -> `fail`

A fourth, corroborating only: official tokens implement ERC-8056
`uiMultiplier()` (verified — the real TSLA returns 1e18, an ordinary token
reverts). An unregistered token implementing it is a `warn`, never proof of
anything on its own, since any contract can return a number.

If the registry is unreachable the check reports `unresolved`. It must never be
possible for an upstream outage to make a counterfeit look genuine.


## Why distance, not a percentage

"73% similar" tells you nothing actionable. "1 edit from HOOD" tells you exactly what
changed and lets you check it yourself in the time it takes to read the sentence. This
tool reports plain Levenshtein edit distance (`edgerun/checks/impersonation.py`) between
a new token's ticker/name and every entry in `known_tokens.json`, and nothing fancier —
no weighting, no phonetic matching, no ML. It's a deliberately simple, auditable metric.

`max_edit_distance_flag` (default 2, in `known_tokens.json`) is the flag threshold.
Lower it and you catch fewer near-misses; raise it and you start flagging tokens that
just share a common word. Tune it against real false-positive reports.

## What the reference list actually is

`known_tokens.json` is **not an official Robinhood registry**. There is no single
canonical on-chain "$HOOD" — as of 2026-09-08, Robinhood Chain has at least five
independently-deployed, verified, actively-traded tokens all riding hood-themed
branding (GreenHood/HOOD, Good In The Hood/GOOD, Hoodrat/HOODRAT, Robin Hood/FOX, Hood
Domains/HD), none blessed by Robinhood itself. This is exactly the messy reality the
tool exists to surface, not paper over.

The reference list means: **these are established, already-deployed contracts** — real
addresses, real verification status, meaningful holder counts, pulled live from
Blockscout. Listing a token here is not an endorsement. The signal the impersonation
lane produces is: *a brand-new contract's ticker or name is suspiciously close to an
already-established one* — which protects a user from being tricked into thinking
they're buying the token they searched for, when they're actually buying a copycat,
regardless of whether the copied original is itself "official" anything.

## Maintaining the list

Add entries you've manually verified — pulled a real address off Blockscout, confirmed
it's the contract with real holders/volume you think it is. Don't auto-populate this
file from a search result or a token list without checking. A bad entry here doesn't
just miss a real impersonator — it can misdirect a flag onto an innocent, unrelated
token that happens to share a name.
