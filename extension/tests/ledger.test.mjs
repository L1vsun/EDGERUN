// Exercises lib/ledger.js against a stub of chrome.storage.session.
import assert from "node:assert/strict";

const store = new Map();
globalThis.chrome = {
  storage: {
    session: {
      get: async (k) => (Array.isArray(k) ? {} : store.has(k) ? { [k]: store.get(k) } : {}),
      set: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, v); },
      remove: async (k) => { for (const key of [].concat(k)) store.delete(key); },
    },
  },
};

const L = await import("../lib/ledger.js");

const mk = (address, verdict, checks = []) => ({
  address, verdict, symbol: address.slice(2, 6).toUpperCase(), level: "identity",
  explorerUrl: `https://x/${address}`, checks,
});

const A = "0xAAA0000000000000000000000000000000000001";
const B = "0xBBB0000000000000000000000000000000000002";
const C = "0xCCC0000000000000000000000000000000000003";

// --- record: newest first, address lowercased
await L.record(1, "https://x.com/home", mk(A, "PASS"));
await L.record(1, "https://x.com/home", mk(B, "FAIL", [{ id: "x", label: "blacklist", detail: "reverted", status: "fail" }]));
let rows = await L.read(1);
assert.equal(rows.length, 2);
assert.equal(rows[0].address, B.toLowerCase(), "newest is first");
assert.equal(rows[0].say, "reverted", "a failing check supplies the row's line");
assert.equal(rows[1].say, "full check ran, found nothing against it");

// --- re-seeing bumps to top, counts, and keeps the original first-seen
const firstSeenA = rows[1].first;
await new Promise((r) => setTimeout(r, 5));
await L.record(1, "https://x.com/home", mk(A, "PASS"));
rows = await L.read(1);
assert.equal(rows.length, 2, "a repeat sighting is not a second row");
assert.equal(rows[0].address, A.toLowerCase(), "re-seen moves to the top");
assert.equal(rows[0].seen, 2);
assert.equal(rows[0].first, firstSeenA, "first-seen survives a bump");
assert.ok(rows[0].at > firstSeenA, "last-seen moves forward");

// --- recordMany: batch with an overlap must not duplicate or drop
await L.recordMany(1, "https://x.com/home", [mk(B, "FAIL"), mk(C, "OFFICIAL")]);
rows = await L.read(1);
assert.equal(rows.length, 3, "overlapping batch stays deduped");
assert.equal(new Set(rows.map((r) => r.address)).size, 3);
assert.equal(rows.find((r) => r.address === B.toLowerCase()).seen, 2);
assert.equal(rows.find((r) => r.address === C.toLowerCase()).say, "in Robinhood's published registry");

// --- tabs are separate reading sessions
await L.record(2, "https://dexscreener.com/", mk(A, "PASS"));
assert.equal((await L.read(2)).length, 1);
assert.equal((await L.read(1)).length, 3, "tab 1 is untouched by tab 2");

// --- cap
await L.recordMany(3, "u", Array.from({ length: 260 }, (_, i) =>
  mk(`0x${String(i).padStart(40, "0")}`, "PASS")));
assert.equal((await L.read(3)).length, 200, "capped at 200");

// --- drop / clear
await L.setFocus(1, A);
await L.drop(1);
assert.equal((await L.read(1)).length, 0);
assert.equal(store.has("focus:1"), false, "drop clears focus too");

// --- storage failure must not throw into the caller
globalThis.chrome.storage.session.get = async () => { throw new Error("session storage off"); };
await L.record(9, "u", mk(A, "PASS"));
assert.deepEqual(await L.read(9), [], "a dead store degrades to empty, never throws");

console.log("ledger: all assertions passed");
