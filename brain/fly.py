"""The brain: the FlyWire adult Drosophila connectome as a leaky integrate-and-fire
network, built once and kept in memory so input channels can be switched between
short cycles.

Equations and constants are from Shiu et al. (MIT, github.com/philshiu/
Drosophila_brain_model). Deliberate difference: the paper drives target neurons
with a fixed-rate PoissonInput; here a PoissonGroup + one-to-one synapse does the
same job (each event pushes v over threshold) but its rates can be changed
between run() calls. `shuffle_seed` builds the control brain: identical neurons,
identical synapse count/weights, in- and out-degree per neuron preserved, but
each synapse's target reassigned at random.
"""
from pathlib import Path

import numpy as np
import pandas as pd
import brian2
from brian2 import Hz, Network, NeuronGroup, PoissonGroup, SpikeMonitor, Synapses, mV, ms

brian2.prefs.codegen.target = "cython"  # numpy backend is ~45x slower

P = dict(
    v_0=-52 * mV, v_rst=-52 * mV, v_th=-45 * mV,
    t_mbr=20 * ms, tau=5 * ms, t_rfc=2.2 * ms, t_dly=1.8 * ms,
    w_syn=0.275 * mV, f_poi=250,
)
EQS = """
dv/dt = (v_0 - v + g) / t_mbr : volt (unless refractory)
dg/dt = -g / tau              : volt (unless refractory)
rfc                           : second
"""


class Fly:
    def __init__(self, data_dir, channels, shuffle_seed=None):
        """channels: {name: array of neuron indices (positions in the sim)}"""
        data_dir = Path(data_dir)
        comp = pd.read_csv(data_dir / "Completeness_783.csv", index_col=0)
        con = pd.read_parquet(data_dir / "Connectivity_783.parquet")
        pre = con["Presynaptic_Index"].values
        post = con["Postsynaptic_Index"].values
        w = con["Excitatory x Connectivity"].values
        if shuffle_seed is not None:
            post = np.random.default_rng(shuffle_seed).permutation(post)

        self.n = len(comp)
        self.n_synapses = len(pre)
        self.neu = NeuronGroup(self.n, EQS, method="linear", threshold="v > v_th",
                               reset="v = v_rst; g = 0 * mV", refractory="rfc",
                               namespace=P, name="neurons")
        self.neu.v = P["v_0"]
        self.neu.g = 0
        self.neu.rfc = P["t_rfc"]
        syn = Synapses(self.neu, self.neu, "w : volt", on_pre="g += w",
                       delay=P["t_dly"], name="synapses")
        syn.connect(i=pre, j=post)
        syn.w = w * P["w_syn"]

        # one Poisson source per input neuron; per-channel slices set rates later
        self._slices, targets, start = {}, [], 0
        for name, idx in channels.items():
            self._slices[name] = slice(start, start + len(idx))
            targets.append(np.asarray(idx))
            start += len(idx)
        targets = np.concatenate(targets)
        self.neu.rfc[targets] = 0 * ms  # no refractory period for driven neurons
        self._pg = PoissonGroup(len(targets), rates=np.zeros(len(targets)) * Hz)
        inp = Synapses(self._pg, self.neu, on_pre="v += w_syn * f_poi", namespace=P)
        inp.connect(i=np.arange(len(targets)), j=targets)

        self._mon = SpikeMonitor(self.neu, record=False)  # counts only
        self._net = Network(self.neu, syn, self._pg, inp, self._mon)
        self._prev = np.zeros(self.n, dtype=np.int64)

    def cycle(self, rates_hz, dur_ms):
        """Set channel rates (Hz, missing = 0), run dur_ms, return spikes per neuron."""
        r = np.zeros(len(self._pg))
        for name, hz in rates_hz.items():
            r[self._slices[name]] = hz
        self._pg.rates = r * Hz
        self._net.run(dur_ms * ms)
        total = np.array(self._mon.count, dtype=np.int64)
        out, self._prev = total - self._prev, total
        return out
