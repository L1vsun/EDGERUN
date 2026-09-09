"""Watchtower: re-scan known contracts and record what CHANGED.

Every comparable tool on this chain ships a snapshot — you paste an address,
you get a verdict, and nothing watches it afterward. But a contract that
passed every check at 14:02 can have ownership transferred at 14:40, or stop
letting holders sell at 15:10. The snapshot was never wrong; it just stopped
being true, and nobody told the holder.

This re-runs the full scan on contracts we've already seen and stores a diff
whenever a materially important field flips. The diffs are the product: an
event stream of "this changed, here's what it was, here's what it is now".

Nothing here is inferred. A change is recorded only when two real scans of the
same address disagree, and each event names the exact check that moved.
"""
from __future__ import annotations

import asyncio
import logging

from edgerun.config import Config
from edgerun.scan import scan_address

from . import settings
from .cache import ScanCache

log = logging.getLogger("edgerun.watchtower")

# Only these checks raise an event. A wording tweak in a detail string, or a
# check flipping to `unresolved` because the explorer hiccuped, is noise —
# and a false "OWNERSHIP TRANSFERRED" alert is worse than no alert at all.
WATCHED_CHECKS = {
    "exit_test": "sellability",
    "ownership": "ownership",
    "supply_mint": "supply",
    "source_verified": "verification",
}

# Severity of a transition, used for ordering the public event feed.
CRITICAL = "critical"
WARNING = "warning"
INFO = "info"


def _status_map(result: dict) -> dict[str, str]:
    out = {}
    for check in (result.get("contract") or {}).get("checks", []):
        if check.get("id") in WATCHED_CHECKS:
            out[check["id"]] = check.get("status", "")
    return out


def _severity(check_id: str, before: str, after: str) -> str:
    # Going from working to blocked is the alert this whole module exists for.
    if check_id == "exit_test" and after == "fail":
        return CRITICAL
    if before == "ok" and after == "fail":
        return CRITICAL
    if before == "ok" and after == "warn":
        return WARNING
    if after == "ok":
        return INFO
    return WARNING


def diff_scans(previous: dict, current: dict) -> list[dict]:
    """Material status transitions between two scans of the same address.

    Transitions to/from `unresolved` are deliberately ignored: the explorer
    being briefly unreachable is not a fact about the contract, and emitting
    it would bury the real events in noise.
    """
    before_map, after_map = _status_map(previous), _status_map(current)
    events = []

    for check_id, label in WATCHED_CHECKS.items():
        before, after = before_map.get(check_id), after_map.get(check_id)
        if not before or not after or before == after:
            continue
        if "unresolved" in (before, after):
            continue

        detail = next(
            (c.get("detail", "") for c in (current.get("contract") or {}).get("checks", [])
             if c.get("id") == check_id),
            "",
        )
        events.append({
            "address": current.get("address"),
            "ticker": current.get("token_symbol"),
            "check": check_id,
            "label": label,
            "before": before,
            "after": after,
            "severity": _severity(check_id, before, after),
            "detail": detail,
            "verdict_before": previous.get("verdict"),
            "verdict_after": current.get("verdict"),
        })

    return events


async def run_watchtower(cache: ScanCache, config: Config) -> None:
    """Re-scan the oldest-checked contracts on a rolling basis."""
    while True:
        try:
            await _sweep(cache, config)
        except Exception:
            log.exception("watchtower sweep failed, will retry")
        await asyncio.sleep(settings.WATCH_INTERVAL_SECONDS)


async def _sweep(cache: ScanCache, config: Config) -> None:
    targets = cache.stalest(settings.WATCH_BATCH_SIZE, settings.WATCH_MIN_AGE_SECONDS)
    if not targets:
        return

    changed = 0
    for previous in targets:
        address = previous.get("address")
        if not address:
            continue
        try:
            current = (await asyncio.to_thread(scan_address, address, config)).to_dict()
        except Exception as exc:
            log.warning("re-scan failed for %s: %s", address, exc)
            continue

        for event in diff_scans(previous, current):
            cache.add_event(event)
            changed += 1
            log.info(
                "CHANGE %s %s: %s %s -> %s",
                event["severity"], address, event["check"], event["before"], event["after"],
            )

        cache.set(address, current)

    if changed:
        cache.trim_events(settings.EVENT_MAX_ITEMS)
