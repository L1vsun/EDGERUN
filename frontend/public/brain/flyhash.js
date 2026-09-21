/* The fly's olfactory circuit as a similarity engine, running in the browser.
 *
 * Wiring is the real connectome (FlyWire 783): 53 glomeruli -> projection neurons ->
 * 5,177 Kenyon cells. The Kenyon layer keeps only its strongest ~5% (this is what the
 * APL neuron does biologically), which turns any input into a sparse code.
 * Two similar inputs get overlapping codes; unrelated ones barely overlap. That is the
 * published FlyHash result (Dasgupta, Stevens & Navlakha, Science 2017) run on the real
 * wiring rather than a random matrix.
 *
 * Nothing here predicts anything. It measures how alike two activity patterns are. */
(function (root) {
  const SPARSITY = 0.05;

  function decode(buf) {
    const h = new Uint32Array(buf, 0, 2), N = h[0], S = h[1];
    let o = 8;
    const layer = new Uint8Array(buf.slice(o, o + N)); o += N;
    const X = new Uint16Array(buf.slice(o, o + 2 * N)); o += 2 * N;
    const Y = new Uint16Array(buf.slice(o, o + 2 * N)); o += 2 * N;
    const Z = new Uint16Array(buf.slice(o, o + 2 * N)); o += 2 * N;
    const offsets = new Uint32Array(buf.slice(o, o + 4 * (N + 1))); o += 4 * (N + 1);
    const post = new Int32Array(buf.slice(o, o + 4 * S)); o += 4 * S;
    const w = new Int16Array(buf.slice(o, o + 2 * S));
    for (let i = 0; i < N; i++) {
      let p = 0;
      for (let e = offsets[i], end = offsets[i + 1]; e < end; e++) { p += post[e]; post[e] = p; }
    }
    return { N, S, layer, X, Y, Z, offsets, post, w };
  }

  class Circuit {
    constructor(mb, meta) {
      this.mb = mb; this.meta = meta;
      this.L = meta.layers;
      const li = (n) => this.L.indexOf(n);
      this.PNlayer = li("PN"); this.KClayer = li("KC"); this.MBONlayer = li("MBON");
      this.idx = {};
      for (const n of this.L) this.idx[n] = [];
      for (let i = 0; i < mb.N; i++) this.idx[this.L[mb.layer[i]]].push(i);

      const pnPos = new Int32Array(mb.N).fill(-1);
      this.idx.PN.forEach((v, k) => (pnPos[v] = k));
      const kcPos = new Int32Array(mb.N).fill(-1);
      this.idx.KC.forEach((v, k) => (kcPos[v] = k));
      this.pnPos = pnPos; this.kcPos = kcPos;

      // glomerulus -> projection neurons, summed over that glomerulus's sensory neurons
      this.gloms = Object.keys(meta.glomeruli);
      this.g2pn = this.gloms.map((g) => {
        const acc = new Map();
        for (const o of meta.glomeruli[g]) {
          for (let e = mb.offsets[o], end = mb.offsets[o + 1]; e < end; e++) {
            const p = mb.post[e];
            if (pnPos[p] >= 0 && mb.w[e] > 0) acc.set(pnPos[p], (acc.get(pnPos[p]) || 0) + mb.w[e]);
          }
        }
        return [...acc.entries()];
      });
      // projection neuron -> Kenyon cells
      this.pn2kc = this.idx.PN.map((p) => {
        const a = [];
        for (let e = mb.offsets[p], end = mb.offsets[p + 1]; e < end; e++) {
          const q = mb.post[e];
          if (kcPos[q] >= 0 && mb.w[e] > 0) a.push([kcPos[q], mb.w[e]]);
        }
        return a;
      });
      // Kenyon cells -> output neurons, for the readout
      this.kc2mbon = this.idx.KC.map((k) => {
        const a = [];
        for (let e = mb.offsets[k], end = mb.offsets[k + 1]; e < end; e++) {
          const q = mb.post[e];
          if (mb.layer[q] === this.MBONlayer) a.push([q, mb.w[e]]);
        }
        return a;
      });
      // reverse index: for each Kenyon cell, the projection neurons that feed it.
      // The renderer draws these as the actual synapses lighting up.
      this.kcInputs = this.idx.KC.map(() => []);
      this.pn2kc.forEach((list, p) => {
        for (const [k] of list) this.kcInputs[k].push(p);
      });
      // A sample of real synapses for the visible web. Only short ones: long-range edges
      // cross the whole brain and turn the picture into a scribble, while short ones trace
      // the structure the neurons actually form.
      const px = mb.X, py = mb.Y, pz = mb.Z;
      const cand = [];
      const LIMIT = 6000; // in the 0..65535 coordinate space, ~9% of the brain's width
      for (let i = 0; i < mb.N; i++) {
        for (let e = mb.offsets[i], end = mb.offsets[i + 1]; e < end; e++) {
          if (mb.w[e] < 16) continue;
          const j = mb.post[e];
          const dx = px[i] - px[j], dy = py[i] - py[j], dz = pz[i] - pz[j];
          if (dx * dx + dy * dy + dz * dz < LIMIT * LIMIT) cand.push(i, j);
        }
      }
      const want = 2600;
      const stride = Math.max(1, Math.floor(cand.length / 2 / want));
      const n = Math.min(want, Math.floor(cand.length / 2 / stride));
      const web = new Int32Array(n * 2);
      for (let k = 0, j = 0; j < web.length; k += stride * 2, j += 2) {
        web[j] = cand[k];
        web[j + 1] = cand[k + 1];
      }
      this.web = web;
      this.pn = new Float64Array(this.idx.PN.length);
      this.kc = new Float64Array(this.idx.KC.length);
    }

    /* smell(vector over the 53 glomeruli) -> { code, pn, kc, mbon } */
    smell(vec) {
      const { pn, kc } = this;
      pn.fill(0); kc.fill(0);
      for (let g = 0; g < vec.length; g++) {
        const v = vec[g];
        if (!v) continue;
        for (const [p, w] of this.g2pn[g]) pn[p] += v * w;
      }
      let mean = 0;
      for (let i = 0; i < pn.length; i++) mean += pn[i];
      mean /= pn.length;
      for (let i = 0; i < pn.length; i++) pn[i] -= mean;          // lateral normalisation (local neurons)
      for (let p = 0; p < pn.length; p++) {
        const v = pn[p];
        if (v <= 0) continue;
        for (const [k, w] of this.pn2kc[p]) kc[k] += v * w;
      }
      const want = Math.round(kc.length * SPARSITY);
      const order = [];
      for (let i = 0; i < kc.length; i++) if (kc[i] > 0) order.push(i);
      order.sort((a, b) => kc[b] - kc[a]);
      const code = order.slice(0, want);                           // APL: keep the strongest few percent
      const mbon = new Map();
      for (const k of code) for (const [m, w] of this.kc2mbon[k]) mbon.set(m, (mbon.get(m) || 0) + w);
      return { code, codeSet: new Set(code), pn: pn.slice(), mbon };
    }
  }

  const overlap = (a, b) => {
    if (!a || !b || !a.size || !b.size) return 0;
    let i = 0;
    for (const x of a) if (b.has(x)) i++;
    return i / (a.size + b.size - i);
  };

  async function gunzip(res) {
    let blob = await res.blob();
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    if (head[0] === 0x1f && head[1] === 0x8b) {
      if (typeof DecompressionStream === "undefined") throw new Error("browser too old to unpack the circuit");
      blob = await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).blob();
    }
    return blob.arrayBuffer();
  }

  // the rest of the brain, as a silhouette the circuit sits inside
  async function loadShell(base) {
    const res = await fetch(base + "shell.bin.gz");
    if (!res.ok) return null;
    const buf = await gunzip(res);
    const n = new Uint32Array(buf, 0, 1)[0];
    let o = 4;
    const X = new Uint16Array(buf.slice(o, o + 2 * n)); o += 2 * n;
    const Y = new Uint16Array(buf.slice(o, o + 2 * n)); o += 2 * n;
    const Z = new Uint16Array(buf.slice(o, o + 2 * n));
    return { n, X, Y, Z };
  }

  async function load(base) {
    const [metaRes, binRes] = await Promise.all([fetch(base + "mb.json"), fetch(base + "mb.bin.gz")]);
    if (!binRes.ok) throw new Error("circuit HTTP " + binRes.status);
    const meta = await metaRes.json();
    const circuit = new Circuit(decode(await gunzip(binRes)), meta);
    circuit.shell = await loadShell(base).catch(() => null);
    return circuit;
  }

  const api = { load, decode, Circuit, overlap, SPARSITY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FlyHash = api;
})(typeof self !== "undefined" ? self : globalThis);
