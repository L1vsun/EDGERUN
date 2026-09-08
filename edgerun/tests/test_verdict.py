from edgerun.models import CheckResult, ContractLane, ImpersonationLane
from edgerun.verdict import Verdict, assemble_verdict


def test_impersonation_fail_wins_over_everything():
    contract = ContractLane(True, [CheckResult("a", "a", "ok", "fine")])
    impersonation = ImpersonationLane([CheckResult("b", "b", "fail", "collision")])
    verdict, _, _ = assemble_verdict(contract, impersonation)
    assert verdict == Verdict.FAIL


def test_contract_fail_without_impersonation_is_caution():
    contract = ContractLane(False, [CheckResult("a", "a", "fail", "unverified")])
    impersonation = ImpersonationLane([CheckResult("b", "b", "ok", "clean")])
    verdict, _, _ = assemble_verdict(contract, impersonation)
    assert verdict == Verdict.CAUTION


def test_all_clean_is_pass():
    contract = ContractLane(True, [CheckResult("a", "a", "ok", "fine"), CheckResult("c", "c", "warn", "meh")])
    impersonation = ImpersonationLane([CheckResult("b", "b", "ok", "clean")])
    verdict, _, _ = assemble_verdict(contract, impersonation)
    assert verdict == Verdict.PASS


def test_contract_lane_entirely_unresolved_is_caution_not_pass():
    # Regression: explorer returned 500 for one address during a live poller
    # run and the old logic scored that as PASS (0 fails = pass) instead of
    # "we verified nothing here."
    contract = ContractLane(None, [CheckResult("a", "a", "unresolved", "explorer unreachable")])
    impersonation = ImpersonationLane([CheckResult("b", "b", "ok", "clean")])
    verdict, facts_checked, unresolved = assemble_verdict(contract, impersonation)
    assert verdict == Verdict.CAUTION
    assert facts_checked == 1
    assert unresolved == 1
