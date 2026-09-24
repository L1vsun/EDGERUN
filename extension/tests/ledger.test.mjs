// Exercises lib/ledger.js against a stub of chrome.storage.session.
// One shared list across tabs since 2026-09-24 - see the header of lib/ledger.js for why.
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
await L.record("https://x.com/home", mk(A, "PASS"));
await L.record("https://x.com/home", mk(B, "FAIL", [{ id: "x", label: "blacklist", detail: "reverted", status: "fail" }]));
let rows = await L.read();
assert.equal(rows.length, 2);
assert.equal(rows[0].address, B.toLowerCase(), "newest is first");
assert.equal(rows[0].say, "reverted", "a failing check supplies the row's line");
assert.equal(rows[1].say, "full check ran, found nothing against it");

// --- re-seeing bumps to top, counts, and keeps the original first-seen
const firstSeenA = rows[1].first;
await new Promise((r) => setTimeout(r, 5));
await L.record("https://x.com/home", mk(A, "PASS"));
rows = await L.read();
assert.equal(rows.length, 2, "a repeat sighting is not a second row");
assert.equal(rows[0].address, A.toLowerCase(), "re-seen moves to the top");
assert.equal(rows[0].seen, 2);
assert.equal(rows[0].first, firstSeenA, "first-seen survives a bump");
assert.ok(rows[0].at > firstSeenA, "last-seen moves forward");

// --- recordMany: batch with an overlap must not duplicate or drop
await L.recordMany("https://x.com/home", [mk(B, "FAIL"), mk(C, "OFFICIAL")]);
rows = await L.read();
assert.equal(rows.length, 3, "overlapping batch stays deduped");
assert.equal(new Set(rows.map((r) => r.address)).size, 3);
assert.equal(rows.find((r) => r.address === B.toLowerCase()).seen, 2);
assert.equal(rows.find((r) => r.address === C.toLowerCase()).say, "in Robinhood's published registry");

// --- one list across tabs. Checking something on the explorer must not hide what X found:
// the source page is kept per row instead, so nothing about where it came from is lost.
await L.record("https://dexscreener.com/", mk(A, "PASS"));
rows = await L.read();
assert.equal(rows.length, 3, "a sighting from another page joins the same list");
assert.equal(rows[0].address, A.toLowerCase());
assert.equal(rows[0].url, "https://dexscreener.com/", "the row remembers which page it came from");
assert.equal(rows.find((r) => r.address === B.toLowerCase()).url, "https://x.com/home",
  "and the other rows keep theirs");

// --- cap
await L.recordMany("u", Array.from({ length: 260 }, (_, i) =>
  mk(`0x${String(i).padStart(40, "0")}`, "PASS")));
assert.equal((await L.read()).length, 200, "capped at 200");

// --- closing a tab drops its focus hint and nothing else
await L.setFocus(1, A);
await L.drop(1);
assert.equal(store.has("focus:1"), false, "drop clears focus");
assert.equal((await L.read()).length, 200, "but the shared ledger survives a tab closing");

await L.clear();
assert.equal((await L.read()).length, 0, "clear empties the one list");

// --- base58 survives. Folding a Solana mint to lowercase produces a string that is not the
// address, which is the same trap that bit lists.js.
const MINT = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
await L.record("https://x.com/home", { ...mk(A, "PASS"), address: MINT, symbol: "PUMP" });
const solRow = (await L.read())[0];
assert.equal(solRow.address, MINT, "a mint keeps its casing");

// and a hex address is still folded, so one contract stays one row
await L.record("u", mk(A.toUpperCase(), "PASS"));
await L.record("u", mk(A.toLowerCase(), "PASS"));
assert.equal((await L.read()).filter((r) => r.address === A.toLowerCase()).length, 1,
  "the same contract in two casings is one row");

// --- storage failure must not throw into the caller
globalThis.chrome.storage.session.get = async () => { throw new Error("session storage off"); };
await L.record("u", mk(A, "PASS"));
assert.deepEqual(await L.read(), [], "a dead store degrades to empty, never throws");

console.log("ledger: all assertions passed");
