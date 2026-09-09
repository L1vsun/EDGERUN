"""Contract safety lane: verification, mint/supply, ownership, dangerous
functions, LP lock. See docs/checks.md for the exact Blockscout/RPC call
behind each line and what "unresolved" means for that specific check.
"""
from __future__ import annotations

import re

from ..blockscout import BlockscoutClient, BlockscoutError
from ..config import Config
from ..models import CheckResult, ContractLane
from ..rpc import RpcClient, RpcError, ZERO_ADDRESS
from ..selectors import selectors_present
from .exit_test import run_exit_test

_MINT_SOURCE_RE = re.compile(r"function\s+\w*mint\w*\s*\([^)]*\)\s*(external|public)", re.IGNORECASE)


def run_contract_lane(address: str, bs: BlockscoutClient, rpc: RpcClient, config: Config) -> ContractLane:
    checks: list[CheckResult] = []

    # --- verification status ---
    try:
        addr_data = bs.address(address)
    except BlockscoutError as exc:
        checks.append(CheckResult("source_verified", "source verification", "unresolved",
                                   f"Blockscout unreachable: {exc}"))
        return ContractLane(source_verified=None, checks=checks)

    deployer = addr_data.get("creator_address_hash")

    if not addr_data.get("is_contract"):
        checks.append(CheckResult("is_contract", "is a contract", "fail",
                                   "this address is not a contract (EOA or unused address)"))
        return ContractLane(source_verified=None, checks=checks, deployer=deployer)

    is_verified = bool(addr_data.get("is_verified"))
    checks.append(CheckResult(
        "source_verified", "source verification",
        "ok" if is_verified else "fail",
        "source verified on blockscout" if is_verified
        else "source not verified — checks below are limited to bytecode-level signals",
    ))

    source_code = ""
    deployed_bytecode = ""

    if is_verified:
        try:
            sc = bs.smart_contract(address)
            deployed_bytecode = sc.get("deployed_bytecode") or ""
            source_code = sc.get("source_code") or ""
            for extra in sc.get("additional_sources") or []:
                source_code += "\n" + (extra.get("source_code") or "")
        except BlockscoutError as exc:
            checks.append(CheckResult("source_fetch", "source fetch", "unresolved", str(exc)))

    if not deployed_bytecode:
        try:
            deployed_bytecode = rpc.eth_get_code(address)
        except RpcError as exc:
            checks.append(CheckResult("bytecode_fetch", "bytecode fetch", "unresolved", str(exc)))

    # --- supply / mint ---
    checks.append(_mint_check(is_verified, source_code, deployed_bytecode))

    # --- ownership + dangerous functions ---
    checks.append(_ownership_check(rpc, address, deployed_bytecode))

    # --- LP lock ---
    checks.append(_lp_lock_check(config))

    # --- exit test: the only check that executes rather than inspects ---
    checks.append(run_exit_test(address, bs, rpc))

    return ContractLane(source_verified=is_verified, checks=checks, deployer=deployer)


def _mint_check(is_verified: bool, source_code: str, deployed_bytecode: str) -> CheckResult:
    dangerous = selectors_present(deployed_bytecode)
    standard_mint = any(sig.startswith("mint(address,uint256)") for sig, _ in dangerous)

    if standard_mint:
        return CheckResult(
            "supply_mint", "supply / mint", "fail",
            "mint(address,uint256) selector present in deployed bytecode — supply is not fixed",
        )

    if is_verified and source_code:
        if _MINT_SOURCE_RE.search(source_code):
            return CheckResult(
                "supply_mint", "supply / mint", "warn",
                "a public/external function named *mint* exists in verified source with a "
                "non-standard signature — not auto-detected by selector scan, read it yourself",
            )
        return CheckResult(
            "supply_mint", "supply / mint", "ok",
            "supply fixed at deploy, no mint function in verified source",
        )

    if deployed_bytecode:
        return CheckResult(
            "supply_mint", "supply / mint", "ok",
            "no standard mint(address,uint256) selector in bytecode (bytecode-only scan — "
            "source not verified, a custom-signature mint function can't be ruled out)",
        )

    return CheckResult("supply_mint", "supply / mint", "unresolved",
                        "cannot inspect bytecode for a mint path — no source and no code fetched")


def _ownership_check(rpc: RpcClient, address: str, deployed_bytecode: str) -> CheckResult:
    dangerous = [d for d in selectors_present(deployed_bytecode) if not d[0].startswith("mint(")]

    try:
        owner = rpc.owner(address)
    except RpcError:
        owner = None

    if owner is None:
        if dangerous:
            names = ", ".join(sig for sig, _ in dangerous)
            return CheckResult(
                "ownership", "ownership", "warn",
                f"owner() unreadable (no Ownable-style getter), but bytecode exposes: {names} — "
                "cannot confirm who can still call these",
            )
        return CheckResult("ownership", "ownership", "unresolved",
                            "owner() call reverted or contract has no Ownable-style owner()")

    renounced = owner == ZERO_ADDRESS

    if renounced and not dangerous:
        return CheckResult("ownership", "ownership", "ok",
                            "ownership renounced, no dangerous owner-gated functions detected in bytecode")

    if renounced and dangerous:
        names = ", ".join(sig for sig, _ in dangerous)
        return CheckResult(
            "ownership", "ownership", "warn",
            f"ownership renounced, but bytecode still exposes: {names} — selector presence doesn't "
            "prove the modifier guarding it, verify the source",
        )

    if not renounced and dangerous:
        names = ", ".join(sig for sig, _ in dangerous)
        return CheckResult(
            "ownership", "ownership", "fail",
            f"ownership held by {owner} AND contract exposes: {names} — live, callable risk",
        )

    return CheckResult("ownership", "ownership", "warn", f"ownership not renounced (owner: {owner})")


def _lp_lock_check(config: Config) -> CheckResult:
    if not config.dex_factory_address:
        return CheckResult(
            "lp_lock", "LP lock", "unresolved",
            "no DEX factory configured — set dex.factory_address in known_tokens.json to enable "
            "pair resolution for this deployment (see ROADMAP.md)",
        )
    # Pair resolution against a real factory is implemented once a live RH Chain
    # DEX factory address is confirmed and set in config — see ROADMAP.md.
    return CheckResult("lp_lock", "LP lock", "unresolved",
                        "pair contract not resolvable from creation tx")
