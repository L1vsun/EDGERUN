"""Export the connectome to compact files the browser can load (no server, no Python).

Writes to frontend/public/brain/:
  connectome.bin.gz  gzip of: u32 N, u32 S, u32 offsets[N+1], u32 post_delta[S], i16 weight[S]
                     (CSR by presynaptic neuron; post ids delta-coded within each neuron's list)
  positions.bin      u16 x,y,z per neuron, one common scale (aspect preserved), centred in 0..65535
  classes.bin        u8 per neuron: index into groups.json "classes"
  groups.json        neuron-index lists for input channels and readouts, plus metadata
"""
import gzip
import json
from pathlib import Path

import numpy as np
import pandas as pd

import atlas
from run import DATA, PUBLISHED

comp = pd.read_csv(DATA / "Completeness_783.csv", index_col=0)
con = pd.read_parquet(DATA / "Connectivity_783.parquet")
N = len(comp)
pre = con["Presynaptic_Index"].to_numpy(np.int64)
post = con["Postsynaptic_Index"].to_numpy(np.int64)
w = con["Excitatory x Connectivity"].to_numpy()
print("synapse rows:", len(w), " weight range:", w.min(), w.max(), " non-integer:", int((w != np.round(w)).sum()))
assert np.abs(w).max() < 32767 and (w == np.round(w)).all()

order = np.lexsort((post, pre))
pre, post, w = pre[order], post[order], w[order].astype("<i2")
counts = np.bincount(pre, minlength=N)
offsets = np.concatenate([[0], np.cumsum(counts)]).astype("<u4")
delta = np.diff(post, prepend=0)
starts = offsets[:-1][counts > 0].astype(np.int64)
delta[starts] = post[starts]                     # first edge of each list is absolute
assert delta.min() >= 0
delta = delta.astype("<u4")

blob = np.array([N, len(w)], "<u4").tobytes() + offsets.tobytes() + delta.tobytes() + w.tobytes()
PUBLISHED.mkdir(parents=True, exist_ok=True)
with gzip.open(PUBLISHED / "connectome.bin.gz", "wb", compresslevel=9) as f:
    f.write(blob)
print(f"connectome: raw {len(blob)/1e6:.1f} MB -> gz {(PUBLISHED/'connectome.bin.gz').stat().st_size/1e6:.1f} MB")

ann = pd.read_csv(DATA / "annotations.tsv", sep="\t", low_memory=False,
                  usecols=["root_id", "super_class", "cell_class", "cell_sub_class", "pos_x", "pos_y", "pos_z"])
ann = ann.set_index("root_id").reindex(comp.index)
xyz = ann[["pos_x", "pos_y", "pos_z"]].to_numpy(float)
print("neurons without position:", int(np.isnan(xyz).any(axis=1).sum()))
lo, hi = np.nanmin(xyz, axis=0), np.nanmax(xyz, axis=0)
q = np.nan_to_num((xyz - (lo + hi) / 2) / (hi - lo).max() + 0.5, nan=0.5)   # one scale for all axes: keeps the real shape
(PUBLISHED / "positions.bin").write_bytes((q * 65535).round().astype("<u2").tobytes())

classes = ["other", "sensory", "central", "optic", "motor", "descending", "ascending", "endocrine"]
sc = ann["super_class"].map({"sensory": 1, "central": 2, "optic": 3, "visual_projection": 3, "visual_centrifugal": 3,
                             "motor": 4, "descending": 5, "ascending": 6, "sensory_ascending": 6, "endocrine": 7}).fillna(0)
(PUBLISHED / "classes.bin").write_bytes(sc.to_numpy("<u1").tobytes())

channels, readouts = atlas.load(DATA)
extra = dict(
    olfactory=atlas._select(ann, dict(super_class="sensory", cell_class="olfactory")),
)
groups = {
    "neurons": N, "synapses": int(len(w)), "classes": classes,
    "channels": {k: v.tolist() for k, v in {**channels, **extra}.items()},
    "readouts": {k: v.tolist() for k, v in readouts.items()},
}
(PUBLISHED / "groups.json").write_text(json.dumps(groups, separators=(",", ":")))
for f in ["connectome.bin.gz", "positions.bin", "classes.bin", "groups.json"]:
    print(f"{f:20} {(PUBLISHED / f).stat().st_size/1e6:7.2f} MB")
print({k: len(v) for k, v in groups["channels"].items()})
