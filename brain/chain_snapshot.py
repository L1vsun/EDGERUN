"""Read the same chain facts the website reads, but from Python.

The browser does this in `frontend/lib/chain.ts`. This is a second implementation for
the scheduled council runs, which have no browser. THRESHOLDS BELOW ARE DUPLICATED FROM
`lib/chain.ts` - if you change one, change the other, or the council will disagree with
the live page for no good reason.
"""
from __future__ import annotations

import json
import math
import time
import urllib.request

RPC = "https://rpc.mainnet.chain.robinhood.com"
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
SWAP_V3 = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
SWAP_V2 = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822"
ZERO = "0x" + "0" * 64
BLOCKS_PER_SEC = 9.0
WINDOW_BLOCKS = 450          # ~50 s; the RPC 429s well before 3,000 blocks


def _rpc(body, tries: int = 4):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(
                RPC, data=json.dumps(body).encode(),
                headers={"content-type": "application/json", "User-Agent": "edgerun-council/1.0"},
            )
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as exc:  # noqa: BLE001 - retry anything the node throws
            last = exc
            time.sleep(2 + 3 * attempt)
    raise RuntimeError(f"RPC unreachable after {tries} tries: {last}")


def _decode_string(hexstr):
    if not hexstr or len(hexstr) < 130:
        return None
    try:
        length = int(hexstr[66:130], 16)
        raw = bytes.fromhex(hexstr[130:130 + length * 2]).decode("utf-8", "replace")
        return "".join(c for c in raw if 32 <= ord(c) < 127).strip() or None
    except Exception:  # noqa: BLE001
        return None


def flags(t: dict) -> list[str]:
    """Same thresholds as lib/chain.ts signals()."""
    out = []
    fresh = t["new_wallets"] / t["wallets"] if t["wallets"] else 0
    if t["mints"] >= 4 and t["mints"] > t["burns"] * 3 and t["transfers"] >= 8 and t["mints"] / t["transfers"] > 0.03:
        out.append("printing")
    if t["one_addr_share"] > 0.9 and t["transfers"] >= 10:
        out.append("one wallet")
    if t["swaps"] >= 3:
        out.append("dex live")
    if t["accel"] >= 2 and t["transfers"] >= 20:
        out.append("heating")
    if fresh > 0.65 and t["wallets"] >= 20:
        out.append("fresh wallets")
    if t["accel"] <= 0.45 and t["transfers"] >= 25:
        out.append("cooling")
    return out


def snapshot(top: int = 12) -> dict:
    """One reading of the chain: the busiest tokens and how they are moving."""
    head = int(_rpc({"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []})["result"], 16)
    frm = head - WINDOW_BLOCKS
    hx = lambda n: hex(n)  # noqa: E731

    logs = _rpc({"jsonrpc": "2.0", "id": 1, "method": "eth_getLogs",
                 "params": [{"fromBlock": hx(frm), "toBlock": hx(head), "topics": [TRANSFER]}]}).get("result") or []
    time.sleep(1)
    swaps = []
    for topic in (SWAP_V3, SWAP_V2):
        r = _rpc({"jsonrpc": "2.0", "id": 1, "method": "eth_getLogs",
                  "params": [{"fromBlock": hx(frm), "toBlock": hx(head), "topics": [topic]}]}).get("result") or []
        swaps.extend(r)
        time.sleep(1)

    minutes = WINDOW_BLOCKS / BLOCKS_PER_SEC / 60
    recent_from = head - int(BLOCKS_PER_SEC * 15)   # the last ~15 s, for acceleration

    per: dict[str, dict] = {}
    wallets_all = set()
    for l in logs:
        if len(l["topics"]) != 3:
            continue
        tok = l["address"].lower()
        s = per.setdefault(tok, {"n": 0, "recent": 0, "w": {}, "mints": 0, "burns": 0})
        s["n"] += 1
        if int(l["blockNumber"], 16) >= recent_from:
            s["recent"] += 1
        a, b = l["topics"][1], l["topics"][2]
        if a == ZERO:
            s["mints"] += 1
        elif b == ZERO:
            s["burns"] += 1
        for w in (a, b):
            if w != ZERO:
                s["w"][w] = s["w"].get(w, 0) + 1
                wallets_all.add(w)

    pools = {l["address"].lower() for l in swaps}
    pool_tokens: dict[str, list[str]] = {}
    if pools:
        calls = []
        for i, p in enumerate(list(pools)[:8]):
            calls.append({"jsonrpc": "2.0", "id": f"{i}a", "method": "eth_call", "params": [{"to": p, "data": "0x0dfe1681"}, "latest"]})
            calls.append({"jsonrpc": "2.0", "id": f"{i}b", "method": "eth_call", "params": [{"to": p, "data": "0xd21220a7"}, "latest"]})
        res = {x["id"]: x.get("result") for x in _rpc(calls)}
        for i, p in enumerate(list(pools)[:8]):
            toks = ["0x" + res[k][-40:] for k in (f"{i}a", f"{i}b") if res.get(k)]
            pool_tokens[p] = toks
        time.sleep(1)
    swaps_per_token: dict[str, int] = {}
    pools_per_token: dict[str, set] = {}
    for l in swaps:
        pool = l["address"].lower()
        for t in pool_tokens.get(pool, []):
            swaps_per_token[t] = swaps_per_token.get(t, 0) + 1
            pools_per_token.setdefault(t, set()).add(pool)
    # A token that sits on one side of several different pools is the thing everything
    # else is priced against (WETH, a stable) - plumbing, not an opportunity.
    quote_assets = {t for t, ps in pools_per_token.items() if len(ps) >= 2}

    rows = []
    for addr, s in per.items():
        top_wallet = max(s["w"].values()) if s["w"] else 0
        per_min = s["n"] / minutes
        recent_rate = s["recent"] / (15 / 60)
        rows.append({
            "address": addr, "symbol": addr[:8],
            "transfers": s["n"], "per_min": round(per_min, 1),
            "wallets": len(s["w"]), "new_wallets": 0,   # needs history between runs; see council.py
            "mints": s["mints"], "burns": s["burns"],
            "swaps": swaps_per_token.get(addr, 0),
            "one_addr_share": round(min(1.0, top_wallet / s["n"]) if s["n"] else 0, 2),
            "accel": round(recent_rate / per_min, 2) if per_min > 0 else 1.0,
            "quote_asset": addr in quote_assets,
        })
    rows.sort(key=lambda r: -r["per_min"])
    rows = rows[:top]

    # names, for the busiest only
    if rows:
        calls = [{"jsonrpc": "2.0", "id": i, "method": "eth_call",
                  "params": [{"to": r["address"], "data": "0x95d89b41"}, "latest"]} for i, r in enumerate(rows)]
        res = {x["id"]: x.get("result") for x in _rpc(calls)}
        for i, r in enumerate(rows):
            r["symbol"] = _decode_string(res.get(i)) or r["address"][:8]
    for r in rows:
        r["flags"] = flags(r)

    return {
        "block": head,
        "window_seconds": round(WINDOW_BLOCKS / BLOCKS_PER_SEC),
        "transfers_total": len(logs),
        "wallets_total": len(wallets_all),
        "tokens_moving": len(per),
        "tokens": rows,
    }


if __name__ == "__main__":
    print(json.dumps(snapshot(), indent=1))
