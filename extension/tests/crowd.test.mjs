// The crowd around a token. The two holder lists and the trade list in fixtures/ are real
// answers from the index, saved on 2026-10-10 and trimmed to the fields that are read.
import assert from "node:assert/strict";
import fs from "node:fs";

const store = new Map();
globalThis.chrome = {
  storage: {
    session: { get: async () => ({}), set: async () => {} },
    local: {
      get: async (k) => (store.has(k) ? { [k]: structuredClone(store.get(k)) } : {}),
      set: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, structuredClone(v)); },
      remove: async (k) => { store.delete(k); },
    },
  },
};
const C = await import("../lib/crowd.js");
const fx = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const by = (checks, id) => checks.find((c) => c.id === id);

// ---- a real list: 100 holders, two pools, one exchange, five wallets with a name ----
const sapling = fx("crowd-sapling");
let c = C.shapeCrowd(sapling.body, sapling.totalSupply);
assert.equal(c.listed, 100);
assert.equal(c.rows.filter((r) => r.kind === "pool").length, 2, "pools are tagged by the index and set apart");
assert.equal(c.rows.filter((r) => r.kind === "exchange").length, 1);
assert.equal(C.shapeCrowd(sapling.body, null), null, "no supply, no percentages - null, never a guess");
assert.equal(C.shapeCrowd({}, 1e9), null);

let named = C.namedHolders(c.rows);
assert.deepEqual(named.map((n) => n.handle), ["ashtoshii", "thisisdjen", "sized_in", "bobbythesolman", "damianprosa"]);
assert.equal(named[0].wallets[0], "8MoW9mtbEz6z3gPuAdYb1yWhjCAxQSYqpcTb1CQgN5qb");
// a wallet's name on a launchpad or a trading app is another namespace: never used as an X handle
const withApp = sapling.body.holders.filter((h) => !h.usernames?.twitter && Object.keys(h.usernames || {}).length);
assert.ok(withApp.length > 0, "the fixture has wallets named only on other platforms");
assert.ok(withApp.every((h) => !c.rows.find((r) => r.address === h.address)?.handle));

let checks = C.crowdChecks(c);
assert.equal(by(checks, "funders"), undefined, "two wallets sharing a funder years apart is not a group");
assert.match(by(checks, "named_holders").detail, /5 of these wallets under an X account: @ashtoshii 0\.52%/);
assert.match(by(checks, "venues").detail, /MEXC holds 0\.37%/);
assert.ok(checks.every((k) => k.status !== "fail" && k.status !== "warn"), "nothing in this list accuses anybody");

// the spread, as the fallback for the chain read: pools and the exchange are not wallets
const spread = C.spreadCheck(c);
assert.equal(spread.status, "unresolved", "an index's list describes; it never accuses");
assert.match(spread.detail, /the largest wallet holds [\d.]+% of supply and the ten largest [\d.]+%.*not read from the chain/);
const topWallet = c.rows.filter((r) => r.kind === "wallet")[0];
assert.ok(spread.detail.includes(`${topWallet.pct >= 10 ? topWallet.pct.toFixed(1) : topWallet.pct.toFixed(2)}%`));
assert.equal(C.spreadCheck({ rows: [], listed: 0 }), null);

// ---- the other real list: one bundle wallet, nine early wallets, one loud name ----
const ansem = fx("crowd-ansem");
c = C.shapeCrowd(ansem.body, ansem.totalSupply);
checks = C.crowdChecks(c);
assert.match(by(checks, "bundle_holders").detail, /1 of the 60 largest holders/);
assert.equal(by(checks, "bundle_holders").status, "unresolved", "0.38% of supply in a bundle wallet is context");
assert.match(by(checks, "early_holders").detail, /9 of the 60 largest holders are tagged sniper or insider/);
assert.equal(C.namedHolders(c.rows)[0].handle, "blknoiz06");

