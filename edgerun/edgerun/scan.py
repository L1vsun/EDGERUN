"""Top-level entry point: scan_address() runs both lanes and returns a
ScanResult. This is what the CLI and the FastAPI backend both call - one
scan engine, two entry points, per the project's own design brief.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .blockscout import BlockscoutClient, BlockscoutError
from .checks.contract_safety import run_contract_lane
from .checks.impersonation import run_impersonation_lane
from .config import Config, load_config
from .models import ContractLane, ImpersonationLane, ScanResult
from .rpc import RpcClient
from .verdict import assemble_verdict


def scan_address(address: str, config: Config | None = None) -> ScanResult:
    if config is None:
        config = load_config()

    address = _normalize_address(address)

    with BlockscoutClient(config.explorer_base) as bs, RpcClient(config.rpc_url) as rpc:
        contract = run_contract_lane(address, bs, rpc, config)

        token_symbol = token_name = None
        try:
            token_data = bs.token(address)
            token_symbol = token_data.get("symbol")
            token_name = token_data.get("name")
        except BlockscoutError:
            pass  # not every contract is an ERC-20; impersonation lane handles the empty case

        impersonation = run_impersonation_lane(address, token_symbol, token_name, config, rpc)
        blockscout_url = bs.explorer_url(address)

    verdict, facts_checked, unresolved = assemble_verdict(contract, impersonation)

    return ScanResult(
        address=address,
        scanned_at=datetime.now(timezone.utc).isoformat(),
        contract=contract,
        impersonation=impersonation,
        verdict=verdict.value,
        facts_checked=facts_checked,
        unresolved=unresolved,
        blockscout_url=blockscout_url,
        token_name=token_name,
        token_symbol=token_symbol,
    )


def _normalize_address(address: str) -> str:
    address = address.strip()
    if not address.startswith("0x") or len(address) != 42:
        raise ValueError(f"'{address}' doesn't look like a contract address (expected 0x + 40 hex chars)")
    return address
