"""Controlled input experiment: does bitter input change the brain's output when
the sweet drive is held FIXED? Each trial starts from a fresh brain (no carry-over
state) and runs one cycle; trials differ only in Poisson noise.

  python experiment.py [--trials 5] [--dur 300]
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

import atlas
from fly import Fly
from run import DATA, PUBLISHED

CONDITIONS = {                       # channel rates, Hz
    "sweet 120":            {"sweet": 120},
    "sweet 120 + bitter 40": {"sweet": 120, "bitter": 40},
    "sweet 120 + bitter 80": {"sweet": 120, "bitter": 80},
    "bitter 80":            {"bitter": 80},
}

ap = argparse.ArgumentParser()
ap.add_argument("--trials", type=int, default=5)
ap.add_argument("--dur", type=int, default=300)
ap.add_argument("--out", default=str(PUBLISHED / "experiment.json"), help="default is the file the website reads")
args = ap.parse_args()
channels, readouts = atlas.load(DATA)

results = []
print(f"{'condition':<24}" + "".join(f"{k:>16}" for k in readouts) + f"{'active':>14}   (mean ± sd over {args.trials} fresh brains)")
for name, rates in CONDITIONS.items():
    rows = []
    for _ in range(args.trials):
        counts = Fly(DATA, channels).cycle(rates, args.dur)
        rows.append([counts[v].sum() / len(v) / (args.dur / 1000) for v in readouts.values()] + [(counts > 0).sum()])
    m, s = np.mean(rows, axis=0), np.std(rows, axis=0)
    keys = list(readouts) + ["active_neurons"]
    results.append({"name": name, "rates_hz": rates, "mean": dict(zip(keys, m.round(2).tolist())), "sd": dict(zip(keys, s.round(2).tolist()))})
    print(f"{name:<24}" + "".join(f"{m[i]:>10.1f}±{s[i]:<5.1f}" for i in range(len(readouts))) + f"{m[-1]:>9.0f}±{s[-1]:<4.0f}", flush=True)

Path(args.out).parent.mkdir(parents=True, exist_ok=True)
Path(args.out).write_text(json.dumps({
    "meta": {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
             "trials": args.trials, "dur_ms": args.dur, "readouts": {k: len(v) for k, v in readouts.items()}},
    "conditions": results}, indent=1))
print("wrote", args.out)