// ---- funded together ----
const T0 = Date.parse("2026-10-01T12:00:00Z");
const row = (address, pct, funder, mins, extra = {}) => ({ address, pct, kind: "wallet", name: null, funder, fundedAt: funder ? T0 + mins * 60_000 : null, marks: [], classes: [], handle: null, ...extra });
const rows = [
  row("w1", 6, "F", 0), row("w2", 5, "F", 4), row("w3", 4, "F", 11),          // one address, eleven minutes
  row("w4", 3, "F", 60 * 24 * 400),                                            // same funder, a year later: not part of it
  row("w5", 2, "CEX", 0), row("w6", 2, "CEX", 90), row("w7", 2, "CEX", 300),   // one funder, hours apart
  row("w8", 9, "w8", 0),                                                       // self-funded noise
  row("pool", 30, "F", 1, { kind: "pool", name: "A Pool" }),                   // a pool is nobody's wallet
];
let groups = C.funderGroups(rows);
assert.equal(groups.length, 1);
assert.deepEqual(groups[0].wallets, ["w1", "w2", "w3"], "only the tightest hour counts");
assert.equal(groups[0].pct, 15);
assert.equal(groups[0].spanMs, 11 * 60_000);

const crowd = { count: 500, listed: rows.length, rows };
assert.equal(by(C.crowdChecks(crowd, { busy: { F: false } }), "funders").status, "warn", "three wallets, one hour, a quiet funder");
assert.match(by(C.crowdChecks(crowd, { busy: { F: false } }), "funders").detail, /3 of the largest wallets, holding 15\.0% of supply/);
assert.equal(by(C.crowdChecks(crowd, { busy: { F: true } }), "funders").status, "unresolved", "an exchange's withdrawal wallet is not a cabal");
assert.match(by(C.crowdChecks(crowd, { busy: { F: true } }), "funders").detail, /thousand transactions a day/);
assert.equal(by(C.crowdChecks(crowd, { busy: {} }), "funders").status, "unresolved", "a funder nobody could read is never called quiet");
assert.match(by(C.crowdChecks(crowd, { busy: {} }), "funders").detail, /could not be read/);
assert.equal(by(C.crowdChecks(crowd, { busy: { F: false }, vouched: true }), "funders").status, "unresolved", "a vouched token is described, not charged");
// under a twentieth of supply it is described and not charged
const small = { ...crowd, rows: rows.map((r) => ({ ...r, pct: r.pct / 10 })) };
assert.equal(by(C.crowdChecks(small, { busy: { F: false } }), "funders").status, "unresolved");
// bundle wallets still holding a tenth of supply
const bundled = { ...crowd, rows: rows.map((r, i) => (i < 3 ? { ...r, marks: ["bundler"] } : r)) };
assert.equal(by(C.crowdChecks(bundled), "bundle_holders").status, "warn");
assert.equal(by(C.crowdChecks(bundled, { vouched: true }), "bundle_holders").status, "unresolved");

// ---- one wallet's trades: the two endpoints agree to the token ----
const trades = C.shapeTrades(sapling.trades.body);
assert.equal(trades.length, 15);
assert.ok(trades.every((t, i) => i === 0 || t.at >= trades[i - 1].at), "oldest first");
let stake = C.stakeOf(trades);
const heldNow = sapling.body.holders.find((h) => h.address === sapling.trades.wallet).amount;
assert.ok(Math.abs(stake.bought - stake.sold - heldNow) < 1, "bought minus sold is exactly what the holder list shows");

