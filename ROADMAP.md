# Roadmap

Shipped in this MVP: source verification, mint/supply bytecode+source check,
ownership + dangerous-selector cross-check, impersonation edit-distance matching,
a scan cache, a live poller/feed, and a rate-limited public API.

## Holder-concentration check
Not shipped. LP can be perfectly locked while the deployer wallet holds >90% of
circulating supply across other addresses - the single biggest gap this README
calls out explicitly. Needs `GET /api/v2/tokens/{address}/holders` (paginated) plus a
concentration threshold in `known_tokens.json`. Straightforward to add; held back for
launch scope, not difficulty.

## LP lock resolution
Implemented as an explicit `unresolved` state, not wired to a live factory. Needs a
confirmed Robinhood Chain DEX factory address (`getPair(tokenA, tokenB)`) plus a
registry of known locker contracts (Team Finance-style) to check the LP token's
holder against. Set `dex.factory_address` in `known_tokens.json` once one is
confirmed - `checks/contract_safety.py::_lp_lock_check` has the extension point.

## Admin-key-change re-scan triggers
A scan is a snapshot - ownership can be transferred after a clean scan. `edgerun
watch` re-scans on new *deployments*, not on ownership-transfer events for
already-scanned contracts. A follow-up watcher on `OwnershipTransferred` logs for
every cached PASS/CAUTION contract would close this gap; not built yet.

## Solana and X: researched, not built

Each of these was looked at on 2026-10-07 while the Solana work was done. None is shipped,
and the reason is next to it.

- **Holders past the twenty largest accounts.** The largest twenty are read from the chain
  now, through the one keyless endpoint that will list them. Anything deeper - a real holder
  count, a distribution - is still an index's figure.
- **Bundled and sniped launches, measured here.** The panel repeats Jupiter's bundle count
  on request. Establishing it independently needs transaction history no keyless RPC serves
  cheaply.
- **How often an account has been renamed.** X now shows a username-change count and the date
  of the last one on an account's *About* page. It could be read when a reader opens that
  page and kept on the record; it is not, because nothing here has been checked against that
  page's markup and it must not be fetched behind X's back.
- **Contracts behind links, confirmed on X.** The code reads the full text of every link and
  resolves a linked Dexscreener pair. Whether X actually keeps a shortened URL's tail in the
  page could not be checked without a logged-in session; if it does not, the alternative is
  a request to X's tracker per post, which is not being built.
- **More token pages.** Solscan and pump.fun are wired because the mint is in the path. The
  trading terminals mostly put a pool or an internal id there instead.
- **The site's council reads an index's tape, not the chain.** It was re-pointed at Solana on
  2026-10-07: what is trending and what just launched, five minutes at a time. That is not
  every transaction, and the page says so. Reading swaps directly needs a stream no keyless
  endpoint offers a browser.
- **Deep checks on the other four EVM chains.** Identity and lists work everywhere; source,
  deployer and the exit test run on the one chain where an explorer is wired.

## What's explicitly not being built
- A numeric score. The verdict is PASS/CAUTION/FAIL plus facts, on purpose - see
  EDGERUN_README.md's "no score out of 100, no vibes."
- Novel-obfuscation bytecode detection beyond the known selector table. This is a
  cat-and-mouse problem; the honest answer is "known patterns only," documented as a
  limitation, not solved with a bigger regex.
- Any signal-service framing of $EDGERUN utility beyond scan-queue priority, the alert
  feed, and reference-list governance.
