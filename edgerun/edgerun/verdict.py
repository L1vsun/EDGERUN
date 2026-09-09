"""Verdict assembly: PASS / CAUTION / FAIL from the two lanes' check lists.

Priority, derived directly from the README's own worked examples:
  - exit test at "fail"                      -> FAIL    (holders provably cannot move it)
  - any impersonation check at "fail"        -> FAIL    (you may be looking at the wrong contract)
  - else any contract check at "fail"        -> CAUTION (unverified source, live mint, etc.)
  - else the contract lane resolved nothing  -> CAUTION (Blockscout/RPC unreachable — we didn't
                                                 verify anything, so this can't read as a pass)
  - else                                     -> PASS    (warns are shown but don't block PASS)
"""
from __future__ import annotations

from enum import Enum

from .models import ContractLane, ImpersonationLane


class Verdict(str, Enum):
    PASS = "PASS"
    CAUTION = "CAUTION"
    FAIL = "FAIL"


def assemble_verdict(contract: ContractLane, impersonation: ImpersonationLane) -> tuple[Verdict, int, int]:
    all_checks = contract.checks + impersonation.checks

    # A proven-blocked exit outranks everything: it is not a heuristic, we
    # executed the transfer and it reverted.
    exit_blocked = any(c.id == "exit_test" and c.status == "fail" for c in contract.checks)
    impersonation_fail = any(c.status == "fail" for c in impersonation.checks)
    contract_fail = any(c.status == "fail" for c in contract.checks)
    contract_resolved_nothing = bool(contract.checks) and all(
        c.status == "unresolved" for c in contract.checks
    )

    if exit_blocked or impersonation_fail:
        verdict = Verdict.FAIL
    elif contract_fail or contract_resolved_nothing:
        verdict = Verdict.CAUTION
    else:
        verdict = Verdict.PASS

    unresolved = sum(1 for c in all_checks if c.status == "unresolved")
    facts_checked = len(all_checks) - unresolved

    return verdict, facts_checked, unresolved
