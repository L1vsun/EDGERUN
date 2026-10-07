// Who holds a Solana mint. The first case is the real one this was built against, read from
// the chain on 2026-10-07: a mint calling itself PUMP whose "largest holder" by raw balance
// is a launchpad's bonding curve.
import assert from "node:assert/strict";

globalThis.chrome = { storage: { session: { get: async () => ({}), set: async () => {} }, local: { get: async () => ({}), set: async () => {} } } };
const H = await import("../lib/holders.js");

const SYSTEM = "11111111111111111111111111111111";
const CURVE_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const acct = (owner, state = "initialized") => ({ data: { parsed: { info: { owner, state } } } });
const top = (...amounts) => amounts.map((amount, i) => ({ address: `acct${i}`, amount: String(amount) }));

// ---- the real shape: one wallet, one bonding curve, dust ----
const SUPPLY = 1999875351201269;
let h = H.shapeHolders({
  supply: SUPPLY,
  top: top(1166127000000000, 833348000000000, 400000000000, 1000, 500),
  accounts: [acct("whale"), acct("curve"), acct("w3"), acct("w4"), acct("w5")],
  programs: { whale: SYSTEM, curve: CURVE_PROGRAM, w3: SYSTEM, w4: null, w5: SYSTEM },
});
assert.equal(h.listed, 5);
assert.equal(h.rows[1].kind, "program", "an owner another program controls is not a wallet");
assert.equal(h.rows[3].kind, "wallet", "an owner with no account at all is a wallet holding no SOL");
assert.equal(Math.round(h.top1 * 10) / 10, 58.3, "the largest WALLET, with the curve set aside");
assert.equal(Math.round(h.programPct * 10) / 10, 41.7);
assert.equal(h.walletCount, 4);

let checks = H.holderChecks(h);
const by = (id) => checks.find((c) => c.id === id);
assert.equal(by("holders_top").status, "warn");
assert.match(by("holders_top").detail, /one wallet holds 58\.3% of supply/);
assert.match(by("holders_program").detail, /41\.7% of supply sits in accounts controlled by programs/);
assert.equal(by("holders_program").status, "unresolved", "a pool holding supply is not a finding");
assert.equal(by("holders_frozen"), undefined, "no freeze authority and nothing frozen: nothing to say");

// ---- the mistake this file exists to not make ----
// The same balances with the owners never looked up. Nobody knows which is the pool, so
// nothing is called a wallet and no concentration is claimed.
h = H.shapeHolders({ supply: SUPPLY, top: top(1166127000000000, 833348000000000), accounts: [acct("whale"), acct("curve")], programs: {} });
assert.deepEqual(h.rows.map((r) => r.kind), ["unknown", "unknown"]);
assert.equal(h.top1, 0);
assert.equal(H.holderChecks(h).some((c) => c.id === "holders_top"), false, "an unread owner is not charged with holding anything");

// a token on its curve with ordinary holders: the curve's 80% is not "one holder owns 80%"
h = H.shapeHolders({
  supply: 1000,
  top: top(800, 30, 25, 20, 15),
  accounts: [acct("curve"), acct("a"), acct("b"), acct("c"), acct("d")],
  programs: { curve: CURVE_PROGRAM, a: SYSTEM, b: SYSTEM, c: SYSTEM, d: SYSTEM },
});
checks = H.holderChecks(h);
assert.equal(by("holders_top").status, "unresolved");
assert.match(by("holders_top").detail, /largest wallet holds 3\.00% of supply and the ten largest 9\.00%/);