// a post written one hour after the first buy, before any sale
const firstSell = trades.find((t) => t.side === "sell").at;
const post = trades[0].at + 3_600_000;
assert.ok(post < firstSell);
stake = C.stakeOf(trades, post);
assert.equal(stake.leadMs, 3_600_000);
assert.ok(stake.heldAtPost > 0 && stake.soldAfter > 0);
let line = C.stakeLine({ handle: "ashtoshii", wallet: sapling.trades.wallet, stake, holdsPct: 0.52 });
assert.match(line.lead, /^@ashtoshii's listed wallet bought 1 hour before this post, sold \d+% of it since, holds 0\.52% now\.$/);
assert.equal(line.tone, stake.soldAfterPct >= 50 ? "warn" : "flat");
assert.ok(line.checks.every((k) => /index/.test(k.detail)), "every row says whose record it is");

// ---- the shapes of a stake ----
const t = (mins, side, amount, usd = amount) => ({ at: T0 + mins * 60_000, side, amount, usd });
// bought four minutes before the post, sold most of it twenty minutes after
stake = C.stakeOf([t(-4.2, "buy", 1000), t(20, "sell", 610)], T0);
assert.equal(Math.round(stake.soldAfterPct), 61);
line = C.stakeLine({ handle: "caller", wallet: "WaLLet1111111111111111111111111111111111111", stake });
assert.equal(line.tone, "warn");
assert.equal(line.lead, "@caller's listed wallet bought 4m 12s before this post, sold 61% of it since.");
assert.equal(by(line.checks, "stake_after").status, "warn");
assert.match(by(line.checks, "stake_after").detail, /the first sale 20 minutes after it/);
// bought before, sold nothing: said, and never amber
stake = C.stakeOf([t(-90, "buy", 1000)], T0);
line = C.stakeLine({ handle: "caller", wallet: "W", stake, holdsPct: 1.2 });
assert.equal(line.tone, "flat");
assert.equal(line.lead, "@caller's listed wallet bought 2 hours before this post, none sold since, holds 1.20% now.");
// sold a little: said, not amber
stake = C.stakeOf([t(-5, "buy", 1000), t(9, "sell", 200)], T0);
assert.equal(C.stakeLine({ handle: "c", wallet: "W", stake }).tone, "flat");
// a round trip that ended before the post is not "bought before this post"
stake = C.stakeOf([t(-600, "buy", 1000), t(-500, "sell", 1000)], T0);
assert.equal(stake.leadMs, null);
assert.equal(stake.heldAtPost, 0);
line = C.stakeLine({ handle: "c", wallet: "W", stake });
assert.equal(line.tone, "flat");
assert.doesNotMatch(line.lead, /before this post/);
// bought only after posting
stake = C.stakeOf([t(3, "buy", 500)], T0);
assert.match(C.stakeLine({ handle: "c", wallet: "W", stake }).lead, /bought 3 minutes after posting/);
// buys after the post dilute the share sold: 500 held + 500 bought after, 500 sold = half
stake = C.stakeOf([t(-5, "buy", 500), t(2, "buy", 500), t(9, "sell", 500)], T0);
assert.equal(stake.soldAfterPct, 50);
// no post time: totals only, nothing about before and after
stake = C.stakeOf([t(-5, "buy", 1000), t(9, "sell", 1000)]);
assert.equal(stake.leadMs, undefined);
line = C.stakeLine({ handle: "c", wallet: "W", stake });
assert.equal(line.tone, "flat");
assert.match(line.lead, /holds none of it now/);
// nothing to say
assert.equal(C.stakeLine({ handle: "c", wallet: "W", stake: null }), null);
assert.equal(C.stakeLine({ handle: "c", wallet: null, stake }), null);
assert.equal(C.stakeOf([], T0), null);
// held, with no trade on record: said as a holding and nothing more
line = C.stakeLine({ handle: "c", wallet: "W", stake: null, holdsPct: 3 });
assert.equal(line.lead, "@c's listed wallet holds 3.00% now.");

// a holding the trades do not explain: it was sent, not bought
stake = C.stakeOf([t(-50, "buy", 1000, 12000), t(-40, "sell", 990, 11975)], T0);
line = C.stakeLine({ handle: "c", wallet: "W", stake, holdsPct: 8.97, holdsAmount: 89_000_000 });
assert.equal(line.lead, "@c's listed wallet bought 50 minutes before this post, none sold since, holds 8.97% now, most of it sent to the wallet rather than bought.");
assert.match(by(line.checks, "stake_sent").detail, /account for about 0% of what it holds/);
assert.equal(line.tone, "flat", "an allocation is a fact about the wallet, not a charge");
// and a holding the trades DO explain says nothing of the kind
stake = C.stakeOf([t(-50, "buy", 1000)], T0);
assert.equal(by(C.stakeLine({ handle: "c", wallet: "W", stake, holdsPct: 1, holdsAmount: 1000 }).checks, "stake_sent"), undefined);

// ---- the book ----
assert.equal(await C.noteNamed(C.shapeCrowd(sapling.body, sapling.totalSupply).rows), 5);
assert.deepEqual(await C.walletsOf("AshToshii"), ["8MoW9mtbEz6z3gPuAdYb1yWhjCAxQSYqpcTb1CQgN5qb"], "handles are folded");
assert.equal(await C.noteNamed(C.shapeCrowd(sapling.body, sapling.totalSupply).rows), 0, "seeing the same pair again adds nothing");
await Promise.all([
  C.noteNamed([{ handle: "ashtoshii", address: "SecondWallet", kind: "wallet" }]),
  C.noteNamed([{ handle: "someoneelse", address: "Other", kind: "wallet" }]),
]);
assert.deepEqual(await C.walletsOf("ashtoshii"), ["SecondWallet", "8MoW9mtbEz6z3gPuAdYb1yWhjCAxQSYqpcTb1CQgN5qb"], "newest first, and two writes at once both land");
assert.equal(await C.bookSize(), 6);
assert.deepEqual(await C.walletsOf("nobody"), []);
await C.forgetNamed();
assert.equal(await C.bookSize(), 0, "forget everyone empties the book");

// ---- the creator ----
const NOW = Date.parse("2026-10-10T00:00:00Z");
const tok = (id, symbol, mcap, liquidity, vol, graduatedAt = null) => ({ id, symbol, mcap, liquidity, stats24h: { buyVolume: vol, sellVolume: 0 }, firstPool: { createdAt: "2026-10-01T00:00:00Z" }, graduatedAt });
let rec = C.shapeCreator({ numCreated: 64, numMigrated: 2, numCreatedInPast7Days: 9, topTokens: [tok("A", "ALIVE", 2_400_000, 190_000, 400_000, "2026-10-01T02:00:00Z"), tok("B", "GONE", 14_000, 300, 0), tok("M", "THIS", 9000, 5000, 9000)] }, NOW);
assert.equal(rec.best[0].state, "trading");
assert.equal(rec.best[1].state, "dead");
checks = C.creatorChecks(rec, { mint: "M" });
assert.equal(by(checks, "creator_record").status, "warn", "sixty-four launches, three in a hundred graduated");
assert.match(by(checks, "creator_record").detail, /64 tokens to this creator wallet; 2 graduated from their launchpad \(3%\), and 9 were launched in the last seven days/);
assert.match(by(checks, "creator_best").detail, /\$ALIVE \$2\.4M; \$GONE \$14k, no longer trading/);
assert.doesNotMatch(by(checks, "creator_best").detail, /THIS/, "the token being looked at is not one of its 'other' tokens");
assert.equal(by(C.creatorChecks(rec, { vouched: true }), "creator_record").status, "unresolved");
// a launch service is not a serial launcher
rec = C.shapeCreator({ numCreated: 170332, numMigrated: 1733, numCreatedInPast7Days: 2531, topTokens: [tok("A", "X", 1, 1, 1)] }, NOW);
checks = C.creatorChecks(rec);
assert.equal(checks.length, 1);
assert.equal(checks[0].status, "unresolved");
assert.match(checks[0].detail, /170,332 launches.*a launch service or a bot/);
// one token, or nothing known
assert.match(C.creatorChecks(C.shapeCreator({ numCreated: 1, numMigrated: 1, topTokens: [] }))[0].detail, /the only token/);
assert.equal(C.shapeCreator({ numCreated: 0, topTokens: [] }), null);
assert.deepEqual(C.creatorChecks(null), []);
// a good record is said plainly and is not a warning
rec = C.shapeCreator({ numCreated: 12, numMigrated: 6, topTokens: [] }, NOW);
assert.equal(C.creatorChecks(rec)[0].status, "unresolved");

// ---- the creator's own trades ----
assert.equal(C.creatorTradeCheck(null), null);
let own = C.creatorTradeCheck(C.stakeOf([t(0, "buy", 1000, 80), t(5, "sell", 1000, 300)]));
assert.equal(own.status, "warn");
assert.match(own.detail, /bought \$80 of its own token and has sold all of it/);
own = C.creatorTradeCheck(C.stakeOf([t(0, "buy", 1000, 80)]));
assert.equal(own.status, "unresolved");
assert.match(own.detail, /has sold none of it/);
assert.equal(C.creatorTradeCheck(C.stakeOf([t(0, "buy", 1000), t(5, "sell", 1000)]), { vouched: true }).status, "unresolved");

// ---- the reads ----
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
let asked = [];
let read = await C.readCrowd("MINT", sapling.totalSupply, { fetchImpl: async (u) => { asked.push(u); return ok(sapling.body); } });
assert.equal(read.status, "read");
assert.match(asked[0], /\/v1\/holders\/MINT$/);
assert.equal((await C.readCrowd("MINT", 1e9, { fetchImpl: async () => ({ ok: false, status: 429 }) })).status, "limited");
assert.equal((await C.readCrowd("MINT", 1e9, { fetchImpl: async () => { throw new Error("down"); } })).status, "unreachable");
assert.equal((await C.readCrowd("MINT", 1e9, { fetchImpl: async () => ok({ holders: [], count: 0 }) })).status, "none");

// two pages, joined
asked = [];
const W = "WalletAAAA";
const page = (n, next) => ok({ txs: Array.from({ length: n }, (_, i) => ({ type: "buy", amount: 1, usdVolume: 1, timestamp: new Date(T0 + (next ? 1000 : 0) + i).toISOString(), traderAddress: W })), next });
let got = await C.readTrades("MINT", W, { fetchImpl: async (u) => { asked.push(u); return asked.length === 1 ? page(30, "CURSOR") : page(4, null); } });
assert.equal(got.length, 34);
assert.match(asked[1], /traderAddress=WalletAAAA&next=CURSOR$/);
// the filter stops being honoured: nobody else's trades are ever charged to this wallet
got = await C.readTrades("MINT", W, { fetchImpl: async () => ok({ txs: [{ type: "sell", amount: 5, usdVolume: 5, timestamp: new Date(T0).toISOString(), traderAddress: "Stranger" }] }) });
assert.equal(got, null);
assert.equal(await C.readTrades("MINT", W, { fetchImpl: async () => { throw new Error("down"); } }), null);

// ---- is the funder an exchange? ----
const sigs = (n, spanS) => ok({ result: Array.from({ length: n }, (_, i) => ({ blockTime: 1_800_000_000 - Math.round(i * spanS / Math.max(1, n - 1)) })) });
assert.equal(await C.isBusy("F", { fetchImpl: async () => sigs(1000, 3 * 3600) }), true, "a thousand signatures in three hours is a service");
assert.equal(await C.isBusy("F", { fetchImpl: async () => sigs(1000, 40 * 86400) }), false, "a thousand over forty days is an ordinary wallet");
assert.equal(await C.isBusy("F", { fetchImpl: async () => sigs(60, 300) }), false, "sixty signatures in five minutes is a distributor, not an exchange");
assert.equal(await C.isBusy("F", { fetchImpl: async () => ({ ok: false, status: 403 }) }), null, "unread is not quiet");
assert.equal(await C.isBusy("F", { fetchImpl: async () => { throw new Error("down"); } }), null);

console.log("crowd: ok");
