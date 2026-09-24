// The account graph: who put a contract in front of you, and whether they arrived together.
// Exercises lib/graph.js against a stub of chrome.storage.local.
import assert from "node:assert/strict";

const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => {
        if (k === null || k === undefined) return Object.fromEntries(store);
        const keys = [].concat(k);
        const out = {};
        for (const key of keys) if (store.has(key)) out[key] = store.get(key);
        return out;
      },
      set: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, v); },
      remove: async (k) => { for (const key of [].concat(k)) store.delete(key); },
    },
  },
};

const G = await import("../lib/graph.js");

const A = "0xAAA0000000000000000000000000000000000001";
const B = "0xBBB0000000000000000000000000000000000002";
const MIN = 60_000;

// ---- detectCluster: the claim with teeth ----
// This is an accusation of coordination, so the floor matters more than the ceiling.

assert.equal(G.detectCluster([]), null, "nothing to cluster");
assert.equal(G.detectCluster(null), null, "missing list is not a crash");

const t0 = Date.parse("2026-09-24T12:00:00Z");
assert.equal(
  G.detectCluster([{ handle: "a", at: t0 }, { handle: "b", at: t0 + MIN }]),
  null,
  "two accounts is two people noticing the same thing, not a push",
);

assert.equal(
  G.detectCluster([
    { handle: "a", at: t0 },
    { handle: "a", at: t0 + MIN },
    { handle: "a", at: t0 + 2 * MIN },
  ]),
  null,
  "one account posting three times is not three accounts",
);

const tight = G.detectCluster([
  { handle: "a", at: t0 },
  { handle: "b", at: t0 + 4 * MIN },
  { handle: "c", at: t0 + 11 * MIN },
]);
assert.equal(tight.count, 3);
assert.equal(tight.spanMs, 11 * MIN, "the span is first to last inside the window");
assert.equal(tight.handles.sort().join(","), "a,b,c");

assert.equal(
  G.detectCluster([
    { handle: "a", at: t0 },
    { handle: "b", at: t0 + 5 * 60 * MIN },
    { handle: "c", at: t0 + 10 * 60 * MIN },
  ]),
  null,
  "three accounts across ten hours is a timeline, not a cluster",
);

// a real push buried in a long tail of later, unrelated sightings
const buried = G.detectCluster([
  { handle: "a", at: t0 },
  { handle: "b", at: t0 + 2 * MIN },
  { handle: "c", at: t0 + 3 * MIN },
  { handle: "d", at: t0 + 6 * MIN },
  { handle: "e", at: t0 + 40 * 60 * MIN },
  { handle: "f", at: t0 + 80 * 60 * MIN },
]);
assert.equal(buried.count, 4, "finds the densest window, not the whole list");
assert.equal(buried.spanMs, 6 * MIN);

// unsorted input must not change the answer
const shuffled = G.detectCluster([
  { handle: "c", at: t0 + 3 * MIN },
  { handle: "a", at: t0 },
  { handle: "d", at: t0 + 6 * MIN },
  { handle: "b", at: t0 + 2 * MIN },
]);
assert.equal(shuffled.count, 4, "order of arrival does not matter");

// ---- summarizeCaller: the number has to be one we actually hold ----

assert.equal(G.summarizeCaller(null), null);

const clean = G.summarizeCaller({
  handle: "someone", first: t0, last: t0 + 3 * 86_400_000, seen: 4,
  calls: [{ address: A, verdict: "PASS" }, { address: B, verdict: "OFFICIAL" }],
});
assert.equal(clean.tokens, 2);
assert.equal(clean.flagged, 0);
assert.equal(clean.tone, "clean");
assert.equal(clean.say, "2 contracts over 3 days, none flagged");

const bad = G.summarizeCaller({
  handle: "shill", first: t0, last: t0 + 86_400_000, seen: 3,
  calls: [{ address: A, verdict: "FAIL" }, { address: B, verdict: "CAUTION" }, { address: A + "x", verdict: "PASS" }],
});
assert.equal(bad.flagged, 2);
assert.equal(bad.tone, "bad", "two in three flagged is past the third");

const mixed = G.summarizeCaller({
  handle: "mostly", first: t0, last: t0 + 86_400_000, seen: 10,
  calls: Array.from({ length: 10 }, (_, i) => ({ address: `0x${i}`, verdict: i === 0 ? "FAIL" : "PASS" })),
});
assert.equal(mixed.tone, "mixed", "one in ten is not a clean record and not a bad one");