// ---- concentration thresholds ----
const wallets = (...amounts) => H.shapeHolders({
  supply: 1000, top: top(...amounts), accounts: amounts.map((_, i) => acct(`w${i}`)),
  programs: Object.fromEntries(amounts.map((_, i) => [`w${i}`, SYSTEM])),
});
checks = H.holderChecks(wallets(499, 10, 10));
assert.equal(by("holders_top").status, "unresolved", "49.9% is not a majority");
checks = H.holderChecks(wallets(500, 10, 10));
assert.equal(by("holders_top").label, "one wallet");
checks = H.holderChecks(wallets(100, 100, 100, 100, 100, 100, 100, 100, 50, 50));
assert.equal(by("holders_top").label, "ten wallets", "no single majority, but ten wallets hold 90%");
assert.equal(by("holders_top").status, "warn");
// a vouched token's ten largest holders are exchanges: stated, never charged
checks = H.holderChecks(wallets(600, 100), { vouched: true });
assert.equal(by("holders_top").status, "unresolved");

// ---- frozen accounts: the exit test, asked of this chain ----
const frozen = (states, programs) => H.shapeHolders({
  supply: 1000, top: top(...states.map(() => 100)), accounts: states.map((s, i) => acct(`w${i}`, s)),
  programs: programs || Object.fromEntries(states.map((_, i) => [`w${i}`, SYSTEM])),
});
// every one of the largest wallets frozen: holders cannot move it
checks = H.holderChecks(frozen(["frozen", "frozen", "frozen"]), { freezeAuthority: "Auth" });
assert.equal(by("holders_frozen").status, "fail");
assert.match(by("holders_frozen").detail, /every one of the 3 largest wallet accounts is FROZEN/);
// some of them: a freeze being used on particular holders
checks = H.holderChecks(frozen(["frozen", "initialized", "initialized", "initialized"]), { freezeAuthority: "Auth" });
assert.equal(by("holders_frozen").status, "warn");
assert.match(by("holders_frozen").detail, /1 of the 4 largest accounts is frozen.*while the rest can/);
// two frozen accounts are not "every holder" - too few to say that about a token
checks = H.holderChecks(frozen(["frozen", "frozen"]), { freezeAuthority: "Auth" });
assert.equal(by("holders_frozen").status, "warn");
// a regulated issuer freezes accounts as a matter of course
checks = H.holderChecks(frozen(["frozen", "initialized"]), { vouched: true, freezeAuthority: "Auth" });
assert.equal(by("holders_frozen").status, "unresolved");
checks = H.holderChecks(frozen(["frozen", "frozen", "frozen"]), { vouched: true, freezeAuthority: "Auth" });
assert.equal(by("holders_frozen").status, "unresolved", "even all of them, on a vouched token, is the issuer's business");
// a live freeze authority that has frozen nobody among them is worth one good line
checks = H.holderChecks(frozen(["initialized", "initialized"]), { freezeAuthority: "Auth" });
assert.equal(by("holders_frozen").status, "ok");

assert.equal(H.shapeHolders({ supply: 0, top: top(1) }), null, "no supply, no percentages");
assert.deepEqual(H.holderChecks(null), []);

// ---- end to end, stubbed: three requests, and each way it can fail ----
let calls = [];
const rpc = ({ largest = { result: { value: top(600, 400) } }, largestStatus = 200, owners = [{ owner: SYSTEM }, { owner: CURVE_PROGRAM }] } = {}) => async (url, opts) => {
  const body = JSON.parse(opts.body);
  calls.push({ url: String(url), method: Array.isArray(body) ? body.map((b) => b.method).join("+") : body.method });
  if (String(url).includes("solanavibestation")) return { ok: largestStatus === 200, status: largestStatus, json: async () => largest };
  if (Array.isArray(body)) {
    return { ok: true, status: 200, json: async () => [
      { id: 0, result: { value: { data: { parsed: { info: { supply: "1000", freezeAuthority: null } } } } } },
      { id: 1, result: { value: [acct("whale"), acct("curve")] } },
    ] };
  }
  return { ok: true, status: 200, json: async () => ({ result: { value: owners } }) };
};

let out = await H.readHolders("Mint", { fetchImpl: rpc() });
assert.equal(out.status, "read");
assert.deepEqual(calls.map((c) => c.method), ["getTokenLargestAccounts", "getAccountInfo+getMultipleAccounts", "getMultipleAccounts"]);
assert.match(calls[0].url, /solanavibestation/, "the scarce request goes to the one endpoint that answers it");
assert.match(calls[1].url, /publicnode/, "everything else goes to the RPC that batches");
assert.equal(out.rows[1].kind, "program");
assert.equal(out.checks.find((c) => c.id === "holders_top").label, "one wallet");

