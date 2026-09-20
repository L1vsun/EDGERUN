"""Which real neurons are inputs and which are readouts, from FlyWire's
neuron annotations (release 783). Groups are positions in the simulation's
neuron order (the row order of Completeness_783.csv)."""
import numpy as np
import pandas as pd

# Input channels. VALENCE mapping (sweet = good, bitter = bad) is a design
# choice; the neuron sets themselves are real annotated sensory neurons.
CHANNELS = {
    "sweet":  dict(super_class="sensory", cell_class="gustatory", cell_sub_class="sugar/water"),
    "bitter": dict(super_class="sensory", cell_class="gustatory", cell_sub_class="bitter"),
    "jolt":   dict(super_class="sensory", cell_class="mechanosensory"),
}
# Readouts: motor and descending neurons, i.e. the brain's outputs.
READOUTS = {
    "feeding": dict(super_class="motor", cell_sub_class=[
        "ingestion_motor_neuron", "proboscis_motor_neuron", "haustellum_motor_neuron",
        "salivary_motor_neuron", "crop_motor_neuron"]),
    "head":    dict(super_class="motor", cell_sub_class=["neck_motor_neuron", "eye_motor_neuron", "antennal_motor_neuron"]),
    "descending": dict(super_class="descending"),
}


def _select(ann, spec):
    m = np.ones(len(ann), dtype=bool)
    for col, want in spec.items():
        m &= ann[col].isin(want if isinstance(want, list) else [want]).values
    return np.flatnonzero(m)


def load(data_dir):
    comp = pd.read_csv(f"{data_dir}/Completeness_783.csv", index_col=0)
    ann = pd.read_csv(f"{data_dir}/annotations.tsv", sep="\t", low_memory=False,
                      usecols=["root_id", "super_class", "cell_class", "cell_sub_class"])
    ann = ann.set_index("root_id").reindex(comp.index)  # sim order; unannotated -> NaN
    channels = {k: _select(ann, v) for k, v in CHANNELS.items()}
    readouts = {k: _select(ann, v) for k, v in READOUTS.items()}
    for k, v in {**channels, **readouts}.items():
        assert len(v), f"empty neuron group: {k}"
    return channels, readouts
