"""Export the fly's olfactory learning circuit for the browser.

Not the whole brain: the real ORN -> PN -> Kenyon cell -> MBON pathway plus the APL
feedback neuron and the dopaminergic neurons - the circuit that actually classifies
odours in a fly. ~9.5k neurons, 88% of whose input edges are internal to it.

Writes frontend/public/brain/mb.bin.gz:
  u32 N, u32 S, u8 layer[N], u16 x[N], u16 y[N], u16 z[N], u32 offsets[N+1], u32 post_delta[S], i16 weight[S]
plus mb.json with the layer names, glomerulus grouping of the ORNs and counts.
"""
import gzip
import json

import numpy as np
import pandas as pd

from run import DATA, PUBLISHED

LAYERS = ["ORN", "ALLN", "PN", "KC", "MBON", "DAN", "LH", "APL"]
BY_CLASS = {"ORN": ["olfactory"], "ALLN": ["ALLN"], "PN": ["ALPN"], "KC": ["Kenyon_Cell"],
            "MBON": ["MBON"], "DAN": ["DAN", "MBIN"], "LH": ["LHLN"]}

comp = pd.read_csv(DATA / "Completeness_783.csv", index_col=0)
ann = pd.read_csv(DATA / "annotations.tsv", sep="\t", low_memory=False,
                  usecols=["root_id", "cell_class", "cell_type", "side", "pos_x", "pos_y", "pos_z"]).set_index("root_id").reindex(comp.index)

groups = {k: np.flatnonzero(ann.cell_class.isin(v).values) for k, v in BY_CLASS.items()}
groups["APL"] = np.flatnonzero(ann.cell_type.astype(str).str.contains("APL", na=False).values)
sel = np.unique(np.concatenate([groups[k] for k in LAYERS]))
pos = {n: i for i, n in enumerate(sel)}
layer = np.zeros(len(sel), "u1")
for li, k in enumerate(LAYERS):
    for n in groups[k]:
        layer[pos[n]] = li

con = pd.read_parquet(DATA / "Connectivity_783.parquet")
keep = np.isin(con["Presynaptic_Index"].values, sel) & np.isin(con["Postsynaptic_Index"].values, sel)
sub = con[keep]
pre = sub["Presynaptic_Index"].map(pos).to_numpy(np.int64)
post = sub["Postsynaptic_Index"].map(pos).to_numpy(np.int64)
w = sub["Excitatory x Connectivity"].to_numpy()
assert np.abs(w).max() < 32767 and (w == np.round(w)).all()

order = np.lexsort((post, pre))
pre, post, w = pre[order], post[order], w[order].astype("<i2")
counts = np.bincount(pre, minlength=len(sel))
offsets = np.concatenate([[0], np.cumsum(counts)]).astype("<u4")
delta = np.diff(post, prepend=0)
starts = offsets[:-1][counts > 0].astype(np.int64)
delta[starts] = post[starts]
assert delta.min() >= 0

# Real anatomy in 3-D: the browser rotates it, so the mushroom body calyx, the antennal
# lobe and the lobes read as the shapes they actually are. Normalised into 0..1 on one
# shared scale so proportions survive; a neuron with no recorded soma sits at the median.
VOX = np.array([4.0, 4.0, 40.0])                  # FlyWire voxels are 4x4x40 nm: z is 10x coarser
all_xyz = ann[["pos_x", "pos_y", "pos_z"]].to_numpy(float) * VOX
for c in range(3):
    col = all_xyz[:, c]
    col[np.isnan(col)] = np.nanmedian(col)
    all_xyz[:, c] = col
# one transform for both files, derived from the WHOLE brain, so the circuit sits inside
# the shell exactly where it really is
lo, hi = all_xyz.min(0), all_xyz.max(0)
scale = float((hi - lo).max())
norm = lambda a: np.clip((a - (lo + hi) / 2) / scale + 0.5, 0, 1)
q = norm(all_xyz[sel])
X, Y, Z = q[:, 0], q[:, 1], q[:, 2]

blob = (np.array([len(sel), len(w)], "<u4").tobytes() + layer.tobytes()
        + (X * 65535).round().astype("<u2").tobytes() + (Y * 65535).round().astype("<u2").tobytes()
        + (Z * 65535).round().astype("<u2").tobytes()
        + offsets.tobytes() + delta.astype("<u4").tobytes() + w.tobytes())
PUBLISHED.mkdir(parents=True, exist_ok=True)
with gzip.open(PUBLISHED / "mb.bin.gz", "wb", compresslevel=9) as f:
    f.write(blob)

# the 53 real glomeruli: each is a named group of sensory neurons, the fly's input channels
glom = ann.cell_type.astype(str).str.extract(r"^ORN_(\w+?)$")[0]
gl = {}
for i in groups["ORN"]:
    g = glom.iloc[i]
    if isinstance(g, str) and g != "nan":
        gl.setdefault(g, []).append(int(pos[i]))
# the rest of the brain, thinned to a silhouette the circuit can sit inside
rest = np.setdiff1d(np.arange(len(comp)), sel)
rng = np.random.default_rng(7)
keep = rng.choice(rest, size=min(26000, len(rest)), replace=False)
sq = norm(all_xyz[keep])
shell = (np.array([len(keep)], "<u4").tobytes()
         + (sq[:, 0] * 65535).round().astype("<u2").tobytes()
         + (sq[:, 1] * 65535).round().astype("<u2").tobytes()
         + (sq[:, 2] * 65535).round().astype("<u2").tobytes())
with gzip.open(PUBLISHED / "shell.bin.gz", "wb", compresslevel=9) as f:
    f.write(shell)
print(f"shell: {len(keep)} neurons  gz {(PUBLISHED/'shell.bin.gz').stat().st_size/1e6:.2f} MB")

meta = {"layers": LAYERS, "shell": int(len(keep)), "neurons": int(len(sel)), "synapses": int(len(w)),
        "counts": {k: int((layer == li).sum()) for li, k in enumerate(LAYERS)},
        "glomeruli": dict(sorted(gl.items()))}
(PUBLISHED / "mb.json").write_text(json.dumps(meta, separators=(",", ":")))
print(f"neurons {len(sel)}  edges {len(w)}  raw {len(blob)/1e6:.2f} MB  gz {(PUBLISHED/'mb.bin.gz').stat().st_size/1e6:.2f} MB")
print(meta["counts"])