// a burst answered with 403: about us, never about the token
out = await H.readHolders("Mint", { fetchImpl: rpc({ largestStatus: 403 }) });
assert.equal(out.status, "limited");
out = await H.readHolders("Mint", { fetchImpl: rpc({ largest: { error: { message: "Request blocked" } } }) });
assert.equal(out.status, "limited");
out = await H.readHolders("Mint", { fetchImpl: rpc({ largest: { result: { value: [] } } }) });
assert.equal(out.status, "none");
// the owners could not be read: no numbers at all, rather than every owner called a wallet
out = await H.readHolders("Mint", { fetchImpl: rpc({ owners: null }) });
assert.equal(out.status, "unreachable");
out = await H.readHolders("Mint", { fetchImpl: async () => { throw new Error("network"); } });
assert.equal(out.status, "unreachable");

// ---- the deeper index read: bundles, bots, the creator wallet's age ----
const J = await import("../lib/jupiter.js");
// the live answer for a real fresh mint, 2026-10-07
const ROW = { id: "4hkq2w72gKgAm92HRx6bxfbKV7dJd8kPxufMvukLpump", firstPool: { createdAt: "2026-10-07T09:10:00Z" }, dexPaidAt: "2026-10-07T09:40:00Z",
  audit: { botHoldersCount: 41, botHoldersPercentage: 24.34984522168181, devFundedAt: "2025-04-14T17:22:15Z", bundlerStats: { totalBundles: 2, totalNativeVol: 10.856015, holdingPctATH: 6.377 } } };
const d = J.shapeDeep(ROW);
assert.deepEqual(d.bundles, { count: 2, sol: 10.856015, peakPct: 6.377 });
let rows = J.deepChecks(d);
const row = (id) => rows.find((r) => r.id === id);
assert.match(row("bundles").detail, /Jupiter counts 2 bundled buys at launch worth 10\.9 SOL, holding up to 6\.4% of supply at their peak/);
assert.equal(row("bundles").status, "unresolved", "six percent is a count, not a charge");
assert.match(row("bots").detail, /Jupiter classes 41 of the holders as bots, holding 24\.3% of supply - its classification/);
assert.equal(row("bots").status, "unresolved", "somebody else's classification never warns");
assert.match(row("dev_age").detail, /first funded 541 days before this token launched/);
assert.match(row("dex_paid").detail, /paid for on 2026-10-07, by Jupiter's record/);
// bundles that held a quarter of supply, on a token nobody vouches for
rows = J.deepChecks({ ...d, bundles: { count: 9, sol: 80, peakPct: 31.2 } });
assert.equal(row("bundles").status, "warn");
rows = J.deepChecks({ ...d, verified: true, bundles: { count: 9, sol: 80, peakPct: 31.2 } });
assert.equal(row("bundles").status, "unresolved");
rows = J.deepChecks({ ...d, bundles: { count: 0, sol: 0, peakPct: 0 }, bots: { count: 0, pct: 0 }, devFundedAt: null, dexPaidAt: null });
assert.match(row("bundles").detail, /no bundled buys/);
assert.equal(rows.length, 1, "nothing counted, nothing else said");
assert.deepEqual(J.deepChecks(null), []);
assert.equal(J.shapeDeep({}), null);
// only the mint that was asked for, and silence when the endpoint is gone
assert.equal((await J.readDeep(ROW.id, { fetchImpl: async () => ({ ok: true, json: async () => [{ ...ROW, id: "other" }, ROW] }) })).mint, ROW.id);
assert.equal(await J.readDeep(ROW.id, { fetchImpl: async () => ({ ok: false, status: 404 }) }), null);
assert.equal(await J.readDeep(ROW.id, { fetchImpl: async () => { throw new Error("gone"); } }), null);

console.log("holders: ok");
