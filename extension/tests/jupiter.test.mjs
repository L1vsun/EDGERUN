// What an index knows about a mint - and how carefully it has to be repeated.
//
// The shapes below are the ones the live API returned on 2026-10-07; the token rows are real
// answers with the long fields cut.
import assert from "node:assert/strict";

const local = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => { const o = {}; for (const x of [].concat(k)) if (local.has(x)) o[x] = local.get(x); return o; },
      set: async (o) => { for (const [k, v] of Object.entries(o)) local.set(k, v); },
    },
    session: { get: async () => ({}), set: async () => {} },
  },
};

const J = await import("../lib/jupiter.js");

// ---- what a token's "twitter" field actually points at ----
const x = J.parseXLink;
assert.deepEqual(x("https://x.com/TempleOnAgency"), { kind: "account", handle: "templeonagency", id: null });
assert.deepEqual(x("https://twitter.com/Foo_Bar/"), { kind: "account", handle: "foo_bar", id: null }, "the old domain, a trailing slash");
assert.deepEqual(x("https://www.x.com/@foo"), { kind: "account", handle: "foo", id: null });
// one post is not an account - and it is often somebody else's post
assert.deepEqual(x("https://x.com/jackasspump/status/2107621644365713694"), { kind: "post", handle: "jackasspump", id: "2107621644365713694" });
assert.deepEqual(x("https://x.com/esotericpigeon/status/2107619041963659642?s=20").kind, "post", "tracking params do not change what it is");
// a community names nobody
assert.deepEqual(x("https://x.com/i/communities/1954550103223779581"), { kind: "community", handle: null, id: "1954550103223779581" });
// things that sit where a handle would and are not accounts
assert.equal(x("https://x.com/search?q=%24PUMP").kind, "other");
assert.equal(x("https://x.com/home").kind, "other");
assert.equal(x("https://x.com/foo/followers").kind, "other", "a sub-page of an account is not a claim about the account");
assert.equal(x("https://x.com/this_handle_is_far_too_long").kind, "other");
// not X at all
assert.equal(x("https://t.me/somegroup"), null);
assert.equal(x("https://x.com.evil.example/foo"), null, "a lookalike host is not x.com");
assert.equal(x("javascript:alert(1)"), null);
assert.equal(x(""), null);
assert.equal(x(null), null);

// ---- one row, reduced to what is repeated ----
const ROW = {
  id: "8xu4aFUUJ1Uq7Vye2Pr5eNyetPm9egNMaEeT4WbApump", name: "Jackass", symbol: "JACKASS",
  twitter: "https://x.com/jackasspump/status/2107621644365713694", website: "https://jackasscoin.fun/",
  dev: "8ABxsR4myiStUGn9vmrNhC8L4hzkVjekaJJ8fRfrBpH9", launchpad: "pump.fun", holderCount: 147, liquidity: 8071.15,
  firstPool: { id: "8xu4…", createdAt: "2026-10-06T23:59:38Z" }, createdAt: "2026-10-06T23:59:38Z",
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 22.07, devMigrations: 5, devMints: 11 },
  organicScore: 0, organicScoreLabel: "low",
};
const NOW = Date.parse("2026-10-07T00:22:38Z");
const ctx = J.shape(ROW, NOW);
assert.equal(ctx.mint, ROW.id, "the mint keeps its casing");
assert.equal(ctx.verified, false, "absent is not verified");
assert.equal(ctx.x.kind, "post");
assert.equal(ctx.createdAt, Date.parse("2026-10-06T23:59:38Z"));
assert.equal(ctx.devPct, null, "a missing number stays missing - it is not zero");
assert.equal("organicScore" in ctx, false, "somebody else's conclusion is not carried at all");
assert.equal("website" in ctx, false, "a link written by the token's creator is not something to hand a reader");
assert.equal(J.shape({}), null);
assert.equal(J.shape({ ...ROW, isVerified: true }).verified, true);

