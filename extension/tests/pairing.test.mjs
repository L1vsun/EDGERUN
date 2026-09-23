// The ticker/address pairing rule. Built around a real false positive:
// a post naming $DOGGIE and $TSLA, carrying DOGGIE's own contract, was charged with
// impersonating TSLA.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ctx = { globalThis: {}, console, window: {}, document: { documentElement: {} }, MutationObserver: class {}, IntersectionObserver: class {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../shared/detect.js", import.meta.url), "utf8"), ctx);
const { pairTickerClaims, findTokens } = ctx.EDGERUN;

const TSLA = { ticker: "TSLA", address: "0x322f0929000000000000000000000000000000ab", name: "Tesla" };
const tok = (address, symbol) => ({ address, symbol, verdict: "UNRESOLVED" });

// ---- the reported bug ----
const post = `I still believe in $DOGGIE, which is paired with $TSLA on Robinhood
Price might be down. I am Still a Holder
0xa9eFe2Fc94dE79734C03051515F48f254Ce61e18`;
const found = findTokens(post);
// arrays cross a vm realm boundary here, so compare by value not identity
assert.equal(found.tickers.join(","), "DOGGIE,TSLA");
assert.equal(found.addresses.join(","), "0xa9efe2fc94de79734c03051515f48f254ce61e18");

const doggie = tok(found.addresses[0], "DOGGIE");
assert.equal(
  pairTickerClaims([TSLA], [doggie], found.tickers),
  null,
  "a contract whose symbol is another ticker the post names is explained, not an impersonator",
);

// ---- the flagship check must still fire ----
const fakeTsla = tok("0xd18f5e73ec5e2d0b18ebe97426dc5edc2c887715", "TSLA");
assert.equal(
  pairTickerClaims([TSLA], [fakeTsla], ["TSLA"]).strength,
  "impersonation",
  "a contract calling itself TSLA that is not the registry TSLA is impersonation",
);

// ...even when the post pads itself with other tickers to dodge the check
assert.equal(
  pairTickerClaims([TSLA], [fakeTsla], ["TSLA", "PEPE", "DOGE"]).strength,
  "impersonation",
  "naming extra tickers must not launder a direct impersonation",
);

// ---- one ticker, one unrelated address: pairing is unambiguous ----
assert.equal(pairTickerClaims([TSLA], [tok("0xfoo000000000000000000000000000000000001", "FOO")], ["TSLA"]).strength, "mismatch");

// ---- several tickers, address matches none: reported, not charged ----
assert.equal(
  pairTickerClaims([TSLA], [tok("0xfoo000000000000000000000000000000000001", "FOO")], ["TSLA", "DOGGIE"]).strength,
  "ambiguous",
  "when we cannot tell which ticker an address was offered as, we do not accuse",
);

// ---- the real TSLA is never accused of being itself ----
assert.equal(pairTickerClaims([TSLA], [tok(TSLA.address, "TSLA")], ["TSLA"]), null);
assert.equal(pairTickerClaims([TSLA], [tok(TSLA.address.toUpperCase(), "TSLA")], ["TSLA"]), null, "address comparison is case-insensitive");

// ---- a symbol-less contract still pairs on a single-ticker post ----
assert.equal(pairTickerClaims([TSLA], [tok("0xbar000000000000000000000000000000000002", null)], ["TSLA"]).strength, "mismatch");

// ---- impersonation outranks a weaker claim in the same post ----
assert.equal(
  pairTickerClaims([TSLA], [tok("0xfoo000000000000000000000000000000000001", "FOO"), fakeTsla], ["TSLA", "DOGGIE"]).strength,
  "impersonation",
);

console.log("pairing: all assertions passed");
