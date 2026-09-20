/* Leaky integrate-and-fire fly connectome, event-driven, plain JS (no dependencies).
 * Same model as Shiu et al. (MIT, github.com/philshiu/Drosophila_brain_model):
 *   dv/dt = (v0 - v + g)/t_mbr,  dg/dt = -g/tau,  spike at v > v_th, reset v=v0, g=0,
 *   refractory 2.2 ms, synaptic delay 1.8 ms, weight = signed synapse count * 0.275 mV.
 * Time step 0.1 ms, integrated exactly. Only neurons that could spike are integrated every step:
 * a neuron with max(u, g) <= threshold cannot cross it without new input (u is a leaky average of the
 * decaying g), so it is parked and brought up to date in closed form when the next spike arrives.
 * Works in a browser worker (importScripts) and in Node (module.exports). */
(function (root) {
  const DT_MS = 0.1, TM = 20, TAU = 5;
  const E1 = Math.exp(-DT_MS / TM), E2 = Math.exp(-DT_MS / TAU);
  const C = (E1 - E2) * TAU / (TM - TAU);         // u' = u*E1 + g*C   (u = v - v0)
  const TH = 7;                                   // v_th - v0, mV
  const WSYN = 0.275;                             // mV per synapse
  const RFC = Math.round(2.2 / DT_MS), DLY = Math.round(1.8 / DT_MS);
  const KMAX = 4000;                              // parked longer than 400 ms => state has decayed to ~0
  const E1K = new Float64Array(KMAX + 1), E2K = new Float64Array(KMAX + 1);
  for (let k = 0; k <= KMAX; k++) { E1K[k] = Math.exp(-k * DT_MS / TM); E2K[k] = Math.exp(-k * DT_MS / TAU); }
  const THIRD = TAU / (TM - TAU);                 // u_k = u*E1^k + g*(E1^k - E2^k)*THIRD
  const DRIVE = WSYN * 250;                       // Poisson event: v += w_syn * f_poi = 68.75 mV

  function decodeConnectome(buf) {                // buf: ArrayBuffer of the un-gzipped file
    const head = new Uint32Array(buf, 0, 2), N = head[0], S = head[1];
    let o = 8;
    const offsets = new Uint32Array(buf, o, N + 1); o += 4 * (N + 1);
    const post = new Int32Array(buf.slice(o, o + 4 * S)); o += 4 * S;   // deltas in, absolute out
    const w = new Int16Array(buf.slice(o, o + 2 * S));
    for (let i = 0; i < N; i++) {
      let prev = 0;
      for (let e = offsets[i], end = offsets[i + 1]; e < end; e++) { prev += post[e]; post[e] = prev; }
    }
    return { N, S, offsets, post, w };
  }

  function poisson(lambda) {
    if (lambda <= 0) return 0;
    if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss()));
    const L = Math.exp(-lambda); let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }
  function gauss() { return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()); }

  class Sim {
    /* channels: { name: Int32Array|number[] of neuron indices } — driven by Poisson events */
    constructor(conn, channels) {
      this.N = conn.N; this.off = conn.offsets; this.post = conn.post; this.w = conn.w;
      const N = this.N;
      this.u = new Float32Array(N); this.g = new Float32Array(N);
      this.ref = new Int32Array(N);                 // step until which the neuron is refractory
      this.rfc = new Int32Array(N).fill(RFC);
      this.spk = new Int32Array(N); this.lastT = new Int32Array(N);
      this.act = new Int32Array(N); this.nAct = 0; this.inAct = new Uint8Array(N);
      this.ring = []; for (let i = 0; i <= DLY; i++) this.ring.push({ a: new Int32Array(4096), n: 0 });
      this.chan = {}; this.rate = {};
      for (const k in channels) {
        this.chan[k] = Int32Array.from(channels[k]); this.rate[k] = 0;
        for (const i of this.chan[k]) this.rfc[i] = 0;   // driven neurons have no refractory period
      }
      this.t = 0; this.spikes = 0;
      this.log = new Int32Array(1 << 16); this.nLog = 0;
    }
    setRate(name, hz) { if (name in this.rate) this.rate[name] = hz; }
    get timeMs() { return this.t * DT_MS; }
    _touch(i) { if (!this.inAct[i]) { this.inAct[i] = 1; this.act[this.nAct++] = i; } }
    _emit(i) {
      const r = this.ring[(this.t + DLY) % (DLY + 1)];
      if (r.n === r.a.length) { const b = new Int32Array(r.a.length * 2); b.set(r.a); r.a = b; }
      r.a[r.n++] = i; this.spikes++;
      if (this.nLog === this.log.length) { const b = new Int32Array(this.log.length * 2); b.set(this.log); this.log = b; }
      this.log[this.nLog++] = i;
    }
    /* bring a parked neuron's state forward k steps (closed form) */
    _catchUp(i, k) {
      if (k <= 0) return;
      if (k >= KMAX) { this.u[i] = 0; this.g[i] = 0; return; }
      const a = E1K[k], b = E2K[k];
      this.u[i] = this.u[i] * a + this.g[i] * (a - b) * THIRD; this.g[i] *= b;
    }
    /* advance n steps; returns the neuron ids that spiked (a view valid until the next call).
     * Order inside a step follows Brian2: drive -> integrate + threshold -> deliver arrivals -> reset,
     * so an arrival on the same step as the neuron's own spike is wiped by that spike's reset,
     * and input arriving while a neuron is refractory is dropped. */
    step(n) {
      const { u, g, ref, rfc, act, inAct, off, post, w, spk, lastT } = this;
      this.nLog = 0;
      for (let s = 0; s < n; s++, this.t++) {
        const t = this.t;
        // A. Poisson drive: each event adds w_syn*f_poi to v (far above threshold)
        for (const name in this.chan) {
          const hz = this.rate[name]; if (hz <= 0) continue;
          const idx = this.chan[name], ev = poisson(idx.length * hz * DT_MS * 1e-3);
          for (let j = 0; j < ev; j++) {
            const i = idx[(Math.random() * idx.length) | 0];
            if (!inAct[i]) { this._catchUp(i, t - lastT[i]); lastT[i] = t; inAct[i] = 1; act[this.nAct++] = i; }
            u[i] += DRIVE;
          }
        }
        // B. integrate every neuron that could spike; collect the ones over threshold; park the rest
        let m = this.nAct, ns = 0;
        for (let k = 0; k < m;) {
          const i = act[k];
          if (t < ref[i]) { inAct[i] = 0; lastT[i] = t + 1; act[k] = act[--m]; continue; }   // refractory: state is 0
          const gi = g[i], ui = u[i] * E1 + gi * C, gn = gi * E2;
          u[i] = ui; g[i] = gn;
          if (ui > TH) { spk[ns++] = i; k++; continue; }
          if (ui <= TH && gn <= TH) { inAct[i] = 0; lastT[i] = t + 1; act[k] = act[--m]; continue; }
          k++;
        }
        this.nAct = m;
        // C. deliver spikes emitted DLY steps ago
        const r = this.ring[t % (DLY + 1)];
        for (let a = 0; a < r.n; a++) {
          const src = r.a[a];
          for (let e = off[src], end = off[src + 1]; e < end; e++) {
            const p = post[e]; if (t < ref[p]) continue;
            if (inAct[p]) { g[p] += w[e] * WSYN; continue; }
            this._catchUp(p, t + 1 - lastT[p]); lastT[p] = t + 1;
            const gp = g[p] + w[e] * WSYN; g[p] = gp;
            if (gp > TH || u[p] > TH) { inAct[p] = 1; act[this.nAct++] = p; }
          }
        }
        r.n = 0;
        // D. reset the neurons that spiked, start their refractory period, queue their spikes
        for (let a = 0; a < ns; a++) { const i = spk[a]; u[i] = 0; g[i] = 0; ref[i] = t + rfc[i]; this._emit(i); }
      }
      return this.log.subarray(0, this.nLog);
    }
  }
  const api = { Sim, decodeConnectome, DT_MS };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.FlySim = api;
})(typeof self !== "undefined" ? self : globalThis);
