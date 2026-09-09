"""Stock-token authenticity: is this the real tokenised security, or a copy?

Runs only on Robinhood Chain, because only Robinhood Chain has official
tokenised equities with a published registry (see ../stock_registry.py).

The three verdicts that matter:

  official     the address IS the registry entry for its ticker
  impersonator the ticker or the "• Robinhood Token" branding matches an
               official asset, but the address does not — a provable fake,
               not a similarity score
  unrelated    no claim on an official asset; the normal lanes apply

The impersonator case is the one no generic scanner reaches. A fake
"Tesla • Robinhood Token" is a structurally perfect ERC-20 — verified source,
renounced ownership, fixed supply — so every contract-level check passes it.
It is only a scam because of what it claims to be, and that claim can only be
falsified against Robinhood's own registry.
"""
from __future__ import annotations

from ..models import CheckResult
from ..rpc import RpcClient, RpcError
from ..stock_registry import (
    OFFICIAL_NAME_MARKER,
    REGISTRY,
    UI_MULTIPLIER_SELECTOR,
    normalize_name,
)


def _short(addr: str) -> str:
    return f"{addr[:8]}…{addr[-6:]}" if len(addr) > 16 else addr


def _implements_ui_multiplier(rpc: RpcClient, address: str) -> bool | None:
    """ERC-8056 fingerprint. True/False, or None if the RPC didn't answer."""
    try:
        result = rpc.eth_call(None, address, UI_MULTIPLIER_SELECTOR)
    except RpcError:
        return False
    except Exception:
        return None
    return bool(result) and result != "0x"


def run_stock_check(
    address: str, token_symbol: str | None, token_name: str | None, rpc: RpcClient
) -> CheckResult | None:
    """Returns None when the token makes no claim on an official asset, so the
    check only appears on scans where it says something."""
    if not REGISTRY.refresh():
        # Never let an unreachable registry read as authentic.
        if token_symbol or token_name:
            return CheckResult(
                "stock_token", "stock token", "unresolved",
                f"cannot reach the official Robinhood stock-token registry "
                f"({REGISTRY.error}) — cannot confirm or deny an official claim",
            )
        return None

    symbol = (token_symbol or "").upper().strip()
    name_norm = normalize_name(token_name or "")

    # 1. Is this address itself an official stock token?
    official_here = REGISTRY.official_for_address(address)
    if official_here:
        return CheckResult(
            "stock_token", "stock token", "ok",
            f"VERIFIED official Robinhood stock token — {official_here['ticker']} "
            f"({official_here['name']}), matches the registry published by Robinhood",
        )

    # 2. Does it use an official ticker while not being that contract?
    official_ticker = REGISTRY.official_for_ticker(symbol) if symbol else None

    # 3. Does it wear the official branding?
    claims_branding = OFFICIAL_NAME_MARKER in name_norm

    if official_ticker:
        detail = (
            f'ticker "{symbol}" is an OFFICIAL Robinhood tokenised stock '
            f'({official_ticker["name"]}) deployed at {_short(official_ticker["address"])} — '
            f"this contract is {_short(address)}, which is NOT it"
        )
        if claims_branding:
            detail += '. It also copies the official "• Robinhood Token" name format'
        return CheckResult("stock_token", "stock token", "fail", detail)

    if claims_branding:
        return CheckResult(
            "stock_token", "stock token", "fail",
            'name copies the official "• Robinhood Token" branding used by Robinhood\'s '
            f"tokenised securities, but {_short(address)} is not in the official registry",
        )

    # 4. No claim on an official asset. Note an odd ERC-8056 implementation
    #    only as a warning — it is suggestive, never proof on its own.
    if _implements_ui_multiplier(rpc, address):
        return CheckResult(
            "stock_token", "stock token", "warn",
            "implements the ERC-8056 uiMultiplier() function used by official Robinhood "
            "stock tokens, but is not in the official registry — unusual for an ordinary token",
        )

    return None