// ---- recording ----

await G.recordSightings([
  { handle: "Alice", display: "Alice", address: A, symbol: "TSLA", verdict: "FAIL" },
  { handle: "bob", address: A, verdict: "FAIL" },
  { handle: "alice", address: B, symbol: "PEPE", verdict: "PASS" },
]);

let rec = await G.callerRecord("ALICE");
assert.equal(rec.handle, "alice", "handles are folded to one case");
assert.equal(rec.tokens, 2);
assert.equal(rec.flagged, 1);
assert.equal(rec.display, "Alice");

let token = await G.tokenCallers(A);
assert.equal(token.callers.length, 2, "two accounts posted this contract");
assert.equal(token.first.handle, "alice", "first caller is the earliest, not the loudest");
assert.equal(token.cluster, null, "two is below the floor");

// --- a repeat inside the dedupe window is the same post scrolling back, not a second call
await G.recordSightings([{ handle: "alice", address: A, verdict: "FAIL" }]);
rec = await G.callerRecord("alice");
assert.equal(rec.tokens, 2, "no new token");
assert.equal(rec.sightings, 2, "and not counted as a second sighting either");

// --- the same account on the same contract, long after: that is a second call
await G.recordSightings(
  [{ handle: "alice", address: A, verdict: "CAUTION" }],
  Date.now() + 2 * 60 * 60 * 1000,
);
rec = await G.callerRecord("alice");
assert.equal(rec.tokens, 2, "still the same two contracts");
assert.equal(rec.sightings, 3, "but a third sighting");
assert.equal(rec.calls.find((c) => c.address === A.toLowerCase()).verdict, "CAUTION",
  "the latest verdict wins: a token that has since turned is the point of the record");

// --- unknown accounts and junk
assert.equal(await G.callerRecord("nobody"), null);
assert.equal((await G.recordSightings([{ handle: "x" }, { address: A }, null])).recorded, 0,
  "half a sighting is not recorded");
assert.equal((await G.recordSightings([])).recorded, 0);

// --- many addresses in one read
const many = await G.tokenCallersMany([A, B, "0xdead"]);
assert.equal(Object.keys(many).sort().join(","), [A.toLowerCase(), B.toLowerCase()].sort().join(","),
  "addresses with no callers are absent, not null entries");

// ---- a real coordinated push, end to end ----
const now = Date.now();
const PUSH = "0xF000000000000000000000000000000000000009";
await G.recordSightings([{ handle: "p1", address: PUSH, verdict: "FAIL" }], now);
await G.recordSightings([{ handle: "p2", address: PUSH, verdict: "FAIL" }], now + 3 * MIN);
await G.recordSightings([{ handle: "p3", address: PUSH, verdict: "FAIL" }], now + 9 * MIN);
token = await G.tokenCallers(PUSH);
assert.equal(token.cluster.count, 3);
assert.equal(token.cluster.spanMs, 9 * MIN);

// ---- top callers: most flagged first ----
const top = await G.topCallers(10);
assert.equal(top[0].flagged >= top[top.length - 1].flagged, true, "sorted by flagged, descending");

// ---- stats, pause and wipe ----
let stats = await G.graphStats();
assert.equal(stats.accounts, 5, "alice, bob, p1, p2, p3");
assert.equal(stats.tokens, 3, "A, B and the pushed one");
assert.equal(stats.paused, false);

await G.setPaused(true);
assert.equal((await G.recordSightings([{ handle: "late", address: A }])).paused, true);
assert.equal(await G.callerRecord("late"), null, "paused records nothing");

await G.setPaused(false);
await G.recordSightings([{ handle: "late", address: A }]);
assert.ok(await G.callerRecord("late"), "unpausing resumes recording");

store.set("mem:0xkeepme", { note: "memory is a different feature" });
await G.setPaused(true); // pausing and then wiping must not quietly resume recording
const wiped = await G.wipeGraph();
assert.ok(wiped.wiped > 0);
stats = await G.graphStats();
assert.equal(stats.accounts, 0);
assert.equal(stats.tokens, 0);
assert.equal(stats.paused, true, "settings survive a wipe");
assert.ok(store.has("mem:0xkeepme"), "a wipe takes the graph and nothing else");

console.log("graph: ok");
