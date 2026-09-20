"""Snapshot real Robinhood Chain scan results into brain/data/events.json.

The live backend's DB is ephemeral (see STATE.md), so replay needs its own
capture. Each event is one real scan of one real contract, nothing synthetic.
Run with the edgerun venv:  ../edgerun/.venv/bin/python collect_events.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "edgerun"))
from edgerun.blockscout import BlockscoutClient
from edgerun.config import load_config
from edgerun.scan import scan_address

MAX = int(sys.argv[1]) if len(sys.argv) > 1 else 40
cfg = load_config()
bs = BlockscoutClient(cfg.explorer_base)

addrs = []
for item in bs.newest_smart_contracts(MAX):
    a = (item.get("address") or {}).get("hash")
    if a:
        addrs.append(a)
for item in bs.newest_tokens(MAX):
    a = item.get("address_hash")
    if a and a not in addrs:
        addrs.append(a)

events = []
for a in addrs[:MAX]:
    try:
        r = scan_address(a, cfg).to_dict()
    except Exception as exc:
        print("skip", a, exc)
        continue
    failed = [c["id"] for c in (r["contract"]["checks"] + r["impersonation"]["checks"]) if c["status"] == "fail"]
    events.append({
        "address": a,
        "symbol": r.get("token_symbol"),
        "name": r.get("token_name"),
        "verdict": r["verdict"],
        "failed_checks": failed,
        "scanned_at": r["scanned_at"],
    })
    print(f"{r['verdict']:8} {r.get('token_symbol')!s:10} {failed}")

events.sort(key=lambda e: e["scanned_at"])
out = Path(__file__).parent / "data" / "events.json"
out.write_text(json.dumps(events, indent=1))
print(f"wrote {len(events)} events -> {out}")
