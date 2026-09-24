// The tier-2 authority. The point of these assertions is what the wording is NOT allowed to
// say: a curated list can report a collision, but absence from one is the normal state of
// almost every token and must never read as an accusation.
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
    },
    session: { get: async () => ({}), set: async () => {} },
  },
};

const { index, listCheck, crossChainNameCheck, LIST_NAME } = await import("../lib/lists.js");

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const FAKE = "0xdeadbeef00000000000000000000000000000001";

const list = {
  loaded: true,
  ...index({
    tokens: [
      { chainId: 1, address: USDC, symbol: "USDC", name: "USD Coin" },
      { chainId: 1, address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", symbol: "UNI", name: "Uniswap" },
      { chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", name: "USD Coin" },
      // one symbol, two claimants on the same chain - legitimate and not rare
      { chainId: 1, address: "0xaaa0000000000000000000000000000000000001", symbol: "REAL", name: "Real One" },
      { chainId: 1, address: "0xaaa0000000000000000000000000000000000002", symbol: "REAL", name: "Real Two" },
    ],
  }),
};

assert.equal(list.count, 5);

// ---- listed: a vouch, phrased as a vouch ----
const listed = listCheck(list, { chainId: 1, address: USDC, symbol: "USDC" });
assert.equal(listed.status, "ok");
assert.match(listed.detail, new RegExp(`listed on ${LIST_NAME}`));

// address casing must not decide the answer
assert.equal(listCheck(list, { chainId: 1, address: USDC.toLowerCase(), symbol: "usdc" }).status, "ok");

// ---- the collision: the strongest thing tier 2 is allowed to say ----
const collide = listCheck(list, { chainId: 1, address: FAKE, symbol: "USDC" });
assert.equal(collide.status, "warn");
assert.match(collide.detail, /the list says USDC on this chain is 0xa0b86991/i);
assert.doesNotMatch(collide.detail, /fake|scam|impersonat/i,
  "tier 2 has no registry behind it and may not accuse");

// a $ prefix is the same claim
assert.equal(listCheck(list, { chainId: 1, address: FAKE, symbol: "$USDC" }).status, "warn");

// several claimants is reported as several, not as one arbitrary winner
const many = listCheck(list, { chainId: 1, address: FAKE, symbol: "REAL" });
assert.match(many.detail, /2 other contracts/);

// ---- absence proves nothing, and has to say so ----
const absent = listCheck(list, { chainId: 1, address: FAKE, symbol: "BRANDNEW" });
assert.equal(absent.status, "unresolved", "not a warning: every token is unlisted on day one");
assert.match(absent.detail, /is not a finding on its own/);

// a token with no symbol at all cannot collide with anything
assert.equal(listCheck(list, { chainId: 1, address: FAKE, symbol: null }).status, "unresolved");

// ---- chains are separate namespaces ----
assert.equal(
  listCheck(list, { chainId: 8453, address: USDC, symbol: "USDC" }).status,
  "warn",
  "Ethereum's USDC address is not Base's, and pretending otherwise is the cross-chain mistake",
);
assert.equal(
  listCheck(list, { chainId: 42161, address: FAKE, symbol: "USDC" }).status,
  "unresolved",
  "a chain the list does not cover yields no finding, not a false one",
);

// ---- no list loaded: unresolved, never a pass ----
const none = listCheck({ loaded: false }, { chainId: 1, address: USDC, symbol: "USDC" });
assert.equal(none.status, "unresolved");
assert.match(none.detail, /nothing was compared/);

// ---- the cross-chain name check ----
//
// Built from a real miss on 2026-09-24: a post about $PUMP (pump.fun's Solana token, ~$1.8bn)
// resolved to a Robinhood Chain contract calling itself "Pump" and the extension returned a
// green PASS. Every check that only knows one chain passes a copy of a token that lives on a
// different one - which is the entire trick.

const SOL = 501000101;
const cross = {
  loaded: true,
  ...index({
    tokens: [
      // Uniswap's list calls it "Pump.fun". Jupiter calls it "Pump". The copy calls itself
      // "Pump". No two of those are equal, so exact name matching tests nothing.
      { chainId: SOL, address: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", symbol: "PUMP", name: "Pump.fun" },
      { chainId: 1, address: "0x0D8775F648430679A709E98d2b0Cb6250d2887EF", symbol: "BAT", name: "Basic Attention Token" },
      { chainId: 1, address: USDC, symbol: "USDC", name: "USD Coin" },
      { chainId: 4663, address: "0xbbb0000000000000000000000000000000000001", symbol: "LISTED", name: "Listed Here" },
    ],
  }),
};

const FAKE_PUMP = "0xd69e0866f84723e8ffcd5ecea274844bdf8512c3";
const pump = crossChainNameCheck(cross, { chainId: 4663, address: FAKE_PUMP, symbol: "Pump", name: "Pump" });
assert.equal(pump.status, "warn", "this must deny PASS - it was green before");
assert.match(pump.detail, /Pump\.fun/);
assert.match(pump.detail, /Solana/);

// base58 is case-carrying: a lowercased Solana address is not that address
assert.match(pump.detail, /pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn/,
  "the Solana address keeps its casing, or it is not an address any more");

// symbol match with an unrelated name is still a warning, worded as a question
const bat = crossChainNameCheck(cross, { chainId: 4663, address: FAKE_PUMP, symbol: "BAT", name: "Totally Different" });
assert.equal(bat.status, "warn");
assert.match(bat.detail, /check which BAT/);

// ---- what it must NOT fire on ----
assert.equal(
  crossChainNameCheck(cross, { chainId: 4663, address: "0xbbb0000000000000000000000000000000000001", symbol: "LISTED", name: "Listed Here" }),
  null,
  "a contract listed on its own chain has been vouched for",
);
assert.equal(
  crossChainNameCheck(cross, { chainId: 1, address: USDC, symbol: "USDC", name: "USD Coin" }),
  null,
  "the real USDC is not impersonating USDC",
);
assert.equal(
  crossChainNameCheck(cross, { chainId: 4663, address: FAKE_PUMP, symbol: "ZZQQ", name: "Nothing" }),
  null,
  "a symbol nobody has listed anywhere is not a finding",
);
assert.equal(crossChainNameCheck(cross, { chainId: 4663, address: FAKE_PUMP, symbol: "", name: "x" }), null,
  "no symbol, no claim");
assert.equal(crossChainNameCheck({ loaded: false }, { chainId: 4663, address: FAKE_PUMP, symbol: "PUMP" }), null,
  "no list loaded means no opinion, never a pass");

// the name relation is loose but not absurd: two-character overlaps must not match
const loose = crossChainNameCheck(cross, { chainId: 4663, address: FAKE_PUMP, symbol: "PUMP", name: "Pu" });
assert.doesNotMatch(loose.detail, /Pump\.fun/, "a 2-char name is below the relation floor");

console.log("lists: ok");
