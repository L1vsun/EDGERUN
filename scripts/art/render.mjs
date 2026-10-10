// Render the brand art: every scene in render.html, then the flat cards in cards.html that
// are built from them. PNG masters go to scripts/art/out/ (not committed); build.py turns
// those into the files the site, the extension and the brand folder actually carry.
//
//   CHROME="/path/to/chrome" node scripts/art/render.mjs [scene ...] [--size 1600] [--samples 64] [--out dir]
//
// No dependencies: a static server for this folder, a headless Chrome asked over its
// debugging port, and node's own WebSocket. CHROME defaults to the Chromium that Playwright
// installs, if there is one.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const size = String(flag("size", "1600")).split("x").map(Number);
const [W, H] = [size[0], size[1] || size[0]];
const samples = Number(flag("samples", 64));
const outDir = path.resolve(flag("out", path.join(HERE, "out")));
const suffix = flag("suffix", "");

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const bin = path.join(cache, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error("set CHROME to a Chrome or Chromium binary");
}

const TYPES = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript", ".mjs": "text/javascript", ".txt": "text/plain" };
const server = http.createServer((req, res) => {
  const file = path.join(HERE, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(HERE) || !fs.existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const port = 9400 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "edgerun-art-"));
const chrome = spawn(findChrome(), ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let version = null;
  for (let i = 0; i < 40 && !version; i++) { await sleep(250); version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null); }
  if (!version) throw new Error("Chrome did not start");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); const w = waiting.get(msg.id); if (w) { waiting.delete(msg.id); msg.error ? w.rej(new Error(msg.error.message)) : w.res(msg.result); } };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { waiting.set(++id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });

  const { targetId } = await send("Target.createTarget", { url: `${origin}/render.html?w=${W}&h=${H}&samples=${samples}` });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  let scenes = null;
  for (let i = 0; i < 60 && !scenes; i++) { await sleep(500); scenes = await evaluate("window.__scenes || null").catch(() => null); }
  if (!scenes) throw new Error("the render page did not load (it needs the network for three.js and the font)");

  fs.mkdirSync(outDir, { recursive: true });
  const art = {};
  for (const name of args.length ? args : scenes) {
    const started = Date.now();
    const url = await evaluate(`window.__render(${JSON.stringify(name)})`);
    art[name] = url;
    const file = path.join(outDir, `${name}${suffix}.png`);
    fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
    console.log(`${name}: ${W}x${H}, ${samples} samples, ${((Date.now() - started) / 1000).toFixed(1)}s -> ${path.relative(process.cwd(), file)}`);
  }

  // The cards need the whole set, so they are only made on a full run.
  if (!args.length) {
    const markPath = fs.readFileSync(path.join(HERE, "mark.path.txt"), "utf8").trim();
    await send("Page.enable", {}, sessionId);
    await send("Page.navigate", { url: `${origin}/cards.html` }, sessionId);
    let cards = null;
    for (let i = 0; i < 40 && !cards; i++) { await sleep(300); cards = await evaluate("window.__cards || null").catch(() => null); }
    if (!cards) throw new Error("the cards page did not load");
    await evaluate(`window.__art = ${JSON.stringify({ brain: art.brain, icon: art.icon })}`);
    for (const [name, [w, h]] of Object.entries(cards)) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
      await evaluate(`window.__show(${JSON.stringify(name)}, window.__art, ${JSON.stringify(markPath)})`);
      await sleep(250);
      const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: w, height: h, scale: 1 } }, sessionId);
      const file = path.join(outDir, `card-${name}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
      console.log(`card ${name}: ${w}x${h} -> ${path.relative(process.cwd(), file)}`);
    }
  }
  ws.close();
} finally {
  chrome.kill();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
