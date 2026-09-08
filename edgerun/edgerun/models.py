"""Shared result types for both scan lanes."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Literal

Status = Literal["ok", "warn", "fail", "unresolved"]


@dataclass
class CheckResult:
    id: str
    label: str
    status: Status
    detail: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ContractLane:
    source_verified: bool | None
    checks: list[CheckResult] = field(default_factory=list)


@dataclass
class ImpersonationMatch:
    ticker: str
    name: str
    contract: str
    edit_distance: int
    matched_field: str  # "ticker" | "name"


@dataclass
class ImpersonationLane:
    checks: list[CheckResult] = field(default_factory=list)
    nearest_matches: list[ImpersonationMatch] = field(default_factory=list)


@dataclass
class ScanResult:
    address: str
    scanned_at: str
    contract: ContractLane
    impersonation: ImpersonationLane
    verdict: str
    facts_checked: int
    unresolved: int
    blockscout_url: str
    token_name: str | None = None
    token_symbol: str | None = None

    def to_dict(self) -> dict:
        return {
            "address": self.address,
            "scanned_at": self.scanned_at,
            "token_name": self.token_name,
            "token_symbol": self.token_symbol,
            "contract": {
                "source_verified": self.contract.source_verified,
                "checks": [c.to_dict() for c in self.contract.checks],
            },
            "impersonation": {
                "checks": [c.to_dict() for c in self.impersonation.checks],
                "nearest_matches": [asdict(m) for m in self.impersonation.nearest_matches],
            },
            "verdict": self.verdict,
            "facts_checked": self.facts_checked,
            "unresolved": self.unresolved,
            "blockscout_url": self.blockscout_url,
        }
