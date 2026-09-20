// Regression test for frontend/public/brain/sim-core.js — needs no data files. Run: node brain/test_sim_core.js
// Golden values come from Brian2 running the paper's equations on the same two-neuron network:
// neuron 0 is held at g = 50 mV every step and drives neuron 1 through a 100-synapse excitatory edge.
// It pins exact integration, the 1.8 ms synaptic delay and the 2.2 ms refractory period.
const assert = require("assert");
const { Sim } = require("../frontend/public/brain/sim-core.js");

const conn = { N: 2, S: 1, offsets: new Uint32Array([0, 1, 1]), post: new Int32Array([1]), w: new Int16Array([100]) };
const sim = new Sim(conn, {});
const spikes = { 0: [], 1: [] };
for (let k = 0; k < 1500; k++) {
  sim.g[0] = 50; sim._touch(0);
  const t = sim.t;
  for (const i of sim.step(1)) spikes[i].push(t);
}
assert.deepStrictEqual(spikes[0].slice(0, 8), [30, 82, 134, 186, 238, 290, 342, 394]);
assert.deepStrictEqual(spikes[1].slice(0, 8), [128, 232, 336, 440, 544, 648, 752, 856]);

// a quiet brain stays quiet, and a parked neuron costs nothing per step
const idle = new Sim(conn, {});
assert.strictEqual(idle.step(5000).length, 0);
assert.strictEqual(idle.nAct, 0);
console.log("sim-core: ok");
