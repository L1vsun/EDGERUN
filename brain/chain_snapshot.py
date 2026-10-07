"""Read the same tape the website reads, but from Python.

The browser does this in `frontend/lib/chain.ts`. This is a second implementation for the
scheduled council runs, which have no browser. THE MAPPING AND THE THRESHOLDS BELOW ARE
DUPLICATED FROM `lib/chain.ts` - if you change one, change the other, or the council will
disagree with the live page for no good reason.

What it reads: a public, keyless index of Solana's five-minute tape - the tokens trading
hardest right now and the ones that launched most recently, with how many buys and sells
landed, from how many wallets, how the holder count moved, and how the volume compares with
the hour before. It is NOT every transaction on the chain, and nothing here says it is.
"""
from __future__ import annotations

import json
import time
import urllib.request

# Two hosts, in order: the keyless one has been announced for retirement and postponed.
HOSTS = ("https://lite-api.jup.ag", "https://api.jup.ag")
FEEDS = ("/tokens/v2/toptrending/5m?limit=50", "/tokens/v2/recent?limit=30")
WINDOW_SECONDS = 300
NEW_MS = 30 * 60 * 1000

# What everything else is priced against. Always busy, and never the interesting call.
QUOTE = {
    "So11111111111111111111111111111111111111112",   # wrapped SOL
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",  # USDC
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",  # USDT
    "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",  # PYUSD
    "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",  # jitoSOL
    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",   # mSOL
}


def _get(path: str, tries: int = 3):
    last = None
    for attempt in range(tries):
        for host in HOSTS:
            try:
                req = urllib.request.Request(
                    host + path, headers={"Accept": "application/json", "User-Agent": "edgerun-council/1.0"},
                )
                with urllib.request.urlopen(req, timeout=30) as r:
                    body = json.load(r)
                if isinstance(body, list):
                    return body
            except Exception as exc:  # noqa: BLE001 - try the other host, then retry
                last = exc
        time.sleep(2 + 3 * attempt)
    raise RuntimeError(f"the feed did not answer after {tries} tries: {last}")


def _n(v) -> float:
    return float(v) if isinstance(v, (int, float)) else 0.0


def _ms(iso) -> int:
    if not iso:
        return 0
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return 0


def to_row(t: dict, now_ms: int) -> dict | None:
    """One row of the feed as the numbers every region reads. Same mapping as lib/chain.ts toStat()."""
    if not t.get("id"):
        return None
    s5 = t.get("stats5m") or {}
    s1h = t.get("stats1h") or {}
    audit = t.get("audit") or {}
    buys, sells = int(_n(s5.get("numBuys"))), int(_n(s5.get("numSells")))
    trades = buys + sells
    holders = t.get("holderCount") if isinstance(t.get("holderCount"), (int, float)) else None
    change = _n(s5.get("holderChange"))
    new_holders = round(holders - holders / (1 + change / 100)) if holders is not None and change > 0 else 0
    vol5 = _n(s5.get("buyVolume")) + _n(s5.get("sellVolume"))
    vol1h = _n(s1h.get("buyVolume")) + _n(s1h.get("sellVolume"))
    first = _ms((t.get("firstPool") or {}).get("createdAt") or t.get("createdAt"))
    age = max(0, now_ms - first) if first else 0
    return {
        "address": str(t["id"]),
        "symbol": str(t.get("symbol") or t["id"])[:14],
        "trades": trades,
        "per_min": round(trades / 5, 1),
        "traders": int(_n(s5.get("numTraders"))),
        "new_holders": int(new_holders),
        "buys": buys,
        "sells": sells,
        "top10": round(max(0.0, min(1.0, _n(audit.get("topHoldersPercentage")) / 100)), 2),
        "mint_open": audit.get("mintAuthorityDisabled") is False,
        "verified": t.get("isVerified") is True,
        # a token younger than the hour has no hour to be measured against: steady
        "accel": round(min(12.0, (vol5 / 5) / (vol1h / 60)), 2) if vol1h > 0 and vol5 > 0 and age >= 3_600_000 else 1.0,
        "quote_asset": str(t["id"]) in QUOTE,
        "is_new": bool(first) and age < NEW_MS,
        "age_min": round(age / 60000) if first else None,
        "launchpad": t.get("launchpad"),
        "_slot": int(_n(t.get("priceBlockId"))),
    }


def flags(t: dict) -> list[str]:
    """Same thresholds as lib/chain.ts signals()."""
    out = []
    fresh = t["new_holders"] / t["traders"] if t["traders"] else 0
    if t["mint_open"] and not t["verified"]:
        out.append("mint open")
    if t["top10"] > 0.5 and t["trades"] >= 10 and not t["verified"]:
        out.append("top-heavy")
    if t["sells"] >= t["buys"] * 1.5 and t["trades"] >= 30:
        out.append("sellers lead")
    if t["buys"] >= t["sells"] * 1.5 and t["trades"] >= 30:
        out.append("buyers lead")
    if t["accel"] >= 2 and t["trades"] >= 20:
        out.append("heating")
    if fresh > 0.5 and t["traders"] >= 20:
        out.append("new holders")
    if t["accel"] <= 0.45 and t["trades"] >= 25:
        out.append("cooling")
    return out


def snapshot(top: int = 12) -> dict:
    """One reading of the tape: the busiest tokens and how they are trading."""
    now_ms = int(time.time() * 1000)
    seen: dict[str, dict] = {}
    slot = 0
    for feed in FEEDS:
        for raw in _get(feed):
            row = to_row(raw, now_ms)
            if row is None or row["address"] in seen:
                continue
            slot = max(slot, row.pop("_slot"))
            if row["trades"] > 0:   # no trade in the window is not "moving"
                seen[row["address"]] = row
        time.sleep(1)

    rows = sorted(seen.values(), key=lambda r: -r["per_min"])
    for r in rows:
        r["flags"] = flags(r)
    return {
        "block": slot,
        "window_seconds": WINDOW_SECONDS,
        "trades_total": sum(r["trades"] for r in rows),
        "traders_total": sum(r["traders"] for r in rows),
        "tokens_moving": len(rows),
        "tokens": rows[:top],
    }


if __name__ == "__main__":
    print(json.dumps(snapshot(), indent=1))
