"""4-byte function selectors for dangerous/interesting functions.

Every selector below was computed locally as keccak256(signature)[:4] (via
pycryptodome) and, where possible, cross-checked against real deployed
bytecode pulled from Robinhood Chain - e.g. mint(address,uint256) = 0x40c10f19
matches the dispatch table byte-for-byte in a verified LinkToken contract on
this chain. These are not guessed; recompute with `python -m edgerun.selectors`
if you don't trust the hardcoded table.

The scan works off `deployed_bytecode` (from Blockscout for verified
contracts, or eth_getCode over RPC otherwise), so this check runs regardless
of verification status - it just checks "does this selector's 4 bytes appear
in the runtime bytecode's dispatch table", which is a presence check, not a
reachability proof. A contract can carry a selector while still gating it
behind onlyOwner, or not routing to it in the dispatcher at all in some
obfuscated cases. Treat this as a red flag to investigate, not a conviction.
"""
from __future__ import annotations

# signature -> (selector, human label)
DANGEROUS_SELECTORS: dict[str, tuple[str, str]] = {
    "mint(address,uint256)": ("40c10f19", "mint(address,uint256) - supply can be increased post-deploy"),
    "pause()": ("8456cb59", "pause() - transfers can be frozen by the owner"),
    "unpause()": ("3f4ba83a", "unpause() - pairs with pause(), confirms pausable pattern"),
    "blacklist(address)": ("f9f92be4", "blacklist(address) - specific wallets can be blocked from trading"),
    "addBlacklist(address)": ("9cfe42da", "addBlacklist(address) - blacklist pattern, alternate naming"),
    "isBlacklisted(address)": ("fe575a87", "isBlacklisted(address) - blacklist pattern present"),
    "setTaxFee(uint256)": ("c4081a4c", "setTaxFee(uint256) - transfer tax can be changed after launch"),
    "setFee(uint256)": ("69fe0e2d", "setFee(uint256) - fee can be changed after launch"),
    "setMaxTxAmount(uint256)": ("ec28438a", "setMaxTxAmount(uint256) - per-tx transfer cap can be set by owner"),
    "excludeFromFee(address)": ("437823ec", "excludeFromFee(address) - fee can be selectively waived"),
}

OWNER_SELECTOR = "8da5cb5b"  # owner()
RENOUNCE_OWNERSHIP_SELECTOR = "715018a6"  # renounceOwnership()
TRANSFER_OWNERSHIP_SELECTOR = "f2fde38b"  # transferOwnership(address)
TOTAL_SUPPLY_SELECTOR = "18160ddd"  # totalSupply()


def selectors_present(deployed_bytecode: str) -> list[tuple[str, str]]:
    """Returns [(signature, label), ...] for every dangerous selector whose
    4-byte value appears in the bytecode's PUSH4 dispatch table."""
    if not deployed_bytecode:
        return []
    code = deployed_bytecode.lower().removeprefix("0x")
    found = []
    for sig, (selector, label) in DANGEROUS_SELECTORS.items():
        # PUSH4 <selector> is how Solidity's dispatcher compares msg.sig; the
        # selector's 4 bytes appear literally in the bytecode either way.
        if selector in code:
            found.append((sig, label))
    return found


def _recompute() -> None:  # pragma: no cover - manual verification utility
    from Crypto.Hash import keccak

    for sig, (expected, _label) in DANGEROUS_SELECTORS.items():
        got = keccak.new(digest_bits=256, data=sig.encode()).hexdigest()[:8]
        status = "OK" if got == expected else f"MISMATCH (recomputed {got})"
        print(f"{sig:35s} {expected}  {status}")


if __name__ == "__main__":  # pragma: no cover
    _recompute()
