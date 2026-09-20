"""Replay real scan events through the fly brain and print the public trace.

  python run.py [--batch 4] [--dur 300] [--rest 3]

Pipeline per cycle:  events -> sensory channels -> real brain + shuffled control
-> rule-based read -> gate. The gate decides from scan facts only; the brain's
output is recorded in the trace with weight 0 (see gate()).
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import atlas
from fly import Fly

HERE = Path(__file__).parent
PUBLISHED = HERE.parent / "frontend" / "public" / "brain"   # the site imports these at build time
DATA = HERE / "data" / "fly"
HZ_PER_EVENT, HZ_MAX = 40, 160          # arbitrary knob: stimulus rate per event, capped near the paper's 150 Hz
SHUFFLE_SEED = 1


def sense(events):
    """Scan verdict -> sensory channel rates. CAUTION and unresolved stay silent."""
    n_pass = sum(e["verdict"] == "PASS" for e in events)
    n_fail = sum(e["verdict"] == "FAIL" for e in events)
    rates = {}
    if n_pass:
        rates["sweet"] = min(n_pass * HZ_PER_EVENT, HZ_MAX)
    if n_fail:
        rates["bitter"] = min(n_fail * HZ_PER_EVENT, HZ_MAX)
    return rates


def readout(counts, groups, dur_ms):
    out = {k: round(float(counts[v].sum()) / len(v) / (dur_ms / 1000), 2) for k, v in groups.items()}
    out["active_neurons"] = int((counts > 0).sum())
    return out


def gate(events, brain, control):
    """Action selection. Code, not a model. Default is silence.

    ALERT only when a scan in the window FAILED a check (a fact). The fly's
    readout is attached to the trace but carries weight 0: nothing shows it
    predicts anything, so it may not move a decision.
    """
    flagged = [e for e in events if e["verdict"] == "FAIL"]
    return {
        "action": "ALERT" if flagged else "SILENCE",
        "because": [f"{e['symbol']} failed {','.join(e['failed_checks'])}" for e in flagged],
        "brain_weight": 0,
        "brain_vs_control_active": [brain["active_neurons"], control["active_neurons"]],
    }


def read(events, brain):
    n_pass = sum(e["verdict"] == "PASS" for e in events)
    n_fail = sum(e["verdict"] == "FAIL" for e in events)
    groups = {k: v for k, v in brain.items() if k not in ("active_neurons", "rates_hz")}
    top = max(groups, key=groups.get)
    return (f"{n_pass} clear, {n_fail} flagged. Strongest brain output: {top} "
            f"({groups[top]} Hz). Biological response, not a forecast.")


def replay(args, channels, readouts, seed):
    f = Fly(DATA, channels, shuffle_seed=seed)
    trace = []
    batches = [args.events[i:i + args.batch] for i in range(0, len(args.events), args.batch)]
    batches += [[] for _ in range(args.rest)]
    for evs in batches:
        rates = sense(evs)
        counts = f.cycle(rates, args.dur)
        trace.append({"rates_hz": rates, **readout(counts, readouts, args.dur)})
    return trace, {"neurons": f.n, "synapses": f.n_synapses}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", default=str(HERE / "data" / "events.json"))
    ap.add_argument("--batch", type=int, default=4, help="events per brain cycle")
    ap.add_argument("--dur", type=int, default=300, help="brain time per cycle, ms")
    ap.add_argument("--rest", type=int, default=3, help="silent cycles appended at the end")
    ap.add_argument("--out", default=str(PUBLISHED / "trace.json"), help="default is the file the website reads")
    args = ap.parse_args()
    args.events = json.loads(Path(args.events).read_text())

    channels, readouts = atlas.load(DATA)
    print("input channels :", {k: len(v) for k, v in channels.items()}, "neurons")
    print("readout groups :", {k: len(v) for k, v in readouts.items()}, "neurons\n")

    real, size = replay(args, channels, readouts, None)
    ctrl, _ = replay(args, channels, readouts, SHUFFLE_SEED)

    trace = []
    print(f"{'cyc':>3} {'in(Hz)':>14} {'feeding':>8} {'head':>6} {'desc':>6} {'active':>7} | "
          f"{'ctrl feed':>9} {'ctrl act':>8} | gate")
    for i, (b, c) in enumerate(zip(real, ctrl)):
        evs = args.events[i * args.batch:(i + 1) * args.batch]
        g = gate(evs, b, c)
        trace.append({"cycle": i, "events": evs, "sense": b["rates_hz"], "brain": b, "control": c,
                      "read": read(evs, b), "gate": g})
        inp = "/".join(f"{k[0]}{int(v)}" for k, v in b["rates_hz"].items()) or "rest"
        print(f"{i:>3} {inp:>14} {b['feeding']:>8} {b['head']:>6} {b['descending']:>6} "
              f"{b['active_neurons']:>7} | {c['feeding']:>9} {c['active_neurons']:>8} | "
              f"{g['action']} {'; '.join(g['because'])}")
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **size,
        "channels": {k: len(v) for k, v in channels.items()},
        "readouts": {k: len(v) for k, v in readouts.items()},
        "batch": args.batch, "dur_ms": args.dur, "rest_cycles": args.rest,
        "hz_per_event": HZ_PER_EVENT, "hz_max": HZ_MAX, "shuffle_seed": SHUFFLE_SEED,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps({"meta": meta, "cycles": trace}, indent=1))
    print(f"\ntrace -> {args.out}")


if __name__ == "__main__":
    main()
