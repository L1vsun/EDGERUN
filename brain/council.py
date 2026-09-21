"""The council: four cortical regions read the chain and argue, a code gate decides.

Why this is a scheduled script and not something the website does: the site is a static
page on GitHub Pages. Anything it can call, a visitor can read, so an API key can never
live there. This runs somewhere trusted (GitHub Actions, your laptop, a cron box), and
publishes its answer as a JSON file the site loads like any other asset.

    ANTHROPIC_API_KEY=... python brain/council.py            # one round
    ANTHROPIC_API_KEY=... python brain/council.py --dry-run  # no API calls, shows the briefing

Regions, in order. Each is an ordinary Claude call with its own prompt from
`brain/council/`; each only sees what its role needs:

    SCOUT      sensory        the chain numbers                  -> what is happening
    SKEPTIC    inhibitory     the same numbers + Scout           -> why it is a trap
    HISTORIAN  hippocampus    the numbers + the run log          -> what followed last time
    SYNTHESIS  association    all three                          -> one call, with confidence
    GATE       basal ganglia  code, not a model                  -> publish or stay silent

The gate is deliberately not a model: the decision to say something out loud is a
threshold on confidence and evidence, and it defaults to silence.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import council_rules
from chain_snapshot import snapshot

HERE = Path(__file__).parent
PROMPTS = HERE / "council"
OUT = HERE.parent / "frontend" / "public" / "brain" / "council.json"
LOG = HERE / "council_log.json"          # what the Historian remembers, committed with the run

MODEL = "claude-opus-5"
MAX_TOKENS = 16000
MIN_CONFIDENCE = 0.55     # below this the gate stays quiet
LOG_KEEP = 40             # rounds of memory handed to the Historian


def briefing(snap: dict) -> str:
    """The shared context every region sees. Identical text for all four calls, so the
    cache can serve it to regions 2-4 after region 1 writes it."""
    lines = [
        "# Robinhood Chain, right now",
        f"block {snap['block']} · window {snap['window_seconds']}s · "
        f"{snap['transfers_total']} transfers · {snap['wallets_total']} wallets · "
        f"{snap['tokens_moving']} tokens moved",
        "",
        "Busiest tokens in the window. `one_addr_share` is the fraction of this token's",
        "transfers that the single busiest address appears in. `accel` is the last ~15s",
        "rate over the window rate. `flags` are fixed thresholds, not opinions.",
        "",
    ]
    for t in snap["tokens"]:
        lines.append(
            f"- {t['symbol']}  transfers={t['transfers']} per_min={t['per_min']} "
            f"wallets={t['wallets']} one_addr_share={t['one_addr_share']} accel={t['accel']} "
            f"mints={t['mints']} burns={t['burns']} swaps={t['swaps']} "
            f"flags={','.join(t['flags']) or 'none'}"
        )
    lines += [
        "",
        "You cannot see price, liquidity, or holders - only what is above. A window this",
        "short makes small numbers meaningless; treat anything under ~20 transfers as noise.",
    ]
    return "\n".join(lines)


def ask(client, region: str, shared: str, task: str) -> tuple[dict, dict]:
    """One region speaks. Returns (parsed json, usage)."""
    import anthropic
    system = [
        {"type": "text", "text": shared, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": (PROMPTS / f"cortex_{region}.md").read_text()},
    ]
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=system,
            messages=[{"role": "user", "content": task}],
        )
    except anthropic.RateLimitError as exc:
        return {"error": f"rate limited: {exc}"}, {}
    except anthropic.APIStatusError as exc:
        return {"error": f"api {exc.status_code}: {exc.message}"}, {}
    except anthropic.APIConnectionError as exc:
        return {"error": f"network: {exc}"}, {}

    if resp.stop_reason == "refusal":
        return {"error": "the model declined this request"}, {}

    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    usage = {
        "in": resp.usage.input_tokens,
        "out": resp.usage.output_tokens,
        "cache_read": getattr(resp.usage, "cache_read_input_tokens", 0) or 0,
        "cache_write": getattr(resp.usage, "cache_creation_input_tokens", 0) or 0,
    }
    if resp.stop_reason == "max_tokens":
        return {"error": "ran out of output tokens"}, usage

    # the prompts ask for bare JSON; tolerate a fenced block around it
    body = text
    if body.startswith("```"):
        body = body.split("```")[1].removeprefix("json").strip()
    try:
        return json.loads(body), usage
    except json.JSONDecodeError:
        return {"error": "did not return usable JSON", "raw": text[:400]}, usage


def gate(synth: dict, snap: dict) -> dict:
    """Code, not a model. Silence is the default and needs no justification."""
    if "error" in synth:
        return {"action": "SILENCE", "why": "synthesis failed: " + str(synth["error"])[:120]}
    conf = synth.get("confidence")
    conf = float(conf) if isinstance(conf, (int, float)) else 0.0
    focus = synth.get("focus")
    row = next((t for t in snap["tokens"] if t["symbol"] == focus), None)
    if conf < MIN_CONFIDENCE:
        return {"action": "SILENCE", "why": f"confidence {conf:.2f} is under the {MIN_CONFIDENCE} bar"}
    if row is None:
        return {"action": "SILENCE", "why": "synthesis named a token that is not in the window"}
    if row["transfers"] < 20:
        return {"action": "SILENCE", "why": f"{focus} has only {row['transfers']} transfers - too few to stand behind"}
    return {"action": "SPEAK", "why": f"confidence {conf:.2f} on {focus}, {row['transfers']} transfers behind it"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="build the briefing, call nothing")
    ap.add_argument("--rules", action="store_true",
                    help="run the regions by rule instead of by model: no API key, no cost, "
                         "same data and same output shape (see council_rules.py)")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    snap = snapshot()
    shared = briefing(snap)
    if args.dry_run:
        print(shared)
        return 0

    log = json.loads(LOG.read_text()) if LOG.exists() else []

    if args.rules:
        return write_round(snap, council_rules.run(snap, log), log,
                           mode="rules", model="rule-based", usage={"in": 0, "out": 0, "cache_read": 0, "cache_write": 0},
                           out=Path(args.out))

    import anthropic  # only needed on the model path
    client = anthropic.Anthropic()
    regions, usage_total = {}, {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0}

    def run(region: str, task: str):
        out, usage = ask(client, region, shared, task)
        regions[region] = out
        for k in usage_total:
            usage_total[k] += usage.get(k, 0)
        print(f"  {region:10} {'ERROR: ' + str(out['error'])[:60] if 'error' in out else 'ok'}", flush=True)
        return out

    print(f"council round · block {snap['block']} · {len(snap['tokens'])} tokens")
    scout = run("scout", "Report what is happening on the chain right now.")
    run("skeptic", "Scout reported:\n" + json.dumps(scout, indent=1) + "\n\nArgue the bear case.")
    history = json.dumps(log[-LOG_KEEP:], indent=1) if log else "(the log is empty - this is an early run)"
    run("historian", f"Previous rounds, oldest first:\n{history}\n\nWhat precedent applies now?")
    synth = run("synthesis",
                "scout: " + json.dumps(regions.get("scout"), indent=1) +
                "\n\nskeptic: " + json.dumps(regions.get("skeptic"), indent=1) +
                "\n\nhistorian: " + json.dumps(regions.get("historian"), indent=1) +
                "\n\nGive the one call.")

    return write_round(snap, regions | {"synthesis": synth}, log, mode="live", model=MODEL,
                       usage=usage_total, out=Path(args.out))


def write_round(snap, regions, log, *, mode, model, usage, out) -> int:
    synth = regions.get("synthesis", {})
    decision = gate(synth, snap)
    cost = round(usage["in"] * 5e-6 + usage["out"] * 25e-6
                 + usage["cache_read"] * 0.5e-6 + usage["cache_write"] * 6.25e-6, 4)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    result = {
        "mode": mode,                      # "rules" or "live" - the page says which
        "generated_at": now,
        "model": model,
        "block": snap["block"],
        "window_seconds": snap["window_seconds"],
        "chain": {k: snap[k] for k in ("transfers_total", "wallets_total", "tokens_moving")},
        "tokens": snap["tokens"],
        "regions": [
            {"id": "scout", "name": "Scout", "region": "sensory cortex", "says": regions.get("scout")},
            {"id": "skeptic", "name": "Skeptic", "region": "inhibitory prefrontal", "says": regions.get("skeptic")},
            {"id": "historian", "name": "Historian", "region": "hippocampus", "says": regions.get("historian")},
            {"id": "synthesis", "name": "Synthesis", "region": "association cortex", "says": synth},
        ],
        "gate": decision,
        "usage": usage | {"usd": cost},
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=1))

    log.append({
        "at": now, "block": snap["block"], "mode": mode,
        "call": synth.get("call") if isinstance(synth, dict) else None,
        "focus": synth.get("focus") if isinstance(synth, dict) else None,
        "confidence": synth.get("confidence") if isinstance(synth, dict) else None,
        "action": decision["action"],
        "tokens": [{"symbol": t["symbol"], "per_min": t["per_min"], "wallets": t["wallets"],
                    "one_addr_share": t["one_addr_share"], "flags": t["flags"]} for t in snap["tokens"][:8]],
    })
    LOG.write_text(json.dumps(log[-400:], indent=1))

    print(f"gate: {decision['action']} - {decision['why']}")
    if mode == "live":
        print(f"cost: ${cost} (in {usage['in']}, out {usage['out']}, "
              f"cache read {usage['cache_read']}, written {usage['cache_write']})")
    print(f"wrote {out} [{mode}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
