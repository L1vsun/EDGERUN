# Checks

> Scope: the EVM contract lane - source, mint, ownership, LP, exit test - as run by the Python
> engine and by the extension on the chain where an explorer and an issuer's registry are
> wired. The Solana mint scan is documented in [`extension/README.md`](../extension/README.md#solana).

Every check below, the exact call behind it, and what an unresolved result means for
that specific check. Field names and endpoint paths were confirmed live against
`robinhoodchain.blockscout.com` on 2026-09-08 (same Blockscout version as
`eth.blockscout.com`) - not taken from general docs.

## Reaching the explorer

Blockscout sits behind Cloudflare bot protection. A `User-Agent` alone is not
enough: verified 2026-09-08, dropping the `Referer` header turns a working 200
into a 403 on every endpoint, which silently empties the live feed. The client
sends a full browser XHR header set (`edgerun/blockscout.py::_browser_headers`)
and reports a 403 as its own error rather than a generic failure.

## contract lane

### source_verified
`GET /api/v2/addresses/{address}` → `is_verified` (bool), `is_contract` (bool).
If the address isn't a contract at all, every other check is skipped and this alone
determines the result. If Blockscout is unreachable (network error, non-200, or a
Cloudflare bot-challenge page instead of JSON), this is `unresolved`, not a silent pass.

### supply_mint
Primary signal: a bytecode selector scan for `mint(address,uint256)` (selector
`0x40c10f19`) against `deployed_bytecode` - pulled from
`GET /api/v2/smart-contracts/{address}` when verified, or `eth_getCode` over RPC
otherwise. This works regardless of verification status, because bytecode is always
public even when source isn't.

When source *is* verified, a secondary regex pass over `source_code` +
`additional_sources` flags any other public/external function named `*mint*` with a
non-standard signature - the selector scan above only recognizes the standard
`mint(address,uint256)` shape, so a custom-signature mint function gets a `warn`
("non-standard signature, not auto-detected, read it yourself") rather than a silent
pass.

`unresolved` only when neither source nor `eth_getCode` returns anything usable.

### ownership
`eth_call` to `owner()` (selector `0x8da5cb5b`) against
`https://rpc.mainnet.chain.robinhood.com` - a live read of chain state at scan time,
not a source-code inference. Zero address = renounced.

Cross-checked against the same bytecode selector scan used for `supply_mint`, this time
for `pause()`, `unpause()`, `blacklist(address)`, `addBlacklist(address)`,
`isBlacklisted(address)`, `setTaxFee(uint256)`, `setFee(uint256)`,
`setMaxTxAmount(uint256)`, `excludeFromFee(address)` (see `edgerun/selectors.py` for
the full table and how each selector was computed and verified).

- ownership held + dangerous selector present → `fail` (live, callable risk)
- ownership renounced + dangerous selector present → `warn` (selector presence doesn't
  prove the modifier guarding it - verify the source)
- ownership not renounced, no dangerous selector → `warn`
- ownership renounced, no dangerous selector → `ok`
- `owner()` reverts (contract may not implement Ownable) → `unresolved`, unless a
  dangerous selector is present anyway, in which case it's a `warn` - we can't tell you
  who can call it, but we can tell you it exists

### exit_test  - the one check that executes rather than inspects
`eth_call` a real `transfer(address,uint256)` of 1 wei from each of the top
holders (`GET /api/v2/tokens/{address}/holders`) to the burn sink. Nothing is
broadcast or signed; `eth_call` runs it against current state and discards it.

Before simulating, the holder's balance is read live with `balanceOf` over RPC.
This matters: Blockscout's holder list is a cached snapshot, and without the
live read a holder who has since sold produces an "insufficient balance" revert
that looks identical to a restriction. A 45-token live run with that bug
accused 1INCH and SHRUB of running a "targeted blacklist"; the live balance
read plus string-level benign-revert matching took the false-positive rate from
5/45 to 0/100.

- all tested holders can transfer -> `ok`
- some can, some cannot -> `warn` (selective restriction - a targeted blacklist)
- none can -> `fail`, and this alone forces an overall FAIL verdict, because it
  is not a heuristic: we ran the transfer and it reverted
- no holder with a live non-zero balance -> `unresolved`

Revert reasons are decoded, not guessed: known custom-error selectors
(`EnforcedPause`, `Blacklisted(address)`, `ERC20InsufficientBalance` …) plus
`Error(string)` require-messages. An unrecognised selector is reported as
"unrecognised error 0x…" rather than being interpreted.

**What it does not prove:** it is a transfer test, not a DEX sell test. Tokens
moving between wallets does not mean a pool exists, has liquidity, or lacks a
router-level tax. And it is true only at the block it ran - which is what the
watchtower exists to handle.

### lp_lock
Unresolved until `dex.factory_address` is set in `known_tokens.json` - see
`ROADMAP.md` for why this isn't wired to a live factory yet.

## impersonation lane

See `docs/impersonation.md`.


## The watchtower (backend)

Every check above is a snapshot. `backend/app/watchtower.py` re-scans contracts
we have already seen (oldest first) and records a diff when a watched check
changes status: `exit_test`, `ownership`, `supply_mint`, `source_verified`.

Transitions to or from `unresolved` are deliberately never recorded. An
explorer timeout is not a fact about the contract, and surfacing it as
"OWNERSHIP CHANGED" would bury the real events. Severity: any change *into* a
failed exit test is critical, ok->fail is critical, ok->warn is a warning, and
a recovery is informational.

Events are served at `GET /api/events` and rendered at `/changes`.

## Solana: the crowd (extension only, `extension/lib/crowd.js`)

None of these is on the path to a verdict. They come from an index's undocumented record
(`datapi.jup.ag`), are asked for or drawn beside the verdict, and every one says whose record
it is. Two can be amber; none can fail.

| id | what it says | can be amber when |
|---|---|---|
| `stake_before` / `stake_after` / `stake_now` / `stake_sent` / `stake_money` | the wallet an index files under the account that wrote the post: when it bought, what it sold since the post, what it holds, how much of that was sent rather than bought | it held the token when the post went out and has sold half or more since |
| `funders` | wallets among the fifty largest that one address first funded inside one hour | three or more wallets, a twentieth of supply, no list vouching for the token, **and** the funder read from the chain as not an exchange (under a thousand signatures a day) |
| `bundle_holders` | holders the index tags as part of a bundled buy, and what they still hold | they still hold a tenth of supply, on a token no list vouches for |
| `early_holders` | holders the index tags sniper or insider | never |
| `named_holders` | wallets among the largest that the index files under an X account | never |
| `venues` | exchange and market-maker wallets, counted as nobody's position | never |
| `spread` | the largest wallet and the ten largest, by the index's list - shown only when the chain's own holder read was refused | never |
| `creator_record` | launches the index attributes to the creator wallet, and how many left the launchpad | ten or more launches with under a tenth graduated; past a thousand it is named a launch service and is never amber |
| `creator_best` | the creator's largest other tokens and whether they still trade | never |
| `creator_trades` | what the creator wallet did with its own token | it has sold nine tenths or more of what it bought, on a token no list vouches for |

