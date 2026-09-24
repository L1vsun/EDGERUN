// Where else an address lives. The wording is a claim, so the summariser is tested directly
// and the fan-out is tested against stub chains rather than five live RPCs.
import assert from "node:assert/strict";

const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => {
        if (k == null) return Object.fromEntries(store);
        const out = {};
        for (const key of [].concat(k)) if (store.has(key)) out[key] = store.get(key);
        return out;
      },
      set: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, v); },
      remove: async (k) => { for (const key of [].concat(k)) store.delete(key); },
    },
    session: {
      get: async () => ({}),
      set: async () => {},
    },
  },
};

// Every chain answers from this table instead of the network. Keyed by chain id.
let ANSWERS = {};
let requests = [];
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  const chain = Object.values(CHAINS_BY_URL).find((c) => c.rpc === url);
  requests.push(chain?.id);
  const a = ANSWERS[chain.id] || {};
  if (a.throws) throw new Error("connection refused");
  const enc = (s) => {
    const hex = Buffer.from(s, "utf8").toString("hex");
    return "0x" + (32).toString(16).padStart(64, "0") + s.length.toString(16).padStart(64, "0") + hex.padEnd(64, "0");
  };
  const reply = body.map((call, i) => {
    if (call.method === "eth_getCode") return { jsonrpc: "2.0", id: call.id, result: a.code || "0x" };
    const data = call.params[0].data;
    if (data === "0x95d89b41") return { jsonrpc: "2.0", id: call.id, result: a.symbol ? enc(a.symbol) : "0x" };
    if (data === "0x06fdde03") return { jsonrpc: "2.0", id: call.id, result: a.name ? enc(a.name) : "0x" };
    return { jsonrpc: "2.0", id: call.id, result: "0x" + (18).toString(16).padStart(64, "0") };
  });
  return { ok: true, status: 200, json: async () => reply };
};

const { CHAINS, ALL } = await import("../lib/chains.js");
const CHAINS_BY_URL = CHAINS;
const { whereItLives, summarize } = await import("../lib/crosschain.js");

const ADDR = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const CODE = "0x6060604052";

// ---- summarize: every branch is a sentence someone will read and act on ----

assert.match(summarize([]).say, /nothing is deployed/);
assert.equal(summarize([]).count, 0);

const one = summarize([
  { name: "Ethereum", present: true, isToken: true, symbol: "USDT" },
  { name: "Base", present: false },
]);
assert.equal(one.count, 1);
assert.equal(one.conflict, false);
assert.equal(one.say, "USDT on Ethereum only");

const same = summarize([
  { name: "Ethereum", present: true, isToken: true, symbol: "USDC" },
  { name: "Base", present: true, isToken: true, symbol: "USDC" },
]);
assert.equal(same.conflict, false, "one token deployed twice is not a conflict");
assert.match(same.say, /the same USDC on 2 chains/);

const clash = summarize([
  { name: "Ethereum", present: true, isToken: true, symbol: "USDC" },
  { name: "Base", present: true, isToken: true, symbol: "SCAM" },
]);
assert.equal(clash.conflict, true, "the same address under two symbols is the finding");
assert.match(clash.say, /different symbols/);
assert.equal(clash.symbols.sort().join(","), "SCAM,USDC");

// an unreachable chain is stated, never silently dropped: a missing row would read as
// "not deployed there", which is a different and much stronger claim
const partial = summarize([
  { name: "Ethereum", present: true, isToken: true, symbol: "USDT" },
  { name: "Base", present: null, error: "connection refused" },
]);
assert.match(partial.say, /1 chain unreachable/);

// a contract that is not a token still counts as present
const notToken = summarize([{ name: "Base", present: true, isToken: false, symbol: null }]);
assert.equal(notToken.count, 1);
assert.match(notToken.say, /a contract on Base only/);

// ---- the fan-out ----

ANSWERS = {
  4663: { code: "0x" },
  1: { code: CODE, symbol: "USDT", name: "Tether USD" },
  8453: { code: "0x" },
  42161: { code: CODE, symbol: "USDT", name: "Tether USD" },
  56: { throws: true },
};

let found = await whereItLives(ADDR, { fresh: true });
assert.equal(requests.length, ALL.length, "one request per chain, not one per call");
assert.equal(found.address, ADDR.toLowerCase());

const byKey = Object.fromEntries(found.chains.map((c) => [c.key, c]));
assert.equal(byKey.ethereum.present, true);
assert.equal(byKey.ethereum.symbol, "USDT");
assert.equal(byKey.ethereum.tokenName, "Tether USD");
assert.equal(byKey.ethereum.decimals, 18);
assert.ok(byKey.ethereum.explorerUrl.includes("eth.blockscout.com"));
assert.equal(byKey.base.present, false, "empty bytecode is not a contract");
assert.equal(byKey.bsc.present, null, "a dead RPC is unknown, not absent");
assert.ok(byKey.bsc.error);
assert.equal(byKey.robinhood.explorerUrl, undefined, "absent chains carry no link");
assert.equal(found.count, 2);
assert.equal(found.conflict, false);

// --- cached on the second ask
requests = [];
found = await whereItLives(ADDR);
assert.equal(requests.length, 0, "a second lookup costs nothing");
assert.equal(found.cached, true);

// --- the case the whole feature exists for
requests = [];
ANSWERS[8453] = { code: CODE, symbol: "USDC", name: "Definitely Real USDC" };
const other = await whereItLives("0x1111111111111111111111111111111111111111", { fresh: true });
assert.equal(other.conflict, true, "USDT on one chain and USDC on another at the same address");
assert.match(other.say, /different symbols/);

// --- a chain with no explorer gets no link rather than a broken one
ANSWERS[56] = { code: CODE, symbol: "CAKE", name: "PancakeSwap" };
const bsc = await whereItLives("0x2222222222222222222222222222222222222222", { fresh: true });
assert.equal(bsc.chains.find((c) => c.key === "bsc").explorerUrl, null,
  "BNB Chain has no Blockscout instance, so it gets null and not a 404 link");

console.log("crosschain: ok");
