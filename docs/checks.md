# Checks

Every check below, the exact call behind it, and what an unresolved result means for
that specific check. Field names and endpoint paths were confirmed live against
`robinhoodchain.blockscout.com` on 2026-09-08 (same Blockscout version as
`eth.blockscout.com`) — not taken from general docs.

## contract lane

### source_verified
`GET /api/v2/addresses/{address}` → `is_verified` (bool), `is_contract` (bool).
If the address isn't a contract at all, every other check is skipped and this alone
determines the result. If Blockscout is unreachable (network error, non-200, or a
Cloudflare bot-challenge page instead of JSON), this is `unresolved`, not a silent pass.

### supply_mint
Primary signal: a bytecode selector scan for `mint(address,uint256)` (selector
`0x40c10f19`) against `deployed_bytecode` — pulled from
`GET /api/v2/smart-contracts/{address}` when verified, or `eth_getCode` over RPC
otherwise. This works regardless of verification status, because bytecode is always
public even when source isn't.

When source *is* verified, a secondary regex pass over `source_code` +
`additional_sources` flags any other public/external function named `*mint*` with a
non-standard signature — the selector scan above only recognizes the standard
`mint(address,uint256)` shape, so a custom-signature mint function gets a `warn`
("non-standard signature, not auto-detected, read it yourself") rather than a silent
pass.

`unresolved` only when neither source nor `eth_getCode` returns anything usable.

### ownership
`eth_call` to `owner()` (selector `0x8da5cb5b`) against
`https://rpc.mainnet.chain.robinhood.com` — a live read of chain state at scan time,
not a source-code inference. Zero address = renounced.

Cross-checked against the same bytecode selector scan used for `supply_mint`, this time
for `pause()`, `unpause()`, `blacklist(address)`, `addBlacklist(address)`,
`isBlacklisted(address)`, `setTaxFee(uint256)`, `setFee(uint256)`,
`setMaxTxAmount(uint256)`, `excludeFromFee(address)` (see `edgerun/selectors.py` for
the full table and how each selector was computed and verified).

- ownership held + dangerous selector present → `fail` (live, callable risk)
- ownership renounced + dangerous selector present → `warn` (selector presence doesn't
  prove the modifier guarding it — verify the source)
- ownership not renounced, no dangerous selector → `warn`
- ownership renounced, no dangerous selector → `ok`
- `owner()` reverts (contract may not implement Ownable) → `unresolved`, unless a
  dangerous selector is present anyway, in which case it's a `warn` — we can't tell you
  who can call it, but we can tell you it exists

### lp_lock
Unresolved until `dex.factory_address` is set in `known_tokens.json` — see
`ROADMAP.md` for why this isn't wired to a live factory yet.

## impersonation lane

See `docs/impersonation.md`.
