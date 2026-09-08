"""Impersonation lane: edit-distance the new token's ticker/name against every
entry in the maintained reference list (`known_tokens.json`). Distance, not a
percentage — see docs/impersonation.md for why.
"""
from __future__ import annotations

from ..config import Config
from ..models import CheckResult, ImpersonationLane, ImpersonationMatch


def levenshtein(a: str, b: str) -> int:
    a, b = a.lower(), b.lower()
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(
                prev[j] + 1,        # deletion
                cur[j - 1] + 1,     # insertion
                prev[j - 1] + (ca != cb),  # substitution
            )
        prev = cur
    return prev[-1]


def allowed_distance(a: str, b: str, threshold: int) -> int:
    """How many edits may separate two strings before we stop calling it a
    near-miss, scaled to the shorter string's length.

    A flat threshold is wrong for short tickers: "AI" and "HD" are 2 edits
    apart but share nothing, and flagging that as impersonation is a false
    positive that costs the tool its credibility. Requiring the distance to
    stay under half the shorter string keeps "H00D"~"HOOD" (2 edits of 4)
    while dropping "AI"~"HD" (2 edits of 2).
    """
    shorter = min(len(a), len(b))
    return min(threshold, shorter // 2)


def run_impersonation_lane(
    address: str, token_symbol: str | None, token_name: str | None, config: Config
) -> ImpersonationLane:
    checks: list[CheckResult] = []
    matches: list[ImpersonationMatch] = []

    if not config.reference_tokens:
        checks.append(CheckResult(
            "impersonation", "impersonation", "unresolved",
            "reference list (known_tokens.json) is empty — nothing to compare against",
        ))
        return ImpersonationLane(checks=checks, nearest_matches=matches)

    if not token_symbol and not token_name:
        checks.append(CheckResult(
            "impersonation", "impersonation", "unresolved",
            "this address has no token metadata (symbol/name) to compare — not an ERC-20, "
            "or Blockscout hasn't indexed it as one",
        ))
        return ImpersonationLane(checks=checks, nearest_matches=matches)

    threshold = config.thresholds.max_edit_distance_flag
    is_self = False
    flagged = False

    for ref in config.reference_tokens:
        if ref.contract.lower() == address.lower():
            is_self = True
            continue

        if token_symbol:
            d = levenshtein(token_symbol, ref.ticker)
            if d <= allowed_distance(token_symbol, ref.ticker, threshold):
                matches.append(ImpersonationMatch(ref.ticker, ref.name, ref.contract, d, "ticker"))
        if token_name:
            d = levenshtein(token_name, ref.name)
            if d <= allowed_distance(token_name, ref.name, threshold):
                matches.append(ImpersonationMatch(ref.ticker, ref.name, ref.contract, d, "name"))

    matches.sort(key=lambda m: m.edit_distance)

    if is_self:
        checks.append(CheckResult(
            "impersonation", "impersonation", "ok",
            "this address is itself the reference-list entry for this ticker",
        ))
        return ImpersonationLane(checks=checks, nearest_matches=matches)

    for m in matches:
        exact = m.edit_distance == 0
        checks.append(CheckResult(
            f"impersonation_{m.matched_field}", f"{m.matched_field} collision", "fail",
            f'{m.matched_field} "{token_symbol if m.matched_field == "ticker" else token_name}" is '
            f'{"identical to" if exact else f"{m.edit_distance} edit(s) from"} existing token '
            f'{m.ticker} ({m.contract[:6]}...{m.contract[-4:]})',
        ))
        flagged = True

    if not flagged:
        checks.append(CheckResult(
            "impersonation", "impersonation", "ok",
            f"ticker/name matches no known token within edit distance {threshold}",
        ))

    return ImpersonationLane(checks=checks, nearest_matches=matches)
