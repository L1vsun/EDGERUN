from edgerun.checks.impersonation import levenshtein, run_impersonation_lane
from edgerun.config import Config, ReferenceToken, Thresholds


def _config(**overrides) -> Config:
    base = Config(
        reference_tokens=[ReferenceToken("HOOD", "GreenHood", "0x" + "1" * 40)],
        thresholds=Thresholds(max_edit_distance_flag=2),
    )
    for k, v in overrides.items():
        setattr(base, k, v)
    return base


def test_levenshtein_basic():
    assert levenshtein("HOOD", "HOOD") == 0
    assert levenshtein("HOOD", "H00D") == 2  # both O's swapped for zeros
    assert levenshtein("HOOD", "HOOD ") == 1
    assert levenshtein("", "abc") == 3


def test_flags_near_miss_ticker():
    lane = run_impersonation_lane("0x" + "2" * 40, "H00D", "Robinhood Official", _config())
    assert any(c.status == "fail" for c in lane.checks)
    assert lane.nearest_matches[0].ticker == "HOOD"
    assert lane.nearest_matches[0].edit_distance == 2


def test_exact_ticker_match_flagged_as_impersonation_when_address_differs():
    lane = run_impersonation_lane("0x" + "2" * 40, "HOOD", "Totally Different Name", _config())
    assert any(c.status == "fail" for c in lane.checks)


def test_self_reference_is_ok_not_fail():
    self_addr = "0x" + "1" * 40
    lane = run_impersonation_lane(self_addr, "HOOD", "GreenHood", _config())
    assert all(c.status != "fail" for c in lane.checks)


def test_clean_ticker_passes():
    lane = run_impersonation_lane("0x" + "2" * 40, "ZEBRAFISH", "Zebrafish Protocol", _config())
    assert all(c.status == "ok" for c in lane.checks)


def test_empty_reference_list_is_unresolved():
    lane = run_impersonation_lane("0x" + "2" * 40, "HOOD", "GreenHood", _config(reference_tokens=[]))
    assert lane.checks[0].status == "unresolved"


def test_no_token_metadata_is_unresolved():
    lane = run_impersonation_lane("0x" + "2" * 40, None, None, _config())
    assert lane.checks[0].status == "unresolved"


# --- length-scaled threshold (regression: short-ticker false positives) ---

def test_short_tickers_do_not_collide_on_flat_threshold():
    """Regression: a live poller run flagged 'AI' as 2 edits from 'HD'.

    Both are 2 chars, so a flat distance-2 threshold matches any pair of
    2-char tickers — the strings share nothing. This must not flag.
    """
    cfg = _config(reference_tokens=[ReferenceToken("HD", "Hood Domains", "0x" + "1" * 40)])
    lane = run_impersonation_lane("0x" + "2" * 40, "AI", "Artificial", cfg)
    assert all(c.status != "fail" for c in lane.checks)


def test_real_lookalike_still_flags():
    """H00D vs HOOD is 2 edits of 4 chars — the exact attack we exist to catch."""
    lane = run_impersonation_lane("0x" + "2" * 40, "H00D", "Something Else", _config())
    assert any(c.status == "fail" for c in lane.checks)


def test_one_edit_on_short_ticker_still_flags():
    cfg = _config(reference_tokens=[ReferenceToken("HD", "Hood Domains", "0x" + "1" * 40)])
    lane = run_impersonation_lane("0x" + "2" * 40, "H0", "Hood Domains", cfg)
    assert any(c.status == "fail" for c in lane.checks)


def test_allowed_distance_scales_with_length():
    from edgerun.checks.impersonation import allowed_distance
    assert allowed_distance("AI", "HD", 2) == 1      # 2 chars -> 1 edit max
    assert allowed_distance("HOOD", "H00D", 2) == 2  # 4 chars -> full threshold
    assert allowed_distance("CASHCAT", "CASHCA7", 2) == 2