// ---- a batch is one request, and only what was asked for comes back ----
let calls = [];
const answer = (rows, status = 200) => async (url) => {
  calls.push(String(url));
  return { ok: status === 200, status, json: async () => rows };
};
const OTHER = { ...ROW, id: "3TWZ2jxSYUiRm9aS2PiD8dUUaUac7Kd8627cvFGDpump", symbol: "OTHER" };
const STRAY = { ...ROW, id: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK" };
let got = await J.readContext([ROW.id, OTHER.id], { fetchImpl: answer([ROW, OTHER, STRAY]), now: NOW, fresh: true });
assert.equal(calls.length, 1, "two mints, one request");
assert.match(calls[0], /lite-api\.jup\.ag\/tokens\/v2\/search\?query=8xu4.*%2C3TWZ/);
assert.deepEqual(Object.keys(got).sort(), [OTHER.id, ROW.id].sort(), "a neighbour the search threw in is not adopted");

// served from memory inside its lifetime
calls = [];
got = await J.readContext([ROW.id], { fetchImpl: answer([]), now: NOW + 60_000 });
assert.equal(calls.length, 0);
assert.equal(got[ROW.id].symbol, "JACKASS");

// ---- the keyless host has been announced for retirement: the second one is tried ----
calls = [];
const flaky = async (url) => {
  calls.push(String(url));
  if (String(url).includes("lite-api")) return { ok: false, status: 401, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => [ROW] };
};
got = await J.readContext([ROW.id], { fetchImpl: flaky, now: NOW, fresh: true });
assert.equal(calls.length, 2);
assert.match(calls[1], /^https:\/\/api\.jup\.ag\//);
assert.equal(got[ROW.id].launchpad, "pump.fun");

// ---- both down: an empty answer, never a throw, never a finding ----
const dead = async () => { throw new Error("network"); };
got = await J.readContext(["So11111111111111111111111111111111111111112"], { fetchImpl: dead, now: NOW, fresh: true });
assert.deepEqual(got, {});

// ---- who already holds this symbol ----
const PUMP = { id: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", symbol: "PUMP", name: "Pump", isVerified: true, holderCount: 310688 };
const SEARCH = [
  PUMP,
  { id: "Eg2ymQ2aQqjM", symbol: "PUMPCADE", name: "Pumpcade", isVerified: true, holderCount: 4601 },
  { id: "2QTT39WULCwh", symbol: "PUMP", name: "pump", holderCount: 3 },
];
let rivals = await J.sameSymbol("$pump", { fetchImpl: answer(SEARCH), now: NOW });
assert.equal(rivals.length, 1, "exact symbol, and verified - PUMPCADE is a different word and the unverified PUMP is nobody");
assert.equal(rivals[0].mint, PUMP.id);
assert.equal(rivals[0].holders, 310688);
calls = [];
await J.sameSymbol("PUMP", { fetchImpl: answer([]), now: NOW + 3600_000 });
assert.equal(calls.length, 0, "which mint holds a symbol barely moves, so it is cached");
assert.equal(await J.sameSymbol("WIF", { fetchImpl: dead, now: NOW }), null, "no answer is null, which is not the same as nobody");
assert.deepEqual(await J.sameSymbol("TICKER WITH SPACES", { fetchImpl: dead, now: NOW }), [], "not a symbol, not a request");

// ---- a bare ticker: every mint under the symbol, most credible first ----
local.clear();
const HASHERS = [
  { id: "B", symbol: "HASHERS", name: "copy", holderCount: 155 },
  { id: "A", symbol: "hashers", name: "first", holderCount: 2074 },
  { id: "C", symbol: "HASHERSX", name: "not it", holderCount: 9999 },
];
let all = await J.symbolMints("hashers", { fetchImpl: answer(HASHERS), now: NOW });
assert.deepEqual(all.map((m) => m.mint), ["A", "B"], "exact symbol only, and the most-held leads when none is verified");
all = await J.symbolMints("PUMP", { fetchImpl: answer(SEARCH), now: NOW });
assert.equal(all[0].mint, PUMP.id, "a verified mint leads whatever the others hold");
assert.equal(all.length, 2);

let hit = await J.lookupSymbol("$hashers", { fetchImpl: dead, now: NOW + 1000 });
assert.deepEqual({ ticker: hit.ticker, count: hit.count, verified: hit.verified }, { ticker: "HASHERS", count: 2, verified: false }, "served from the cache, said as a count");
hit = await J.lookupSymbol("PUMP", { fetchImpl: dead, now: NOW + 1000 });
assert.equal(hit.verified, true);
assert.equal(hit.mints[0].mint, PUMP.id);
// one mint under a symbol is one meaning: nothing to say
local.clear();
assert.equal(await J.lookupSymbol("SOLO", { fetchImpl: answer([{ id: "S", symbol: "SOLO" }]), now: NOW }), null);
// what a trade is paid in is not a token a post might be mistaken about
calls = [];
assert.equal(await J.lookupSymbol("SOL", { fetchImpl: answer(SEARCH), now: NOW }), null);
assert.equal(await J.lookupSymbol("usdc", { fetchImpl: answer(SEARCH), now: NOW }), null);
assert.equal(calls.length, 0, "and it is never even asked about");
// the index not answering is not "nobody uses this ticker"
assert.equal(await J.lookupSymbol("NEWONE", { fetchImpl: dead, now: NOW }), null);
assert.equal(await J.symbolMints("NEWONE", { fetchImpl: dead, now: NOW }), null);

// ---- the launch, as rows: every one says whose count it is ----
let rows = J.launchChecks(ctx, NOW);
const row = (id) => rows.find((r) => r.id === id);
assert.match(row("launch").detail, /first traded 23 minutes ago on pump\.fun/);
assert.match(row("launch").detail, /has not graduated/);
assert.match(row("holders").detail, /147 wallets hold it, and the ten largest hold 22\.1%.*Jupiter's count, not read from the chain/);
assert.match(row("creator").detail, /Jupiter attributes this mint to 8ABxsR4.*11 token launches.*5 reached an open pool/);
assert.equal(row("creator").status, "warn", "eleven launches is not a one-off");
assert.equal(row("creator").label, "creator, many launches");
assert.match(row("creator").detail, /one operator or a shared launch tool/, "the count is stated, and so is what it can and cannot mean");
assert.ok(rows.every((r) => r.status !== "fail"), "an index's count never reaches fail");

// the same wallet on a verified token is context: BONK's creator has ten launches to its name
rows = J.launchChecks({ ...ctx, verified: true }, NOW);
assert.equal(row("creator").status, "unresolved");
// under the floor
rows = J.launchChecks({ ...ctx, devMints: 9 }, NOW);
assert.equal(row("creator").status, "unresolved");
assert.equal(row("creator").label, "creator");
// graduated, and what the creator still holds
rows = J.launchChecks({ ...ctx, graduatedAt: ctx.createdAt + 130 * 60_000, devPct: 1.0148, devMints: 1, devMigrations: 1 }, NOW);
assert.match(row("launch").detail, /reached an open pool 2 hours later/);
assert.match(row("creator").detail, /1 token launch for \(1 reached an open pool\)\. That wallet still holds 1\.01% of supply/);
assert.ok(!/launch tool/.test(row("creator").detail), "one launch is one launch");
rows = J.launchChecks({ ...ctx, graduatedAt: ctx.createdAt + 30_000 }, NOW);
assert.match(row("launch").detail, /inside the first minute/);
// nothing known, nothing said
assert.deepEqual(J.launchChecks(null), []);
assert.deepEqual(J.launchChecks({ mint: "x" }), []);

assert.equal(J.spanWords(30_000), "under a minute");
assert.equal(J.spanWords(60_000), "1 minute");
assert.equal(J.spanWords(5 * 3600_000), "5 hours");
assert.equal(J.spanWords(12 * 86400_000), "12 days");

// ---- the token's own X link, against the feed ----
const b = J.bindingCheck;
assert.equal(b(null, false), null, "no link, nothing to say");
// names an account, and that account has posted the contract: holds both ways
let bind = b({ kind: "account", handle: "devacct" }, true);
assert.equal(bind.status, "ok");
assert.match(bind.detail, /holds in both directions/);
// names an account that has never been seen posting it: stated, and never a warning
bind = b({ kind: "account", handle: "elonmusk" }, false);
assert.equal(bind.status, "unresolved", "an account that never crossed this reader's feed is not thereby a liar");
assert.match(bind.detail, /proves nothing about @elonmusk/);
// one post is not an account, and says so
bind = b({ kind: "post", handle: "bigaccount", id: "1" }, false);
assert.equal(bind.detail.startsWith("its X link is one post by @bigaccount, not an account."), true, "said first, and as a sentence");
assert.match(b({ kind: "post", handle: "dev", id: "1" }, true).detail, /one post by @dev, not an account - and @dev has posted this contract/);
assert.match(b({ kind: "account", handle: "dev" }, false).detail, /^names @dev as its own X account\./);
// a community names nobody
bind = b({ kind: "community", handle: null, id: "1" }, false);
assert.match(bind.detail, /Anyone can open a community/);
assert.equal(b({ kind: "other", handle: null }, false).status, "unresolved");

console.log("jupiter: ok");
