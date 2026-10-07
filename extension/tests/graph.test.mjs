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

// ================= what changed when Solana became the main chain =================

// ---- a Solana mint keeps its casing ----
// Everything used to be folded to lowercase. For hex that is harmless; for base58 it produces
// a string that is not the address, which went unnoticed while the record was only counted
// and broke the moment a recorded mint had to be looked up again.
chrome.storage.session = { get: async () => ({}), set: async () => {} };
store.clear();
const MINT = "8xu4aFUUJ1Uq7Vye2Pr5eNyetPm9egNMaEeT4WbApump";
const POSTED = Date.parse("2026-10-06T23:59:00Z");
const SEEN = Date.parse("2026-10-07T09:00:00Z");
await G.recordSightings([{ handle: "Caller", address: MINT, symbol: "JACKASS", verdict: "PASS", postedAt: POSTED, post: "2107621644365713694", chain: "solana" }], SEEN);
rec = await G.callerRecord("caller");
assert.equal(rec.calls[0].address, MINT, "base58 is stored as written");
assert.equal(rec.calls[0].posted, POSTED, "when it was posted, not when it was scrolled past");
assert.equal(rec.calls[0].post, "2107621644365713694");
assert.equal(rec.calls[0].chain, "solana");
assert.equal((await G.tokenCallers(MINT)).address, MINT);
assert.ok((await G.tokenCallersMany([MINT]))[MINT.toLowerCase()], "lookups stay keyed by the folded form, so either spelling finds it");

// hex still folds, so one contract is still one record
await G.recordSightings([{ handle: "caller", address: A, verdict: "PASS" }], SEEN);
rec = await G.callerRecord("caller");
assert.ok(rec.calls.some((c) => c.address === A.toLowerCase()));

// ---- a record written by the old code heals instead of doubling ----
store.clear();
store.set("acct:old", { handle: "old", display: null, first: 1, last: 1, seen: 1, calls: [{ address: MINT.toLowerCase(), symbol: "JACKASS", verdict: "PASS", at: 1, last: 1, n: 1 }] });
await G.recordSightings([{ handle: "old", address: MINT, verdict: "PASS", postedAt: POSTED }], SEEN);
rec = await G.callerRecord("old");
assert.equal(rec.tokens, 1, "the same mint in two spellings is one call, not two");
assert.equal(rec.calls[0].address, MINT, "and it gets its real casing back");
assert.equal(rec.calls[0].posted, POSTED);

// ---- the EARLIEST post is the call ----
store.clear();
await G.recordSightings([{ handle: "c", address: MINT, verdict: "PASS", postedAt: POSTED + 86400_000 }], SEEN);
await G.recordSightings([{ handle: "c", address: MINT, verdict: "PASS", postedAt: POSTED, post: "1" }], SEEN + 1000);
await G.recordSightings([{ handle: "c", address: MINT, verdict: "PASS", postedAt: POSTED + 3600_000, post: "2" }], SEEN + 2000);
rec = await G.callerRecord("c");
assert.equal(rec.calls[0].posted, POSTED, "a repost a day later is not when they called it");
assert.equal(rec.calls[0].post, "1", "and the link goes to the post that was the call");

// a timestamp the page could not have meant is not stored
store.clear();
await G.recordSightings([
  { handle: "c", address: MINT, verdict: "PASS", postedAt: SEEN + 86400_000 }, // tomorrow
  { handle: "d", address: MINT, verdict: "PASS", postedAt: 5 },                 // 1970
  { handle: "e", address: MINT, verdict: "PASS", postedAt: "nonsense" },
], SEEN);
for (const h of ["c", "d", "e"]) assert.equal((await G.callerRecord(h)).calls[0].posted, undefined, `${h}: no post time rather than a wrong one`);

// ---- coordination is about when they POSTED ----
// Three profiles read in one sitting used to make three posts written weeks apart look like
// three accounts arriving inside the same hour. That is an accusation, and it was false.
store.clear();
const WEEK = 7 * 86400_000;
await G.recordSightings([
  { handle: "a", address: MINT, verdict: "PASS", postedAt: POSTED - 3 * WEEK },
  { handle: "b", address: MINT, verdict: "PASS", postedAt: POSTED - 2 * WEEK },
  { handle: "c", address: MINT, verdict: "PASS", postedAt: POSTED - WEEK },
], SEEN);
assert.equal((await G.tokenCallers(MINT)).cluster, null, "seen in one minute, posted over three weeks: not a cluster");

// ...and the reverse: read on different days, but posted inside eleven minutes
store.clear();
await G.recordSightings([{ handle: "a", address: MINT, verdict: "PASS", postedAt: POSTED }], SEEN);
await G.recordSightings([{ handle: "b", address: MINT, verdict: "PASS", postedAt: POSTED + 4 * MIN }], SEEN + 2 * 86400_000);
await G.recordSightings([{ handle: "c", address: MINT, verdict: "PASS", postedAt: POSTED + 11 * MIN }], SEEN + 5 * 86400_000);
const pushed = (await G.tokenCallers(MINT)).cluster;
assert.equal(pushed.count, 3);
assert.equal(pushed.spanMs, 11 * MIN, "the span is the posts', not the reader's");

