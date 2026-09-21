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

## What's explicitly not being built
- A numeric score. The verdict is PASS/CAUTION/FAIL plus facts, on purpose - see
  EDGERUN_README.md's "no score out of 100, no vibes."
- Novel-obfuscation bytecode detection beyond the known selector table. This is a
  cat-and-mouse problem; the honest answer is "known patterns only," documented as a
  limitation, not solved with a bigger regex.
- Any signal-service framing of $EDGERUN utility beyond scan-queue priority, the alert
  feed, and reference-list governance.
