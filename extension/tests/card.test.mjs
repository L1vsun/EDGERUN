// The receipt: what goes on it, and what may never come off it.
import assert from "node:assert/strict";

globalThis.chrome = { storage: { session: { get: async () => ({}), set: async () => {} }, local: { get: async () => ({}), set: async () => {} } } };
globalThis.Path2D = class {};
const K = await import("../lib/card.js");
const C = await import("../lib/crowd.js");

const NOW = Date.parse("2026-10-10T14:02:30Z");
const MINT = "HnXDnwTa68tRhLRZdJkVRLAeYrUkCYgFgDavtwD1pump";
const check = (id, label, status, detail) => ({ id, label, status, detail });

// ---- a token verdict ----
const caution = {
  address: MINT, symbol: "Fartcoin", chainName: "Solana", verdict: "CAUTION",
  checks: [
    check("freeze", "freeze authority", "ok", "revoked - no account can be frozen, by anyone"),
    check("program", "token program", "unresolved", "a legacy SPL token"),
    check("symbol_claim", "symbol already taken", "warn", "the curated Solana list gives FARTCOIN to 9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump (Fartcoin). This is a different mint using that symbol."),
    check("mint", "mint authority", "ok", "revoked - the supply cannot be increased by anyone"),
  ],
  context: { launchpad: "pump.fun", createdAt: NOW - 317 * 86400000, holders: 817, top10Pct: 26.7 },
};
let m = K.tokenCard(caution, { lead: "the curated Solana list gives FARTCOIN to 9BB6…pump. This is a different mint using that symbol.", label: "caution", post: { handle: "someone", id: "1234567890" }, now: NOW });
assert.equal(m.headline, "SYMBOL ALREADY TAKEN", "the headline is the strongest finding's own name");
assert.equal(m.lead, "", "the line's sentence was its strongest finding's sentence, cut short: it is printed once, as the row");
assert.equal(K.tokenCard(caution, { lead: "Something the rows do not say.", now: NOW }).lead, "Something the rows do not say.");
assert.equal(m.tone, "warn");
assert.equal(m.subject, "Fartcoin · Solana");
assert.equal(m.rows[0].status, "warn", "the finding first, what passed after it");
assert.ok(m.rows.every((r) => r.status !== "unresolved"), "an unresolved row is not evidence and stays off when there is any");
assert.deepEqual(m.refs, [MINT, "x.com/someone/status/1234567890"], "the full address, and the post it was read under");
assert.equal(m.facts, "pump.fun · 317 days old · 817 holders · top 10 hold 27%");
assert.equal(m.at, "2026-10-10 14:02 UTC");
assert.match(m.source, /read from the chain.*an index's count/);

// a clean mint is a receipt too, and it is not green
m = K.tokenCard({ ...caution, verdict: "PASS", checks: caution.checks.filter((c) => c.status !== "warn") }, { label: "mint is clean", now: NOW });
assert.equal(m.headline, "MINT IS CLEAN");
assert.equal(m.tone, "flat", "a mint scan that found nothing is not a full check that found nothing");
assert.deepEqual(m.refs, [MINT], "no post, no post line");

// a fake
m = K.tokenCard({ address: "0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715", symbol: "TSLA", chainName: "Robinhood Chain", verdict: "FAIL",
  checks: [check("stock_token", "stock token", "fail", 'ticker "TSLA" is an OFFICIAL tokenised stock deployed at 0x322f...3b2d - this contract is 0xd18f...7715')] }, { label: "not the real one", now: NOW });
assert.equal(m.tone, "bad");
assert.equal(m.headline, "STOCK TOKEN");
assert.match(m.source, /Read from the chain and its explorer/);

// a ticker with no contract: counted, never called a verdict on a mint
m = K.tokenCard({ address: "GTBxUiw6wJdmmkCGZgRHLyYxqu1vG4KtRpeox6yDpump", symbol: "$JEANPHIL", chainName: "Solana", verdict: "UNRESOLVED", ticker: true, count: 14,
  checks: [check("ticker", "ticker", "unresolved", "at least 14 mints on Solana use the symbol JEANPHIL. Only an address says which one a post means.")] }, { label: "14 mints", now: NOW });
assert.equal(m.headline, "14 MINTS");
assert.equal(m.rows.length, 1, "with nothing established, the context row is what there is");
assert.match(m.source, /A ticker is not an address/);
assert.equal(K.tokenCard(null), null);
assert.equal(K.tokenCard({ symbol: "X" }), null, "no address, no receipt");

// ---- the poster's wallet ----
const T0 = Date.parse("2026-10-01T12:00:00Z");
const t = (mins, side, amount, usd = amount) => ({ at: T0 + mins * 60_000, side, amount, usd });
const W = "8MoW9mtbEz6z3gPuAdYb1yWhjCAxQSYqpcTb1CQgN5qb";
let stake = C.stakeLine({ handle: "caller", wallet: W, stake: C.stakeOf([t(-4.2, "buy", 1000), t(20, "sell", 610)], T0) });
assert.equal(stake.facts.soldAfterPct, 61);
m = K.stakeCard(stake, { symbol: "CAT", mint: MINT, post: { handle: "caller", id: "42" }, now: NOW });
assert.equal(m.headline, "SOLD 61% AFTER POSTING");
assert.equal(m.tone, "warn", "amber exactly where the line is amber");
assert.equal(m.subject, "@caller · $CAT");
assert.deepEqual(m.refs, [`wallet ${W}`, `mint ${MINT}`, "x.com/caller/status/42"]);
assert.match(m.source, /Which wallet belongs to @caller is an index's attribution/, "the sentence a wallet receipt may never lose");
assert.ok(m.rows.every((r) => /index/.test(r.text)), "and every row says whose record it is");

// sold a little: said, not amber
stake = C.stakeLine({ handle: "caller", wallet: W, stake: C.stakeOf([t(-5, "buy", 1000), t(9, "sell", 200)], T0) });
m = K.stakeCard(stake, { now: NOW });
assert.equal(m.headline, "SOLD 20% AFTER POSTING");
assert.equal(m.tone, "flat");
// held and sold nothing: the one green headline
stake = C.stakeLine({ handle: "caller", wallet: W, stake: C.stakeOf([t(-90, "buy", 1000)], T0), holdsPct: 1.2 });
m = K.stakeCard(stake, { now: NOW });
assert.equal(m.headline, "HAS NOT SOLD SINCE THE POST");
assert.equal(m.tone, "ok");
// everything sold
stake = C.stakeLine({ handle: "caller", wallet: W, stake: C.stakeOf([t(-5, "buy", 1000), t(9, "sell", 1000)], T0) });
assert.equal(K.stakeCard(stake, { now: NOW }).headline, "SOLD ALL OF IT AFTER POSTING");
// bought only after posting, and a holding with no trade on record
stake = C.stakeLine({ handle: "caller", wallet: W, stake: C.stakeOf([t(3, "buy", 500)], T0) });
assert.equal(K.stakeCard(stake, { now: NOW }).headline, "BOUGHT AFTER POSTING");
stake = C.stakeLine({ handle: "caller", wallet: W, stake: null, holdsPct: 3 });
assert.equal(K.stakeCard(stake, { now: NOW }).headline, "HOLDS IT");
// no post time: no claim about before and after
stake = C.stakeLine({ handle: "caller", wallet: W, stake: C.stakeOf([t(-5, "buy", 1000), t(9, "sell", 1000)]) });
m = K.stakeCard(stake, { now: NOW });
assert.equal(m.headline, "ON RECORD");
assert.doesNotMatch(m.headline, /POST/);
assert.equal(K.stakeCard(null), null);

// the caption is the sentence the line said, and nothing new
m = K.stakeCard(C.stakeLine({ handle: "caller", wallet: W, stake: C.stakeOf([t(-4.2, "buy", 1000), t(20, "sell", 610)], T0) }), { now: NOW });
assert.equal(K.cardCaption(m), "@caller's listed wallet bought 4m 12s before this post, sold 61% of it since.\n\nChecked with EDGERUN - edgerun.pro");

// ---- wrapping ----
const measure = (s) => s.length * 10;
assert.deepEqual(K.wrap(measure, "one two three", 80), ["one two", "three"]);
assert.deepEqual(K.wrap(measure, "HnXDnwTa68tRhLRZdJkVRLAeYrUkCYgFgDavtwD1pump", 200), ["HnXDnwTa68tRhLRZdJkV", "RLAeYrUkCYgFgDavtwD1", "pump"], "an address has no spaces and still fits");

// ---- the drawing: rows give way, the address, the time and the source never do ----
function fakeContext() {
  const drawn = [];
  const ctx = {
    font: "", fillStyle: "", strokeStyle: "", lineWidth: 1, letterSpacing: "0px", textBaseline: "",
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (s) => ({ width: s.length * (parseInt(/(\d+)px/.exec(ctx.font)?.[1] || "20", 10) * 0.56) }),
    fillText: (s, x, y) => drawn.push({ s, x, y }),
  };
  for (const k of ["fillRect", "beginPath", "roundRect", "moveTo", "lineTo", "closePath", "fill", "stroke", "save", "restore", "translate", "scale", "setLineDash"]) ctx[k] = () => {};
  return { ctx, drawn };
}
const long = "a sentence that goes on for a good while so that it has to be broken across several lines of the receipt before it ends".repeat(2);
const crowded = {
  kind: "token", tone: "warn", headline: "CREATOR, SERIAL LAUNCHER", subject: "Fartcoin · Solana", lead: long,
  rows: Array.from({ length: 4 }, (_, i) => ({ label: `finding ${i}`, text: long.slice(0, 190), status: "warn" })),
  facts: "pump.fun · 317 days old · 817 holders · top 10 hold 27%",
  refs: [MINT, "x.com/someone/status/1234567890"],
  source: "The mint was read from the chain; holder and launch figures are an index's count.", at: "2026-10-10 14:02 UTC",
};
let { ctx, drawn } = fakeContext();
K.drawCard(ctx, crowded);
const said = drawn.map((d) => d.s).join("\n");
assert.ok(drawn.every((d) => d.y > 0 && d.y < 1350), "nothing is drawn off the picture");
assert.ok(said.includes("HnXDnwTa68tRhLRZdJkVRLAeYrUkCYgFgDavtwD1pump".slice(0, 20)), "the address is on it");
assert.ok(said.includes("read 2026-10-10 14:02 UTC"), "and when it was read");
assert.ok(/an index's count/.test(said.replace(/\n/g, " ")), "and whose record it is");
assert.ok(said.includes("edgerun.pro") && said.includes("EDGERUN"));
assert.ok(drawn.filter((d) => /^FINDING \d$/.test(d.s)).length < 4, "a crowded receipt drops evidence from the end...");
assert.ok(drawn.some((d) => d.s === "FINDING 0"), "...and keeps the first finding");
assert.equal(crowded.rows.length, 4, "the model it was given is not edited");

// a short one keeps everything
({ ctx, drawn } = fakeContext());
K.drawCard(ctx, { ...crowded, lead: "short", rows: crowded.rows.slice(0, 2).map((r) => ({ ...r, text: "short" })) });
assert.equal(drawn.filter((d) => /^FINDING \d$/.test(d.s)).length, 2);

console.log("card: ok");
