/* Runs the fly brain off the main thread: loads the connectome, simulates it in real time,
 * and streams the neurons that spike back to the page. No server involved. */
importScripts("sim-core.js");
const { Sim, decodeConnectome, DT_MS } = self.FlySim;

let sim = null, paused = false, wall0 = 0, done = 0;

async function load() {
  const groups = await (await fetch("groups.json")).json();
  const res = await fetch("connectome.bin.gz");
  if (!res.ok) throw new Error("connectome HTTP " + res.status);
  const total = +res.headers.get("content-length") || 0;
  const reader = res.body.getReader(), chunks = [];
  let loaded = 0;
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    chunks.push(value); loaded += value.length;
    postMessage({ type: "progress", loaded, total });
  }
  let blob = new Blob(chunks);
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) {      // still gzipped (the server did not unpack it for us)
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot unpack the brain. Use a recent Chrome, Safari or Firefox.");
    postMessage({ type: "unpack" });
    blob = await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).blob();
  }
  const conn = decodeConnectome(await blob.arrayBuffer());
  sim = new Sim(conn, { touch: groups.channels.jolt, sweet: groups.channels.sweet, bitter: groups.channels.bitter });
  wall0 = performance.now(); done = 0;
  postMessage({ type: "ready", neurons: conn.N, synapses: conn.S });
  tick();
}

function tick() {
  if (!sim || paused) return;
  const now = performance.now();
  let behind = (now - wall0) / DT_MS - done;            // steps owed to stay in real time
  if (behind > 3000) { wall0 += (behind - 300) * DT_MS; behind = 300; }   // >300 ms behind: run slower, don't spiral
  const n = Math.min(Math.floor(behind), 250);
  if (n > 0) {
    const ids = sim.step(n).slice();
    done += n;
    postMessage({ type: "spikes", ids, ms: sim.timeMs, active: sim.nAct, total: sim.spikes }, [ids.buffer]);
  }
  setTimeout(tick, n >= 250 ? 0 : 4);
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === "rates" && sim) { for (const k of ["touch", "sweet", "bitter"]) sim.setRate(k, m[k] || 0); }
  else if (m.type === "pause") {
    paused = !!m.paused;
    if (!paused && sim) { wall0 = performance.now() - done * DT_MS; tick(); }
  }
};

load().catch((err) => postMessage({ type: "error", message: String(err && err.message || err) }));
