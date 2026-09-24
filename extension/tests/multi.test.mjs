// Posts that name more than one token.
//
// Reported 2026-09-24: "not rare when there is 2+ tickers, so it must show all". The old
// decideBadge picked the worst one and printed "showing the one that matters most", which is
// an answer to a question nobody asked - somebody who pastes three contracts is talking about
// three things.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ctx = { globalThis: {}, console, window: {}, document: { documentElement: {} }, MutationObserver: class {}, IntersectionObserver: class {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../shared/detect.js", import.meta.url), "utf8"), ctx);
const { decideBadges, findTokens } = ctx.EDGERUN;

const tok = (address, symbol, verdict = "UNRESOLVED") => ({ address, symbol, verdict, checks: [] });
const A = "0xaaa0000000000000000000000000000000000001";
const B = "0xbbb0000000000000000000000000000000000002";
const C = "0xccc0000000000000000000000000000000000003";
const TSLA = { ticker: "TSLA", address: "0x322f0929000000000000000000000000000000ab", name: "Tesla" };

// ---- three contracts, three badges ----
let out = decideBadges({ results: [tok(A, "ONE"), tok(B, "TWO"), tok(C, "THREE")], namedTickers: [] });
assert.equal(out.length, 3, "three tokens named, three answers");
assert.equal(out.map((r) => r.symbol).join(","), "ONE,TWO,THREE", "in the order they were named");

// ---- the decisive finding leads, and the others still appear ----
out = decideBadges({
  results: [tok(A, "CLEAN"), tok(B, "TSLA")],
  official: [TSLA],
  namedTickers: ["TSLA"],
});
assert.equal(out[0].address, B, "the impersonator leads");
assert.equal(out[0].verdict, "FAIL");
assert.match(out[0].lead, /Robinhood publishes/);
assert.equal(out.length, 2, "the clean one is still shown, not swallowed");
assert.equal(out[1].symbol, "CLEAN");
assert.equal(out.filter((r) => r.address === B).length, 1, "the impersonator appears once, not twice");

// ---- worst-first when nothing is decisive ----
out = decideBadges({ results: [tok(A, "OK", "PASS"), tok(B, "BAD", "FAIL"), tok(C, "MEH", "CAUTION")], namedTickers: [] });
assert.equal(out[0].symbol, "BAD", "the worst leads even with no ticker claim");
assert.equal(out.length, 3);

// ---- Solana mints join the same answer ----
const MINT = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
out = decideBadges({
  results: [tok(A, "EVMTOKEN")],
  namedTickers: [],
  solana: [{ address: MINT, symbol: "PUMP", verdict: "PASS", chainName: "Solana", checks: [] }],
});
assert.equal(out.length, 2, "a post naming an EVM contract and a Solana mint answers about both");
assert.equal(out[1].chainName, "Solana");

// ---- bounded ----
out = decideBadges({
  results: Array.from({ length: 9 }, (_, i) => tok(`0x${String(i).padStart(40, "0")}`, `T${i}`)),
  namedTickers: [],
});
assert.equal(out.length, 4, "a post with nine contracts does not paper the timeline");

// ---- silence is still the default ----
assert.equal(decideBadges({ results: [], namedTickers: ["TSLA"] }).length, 0,
  "a bare ticker with no contract still says nothing");
assert.equal(decideBadges({}).length, 0);

// ---- two contested tickers, two answers ----
// From the field 2026-09-24: a post whose subject was $PONS (15 contracts share it on this
// chain) got a single badge about $PUMP, because $PUMP was named first and decideBadge only
// ever returns the first collision it finds.
out = decideBadges({
  results: [],
  onchain: [
    { ticker: "PUMP", count: 6, capped: false, candidates: [{ address: A, name: "Pump", verified: true }] },
    { ticker: "PONS", count: 15, capped: false, candidates: [{ address: B, name: "Pons", verified: false }] },
  ],
  namedTickers: ["PUMP", "PONS"],
});
assert.equal(out.length, 2, "both contested tickers are answered");
assert.equal(out.map((r) => r.symbol).join(","), "$PUMP,$PONS", "in the order the post named them");
assert.match(out[1].lead, /at least 15 different contracts/);
assert.equal(out.filter((r) => r.symbol === "$PUMP").length, 1, "and neither is answered twice");

// a ticker only one contract uses is still not a finding
out = decideBadges({
  results: [],
  onchain: [{ ticker: "SOLO", count: 1, capped: false, candidates: [{ address: A, name: "Solo" }] }],
  namedTickers: ["SOLO"],
});
assert.equal(out.length, 0, "one contract, one meaning, nothing to say");

// ---- a shared ticker is still a finding with no address at all ----
out = decideBadges({
  results: [],
  onchain: [{ ticker: "PEPE", count: 7, capped: false, candidates: [{ address: A, name: "Pepe", verified: true }] }],
  namedTickers: ["PEPE"],
});
assert.equal(out.length, 1);
assert.equal(out[0].verdict, "CAUTION");

// ---- finding the pieces in real post text ----
const post = `$PUMP is rallying on @Pumpfun
mint pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn
also watching $TSLA at 0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715
https://x.com/someone/status/1234567890123456789`;
const f = findTokens(post);
assert.equal(f.tickers.join(","), "PUMP,TSLA");
assert.equal(f.addresses.join(","), "0xd18f5e73ec5e2d0b18ebe97426dc5edc2c887715");
assert.equal(f.mints.join(","), MINT, "the base58 mint is found and the status id is not");

// a hex address must never be offered as a base58 candidate
assert.equal(findTokens("0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715").mints.length, 0);
// nor a 64-hex pool id
assert.equal(findTokens(`0x${"a".repeat(64)}`).mints.length, 0);

console.log("multi: ok");
