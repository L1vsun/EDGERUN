# Security

## Scope
edgerun is a read-only checker. It never connects a wallet, never signs a transaction,
and never custodies funds - every check is a public read: a keyless chain RPC
(`getAccountInfo` on Solana, `eth_call`/`eth_getCode` on the EVM chains), a block
explorer's REST API, a published token list or registry, or a keyless market index.

## $EDGERUN contract address and audit status
The token is not deployed yet. This file will be updated with the real contract
address and audit status (or an explicit "not audited" statement) before or at launch
- see the "Token banner" requirement in `EDGERUN_coder_brief.md`, which is the single
place the address is meant to be configured from
(`NEXT_PUBLIC_EDGERUN_CONTRACT_ADDRESS` / `EDGERUN_CONTRACT_ADDRESS`).

## Reporting an issue
This is a security tool; a false PASS is the worst failure mode it can have. If you
find one - a contract edgerun scores PASS/CAUTION that you believe is a rug or an
impersonator, or vice versa - open an issue with the address and what you found. Don't
open a public issue for a live exploit against the $EDGERUN contract itself once
deployed; see the contact path that will be added here at launch.

## Known limitations
See "What this does not catch" in `EDGERUN_README.md` and `ROADMAP.md` - holder
concentration, post-scan admin-key changes, off-chain social engineering, and novel
obfuscation patterns are explicitly out of scope for this tool's contract-level checks.
