"""Loads known_tokens.json: the reference list, thresholds, and chain endpoints.

This is the one file the README says operators should actually touch. Everything
in here has a documented default so `edgerun scan` works out of the box against
Robinhood Chain mainnet (chain id 4663), with an override path for testnet or a
private explorer mirror.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "data" / "known_tokens.json"

DEFAULT_EXPLORER_BASE = "https://robinhoodchain.blockscout.com"
DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com"
DEFAULT_CHAIN_ID = 4663


@dataclass
class ReferenceToken:
    ticker: str
    name: str
    contract: str
    note: str = ""


@dataclass
class Thresholds:
    max_edit_distance_flag: int = 2
    lp_lock_warn_days_remaining: int = 180


@dataclass
class Config:
    reference_tokens: list[ReferenceToken] = field(default_factory=list)
    thresholds: Thresholds = field(default_factory=Thresholds)
    explorer_base: str = DEFAULT_EXPLORER_BASE
    rpc_url: str = DEFAULT_RPC_URL
    chain_id: int = DEFAULT_CHAIN_ID
    dex_factory_address: str | None = None
    path: Path = DEFAULT_CONFIG_PATH


def load_config(path: str | Path | None = None) -> Config:
    cfg_path = Path(path) if path else Path(os.environ.get("EDGERUN_CONFIG", DEFAULT_CONFIG_PATH))
    if not cfg_path.exists():
        raise FileNotFoundError(
            f"known_tokens.json not found at {cfg_path}. "
            "Copy data/known_tokens.json and point EDGERUN_CONFIG at it, or run from the repo root."
        )
    raw = json.loads(cfg_path.read_text())

    reference_tokens = [
        ReferenceToken(
            ticker=t["ticker"],
            name=t["name"],
            contract=t["contract"],
            note=t.get("note", ""),
        )
        for t in raw.get("reference_tokens", [])
    ]

    th_raw = raw.get("thresholds", {})
    thresholds = Thresholds(
        max_edit_distance_flag=th_raw.get("max_edit_distance_flag", 2),
        lp_lock_warn_days_remaining=th_raw.get("lp_lock_warn_days_remaining", 180),
    )

    rpc_raw = raw.get("rpc", {})
    dex_raw = raw.get("dex", {})

    return Config(
        reference_tokens=reference_tokens,
        thresholds=thresholds,
        explorer_base=rpc_raw.get("explorer_base", DEFAULT_EXPLORER_BASE).rstrip("/"),
        rpc_url=rpc_raw.get("rpc_url", DEFAULT_RPC_URL),
        chain_id=rpc_raw.get("chain_id", DEFAULT_CHAIN_ID),
        dex_factory_address=dex_raw.get("factory_address"),
        path=cfg_path,
    )
