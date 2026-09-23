// What a post on X actually gets told. Both cases below were reported from the wild.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ctx = { console, window: {}, document: { documentElement: {} }, MutationObserver: class {}, IntersectionObserver: class {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../shared/detect.js", import.meta.url), "utf8"), ctx);
const { decideBadge, findTokens } = ctx.EDGERUN;

const TSLA = { kind: "official", ticker: "TSLA", address: "0x322f0929000000000000000000000000000000ab", name: "Tesla" };
const tok = (address, symbol, verdict = "UNRESOLVED") => ({ address, symbol, verdict, checks: [] });

const decide = (text, { results = [], official = [], onchain = [] } = {}) =>
  decideBadge({ results, official, onchain, namedTickers: findTokens(text).tickers });

// ---- BUG 1: a post naming two tickers, carrying the contract of the one it is about ----
const doggiePost = `I still believe in $DOGGIE, which is paired with $TSLA on Robinhood
Price might be down. I am Still a Holder
0xa9eFe2Fc94dE79734C03051515F48f254Ce61e18`;
const doggie = tok("0xa9efe2fc94de79734c03051515f48f254ce61e18", "DOGGIE", "PASS");
const r1 = decide(doggiePost, { results: [doggie], official: [TSLA] });
assert.equal(r1.verdict, "PASS", "the badge reports on DOGGIE, the token the post is about");
assert.ok(!/not the real one|a different token/.test(r1.lead || ""), "no impersonation claim is made");

// ---- BUG 2: a post that merely mentions a stock ticker gets no badge at all ----
assert.equal(decide("$TSLA earnings tomorrow, still bullish", { official: [TSLA] }), null);
assert.equal(decide("rotating out of $NVDA into $TSLA", { official: [TSLA] }), null);
assert.equal(decide("TSLA and $AAPL both green today", { official: [TSLA] }), null);

// ---- but the flagship check is untouched ----
const fake = tok("0xd18f5e73ec5e2d0b18ebe97426dc5edc2c887715", "TSLA", "FAIL");
const r2 = decide("$TSLA is live 0xd18f5e73ec5e2d0b18ebe97426dc5edc2c887715", { results: [fake], official: [TSLA] });
assert.equal(r2.verdict, "FAIL");
assert.match(r2.lead, /a different token/);

// decoy tickers must not launder it
const r3 = decide("$TSLA $PEPE $DOGE 0xd18f5e73ec5e2d0b18ebe97426dc5edc2c887715", { results: [fake], official: [TSLA] });
assert.equal(r3.verdict, "FAIL", "padding a post with tickers does not dodge the check");

// ---- several tickers, an address matching none: reported, not charged ----
const r4 = decide("$TSLA and $DOGGIE 0xfoo000000000000000000000000000000000001", {
  results: [tok("0xfoo000000000000000000000000000000000001", "FOO")], official: [TSLA],
});
assert.equal(r4.verdict, "CAUTION");
assert.match(r4.lead, /worth checking/);
assert.notEqual(r4.symbol, "$TSLA", "an unproven claim must not relabel the contract as TSLA");

// ---- a shared ticker with no address is still a real finding ----
const pepe = {
  kind: "onchain", ticker: "PEPE", count: 7, capped: false,
  candidates: [{ address: "0xpepe00000000000000000000000000000000001", name: "Pepe", verified: true }],
};
const r5 = decide("$PEPE looking strong", { onchain: [pepe] });
assert.equal(r5.verdict, "CAUTION");
assert.match(r5.lead, /at least 7 different contracts/);

// ---- a ticker used by exactly one contract, no address: nothing to say ----
assert.equal(decide("$WHATEVER", { onchain: [{ ...pepe, ticker: "WHATEVER", count: 1 }] }), null);

// ---- no tickers, no addresses ----
assert.equal(decide("gm"), null);

console.log("badge decisions: all assertions passed");
