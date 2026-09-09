"""Watchtower diff logic.

The alerts this module emits are the product, so the cases that must NOT fire
matter as much as the ones that must: an explorer hiccup flipping a check to
`unresolved` must never surface as "OWNERSHIP TRANSFERRED".
"""
from app.watchtower import diff_scans


def scan(address="0xabc", ticker="TEST", verdict="PASS", **checks):
    return {
        "address": address, "token_symbol": ticker, "verdict": verdict,
        "contract": {"checks": [{"id": k, "status": v, "detail": f"{k} is {v}"}
                                for k, v in checks.items()]},
    }

def test_sellability_ok_to_fail_is_critical():
    # # 1. the headline event: could sell, now can't
    before = scan(exit_test="ok", ownership="ok")
    after  = scan(exit_test="fail", ownership="ok", verdict="FAIL")
    e = diff_scans(before, after)
    assert len(e) == 1, e
    assert e[0]["check"] == "exit_test" and e[0]["severity"] == "critical"

def test_ownership_reacquired_is_critical():
    # ownership re-acquired after being renounced
    e = diff_scans(scan(ownership="ok"), scan(ownership="fail"))
    assert e[0]["severity"] == "critical"

def test_unchanged_emits_nothing():
    # no change -> no events
    assert diff_scans(scan(exit_test="ok"), scan(exit_test="ok")) == []

def test_unresolved_transitions_are_suppressed():
    # explorer hiccup must NOT raise an alert
    assert diff_scans(scan(exit_test="ok"), scan(exit_test="unresolved")) == []
    assert diff_scans(scan(exit_test="unresolved"), scan(exit_test="ok")) == []

def test_recovery_is_informational():
    # recovery is informational, not critical
    e = diff_scans(scan(exit_test="fail"), scan(exit_test="ok"))
    assert e[0]["severity"] == "info"

def test_unwatched_checks_ignored():
    # unwatched checks are ignored
    assert diff_scans(scan(lp_lock="ok"), scan(lp_lock="fail")) == []

def test_multiple_changes_both_reported():
    # multiple simultaneous changes
    e = diff_scans(scan(exit_test="ok", ownership="ok"), scan(exit_test="fail", ownership="warn"))
    assert len(e) == 2
