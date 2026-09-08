# Impersonation

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