// no post time at all: the old behaviour, the time it was seen
store.clear();
await G.recordSightings([{ handle: "a", address: MINT, verdict: "PASS" }], SEEN);
assert.equal((await G.tokenCallers(MINT)).callers[0].at, SEEN);

// ---- a token that names the poster as its own X account ----
store.clear();
await G.recordSightings([
  { handle: "dev", address: MINT, verdict: "PASS", own: true },
  { handle: "dev", address: "3TWZ2jxSYUiRm9aS2PiD8dUUaUac7Kd8627cvFGDpump", verdict: "PASS", own: true },
  { handle: "dev", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", verdict: "PASS" },
], SEEN);
rec = await G.callerRecord("dev");
assert.equal(rec.owned, 2, "two of the three tokens this account posted name it as their own");
assert.equal(rec.tone, "clean", "a count of facts, not a mark against anyone");

// ---- what happened after: priced on request, stored, and never guessed ----
const dsPairs = (price, created) => ({ pairs: [{ chainId: "solana", pairAddress: "PoolAaaa", liquidity: { usd: 20000 }, volume: { h24: 5000 }, pairCreatedAt: created, priceUsd: String(price) }] });
const gtBars = (list) => ({ data: { attributes: { ohlcv_list: list } } });
const market = ({ price, entry, status = 200 }) => async (url) => {
  const u = String(url);
  if (u.includes("dexscreener")) return { ok: true, status: 200, json: async () => dsPairs(price, POSTED - 3600_000) };
  return { ok: status === 200, status, json: async () => gtBars([[POSTED / 1000 - 30, entry, entry, entry, entry, 1], [POSTED / 1000 + 600, entry, entry * 3, price, price, 1]]) };
};
const NOW = POSTED + 3600_000;
const MINTS = [MINT, "3TWZ2jxSYUiRm9aS2PiD8dUUaUac7Kd8627cvFGDpump", "9qggaAJgctnNUJT1ZtpMfJQwVg3WXwVXEqyBfiDyH9wG", "EWtVtmYPwTEk8abdZa7WK42sD3sgLjqU1T5JGpkusUgF", "966ByMtjhaFDgRJsMFxqzkJk1o46o3ZJru2noLh1GR4W", "C9bXCNx3xUjwY3xSz7wmAXM8CcXKGjjsTTgG36EVFG2v"];

store.clear();
await G.recordSightings(MINTS.map((address, i) => ({ handle: "kol", address, verdict: "PASS", postedAt: POSTED, symbol: `T${i}` })), POSTED + 1000);
rec = await G.callerRecord("kol");
assert.equal(rec.outcomes, null, "nothing is priced until somebody asks");
assert.equal(rec.outcomeSay, null);

let after = await G.priceCalls("kol", { now: NOW, fetchImpl: market({ price: 0.1, entry: 1 }) });
assert.equal(after.run.asked, G.PRICE_PER_RUN, "a run prices a few, not all - the source allows very little");
assert.equal(after.run.priced, G.PRICE_PER_RUN);
assert.equal(after.run.left, MINTS.length - G.PRICE_PER_RUN, "and says how many are left");
assert.equal(after.outcomes.priced, 4);
assert.equal(after.outcomes.down50, 4);
assert.match(after.outcomeSay, /4 of 4 priced calls are down more than half since the post\. Median -90%/);
assert.equal(after.tone, "clean", "a price falling never marks an account - the one warning you about it posted it too");

// stored: the feed's one-storage-read path sees it without pricing anything again
const viaFeed = (await G.callerRecords(["kol"])).kol;
assert.equal(viaFeed.outcomes.priced, 4);
assert.match(viaFeed.outcomeSay, /4 of 4/);

// a second press continues where the first stopped
after = await G.priceCalls("kol", { now: NOW + 1000, fetchImpl: market({ price: 2, entry: 1 }) });
assert.equal(after.run.asked, 2, "only the ones not yet priced");
assert.equal(after.outcomes.priced, 6);
assert.equal(after.outcomes.up, 2);
assert.equal(after.run.left, 0);

// ---- a rate limit is about us, and is not remembered as a fact about a token ----
store.clear();
await G.recordSightings([{ handle: "kol", address: MINT, verdict: "PASS", postedAt: POSTED }], POSTED + 1000);
after = await G.priceCalls("kol", { now: NOW, fetchImpl: market({ price: 1, entry: 1, status: 429 }) });
assert.equal(after.run.limited, true);
assert.equal(after.run.priced, 0);
assert.equal(after.calls[0].out, undefined, "nothing is stored for a call that was never actually priced");
assert.equal(after.run.left, 1, "so it is still owed");

// nobody by that name
assert.equal(await G.priceCalls("ghost", { now: NOW, fetchImpl: market({ price: 1, entry: 1 }) }), null);

console.log("graph: ok");
