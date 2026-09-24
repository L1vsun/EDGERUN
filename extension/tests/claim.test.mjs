// The claim schema: what an accusation must carry to be checkable by someone who does not
// trust the person making it.
//
// The two rules under test are the ones this project learned from its own failures:
//   1. evidence must be runnable. Prose is a report, not a claim.
//   2. an impersonation claim must establish BOTH sides. "This is not the real TSLA" is
//      uncheckable unless the claim also shows, reproducibly, what the real TSLA is.
import assert from "node:assert/strict";

const {
  makeClaim, validateClaim, claimId, rpcEvidence, httpEvidence, note, verifyPlan, verifyPlanText,
} = await import("../lib/claim.js");

const FAKE = "0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715";
const REAL = "0x322f0929000000000000000000000000000000ab";

const symbolEv = (address) =>
  rpcEvidence({
    endpoint: "https://rpc.mainnet.chain.robinhood.com",
    method: "eth_call",
    params: [{ to: address, data: "0x95d89b41" }, "latest"],
    expect: 'an ABI-encoded string equal to "TSLA"',
    means: `${address} calls itself TSLA`,
  });

const registryEv = () =>
  httpEvidence({
    url: "https://api.robinhood.com/rhj/assets",
    pointer: '.assets[] | select(.tokenSymbol=="TSLA")',
    expect: REAL,
    means: "the issuer's registry gives TSLA as this address",
  });

const good = () =>
  makeClaim({
    type: "impersonation",
    subject: { chain: 4663, address: FAKE, label: "TSLA" },
    target: { chain: 4663, address: REAL, label: "TSLA" },
    says: "This contract presents itself as $TSLA and is not the address Robinhood publishes.",
    evidence: [symbolEv(FAKE), registryEv()],
  });

// ---- ids are content-derived, so two strangers reporting the same thing collide on purpose
const a = claimId({ type: "impersonation", subject: { chain: 4663, address: FAKE }, target: { chain: 4663, address: REAL } });
const b = claimId({ type: "impersonation", subject: { chain: 4663, address: FAKE.toLowerCase() }, target: { chain: 4663, address: REAL } });
assert.equal(a, b, "hex casing must not produce two ids for one claim");
assert.match(a, /^impersonation\/4663:0xd18f/, "ids are readable - these land in a git diff humans review");
assert.notEqual(a, claimId({ type: "impersonation", subject: { chain: 1, address: FAKE }, target: { chain: 1, address: REAL } }),
  "the same address on another chain is a different claim");

// base58 must survive: lowercasing a Solana mint produces a string that is not the address
const MINT = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
assert.ok(claimId({ type: "impersonation", subject: { chain: 501000101, address: MINT }, target: null }).includes(MINT));

// ---- the happy path
let v = validateClaim(good());
assert.equal(v.ok, true, v.errors.join("; "));

// ---- rule 1: prose is not evidence
let c = good();
c.evidence = [note("trust me, I have seen this before"), note("everyone knows it is fake")];
v = validateClaim(c);
assert.equal(v.ok, false);
assert.match(v.errors.join(), /a report, not a claim/);

// a note ALONGSIDE runnable evidence is fine - context is welcome, it just proves nothing
c = good();
c.evidence = [...c.evidence, note("also the deployer has launched 40 of these")];
assert.equal(validateClaim(c).ok, true);

// ---- rule 2: both sides, or the reader is trusting you about the thing in dispute
c = good();
c.evidence = [symbolEv(FAKE)]; // only the accusation, nothing establishing the real one
v = validateClaim(c);
assert.equal(v.ok, false);
assert.match(v.errors.join(), /take your word for what the real one is/);

c = good();
c.evidence = [registryEv()]; // only the target
assert.match(validateClaim(c).errors.join(), /no runnable evidence about the subject/);

// ---- a claim with no expected result proves nothing when run
c = good();
c.evidence = [{ ...symbolEv(FAKE), expect: "" }, registryEv()];
assert.match(validateClaim(c).errors.join(), /no expected result/);

// ---- structural
c = good();
c.target = null;
assert.match(validateClaim(c).errors.join(), /must name what the subject is pretending to be/);

c = good();
c.target = { chain: 4663, address: FAKE };
assert.match(validateClaim(c).errors.join(), /subject and target are the same token/);

c = good();
c.says = "bad";
assert.match(validateClaim(c).errors.join(), /no readable statement/);

c = good();
c.type = "vibes";
assert.match(validateClaim(c).errors.join(), /unknown claim type/);

c = good();
c.v = 99;
assert.match(validateClaim(c).errors.join(), /unknown claim version/);

assert.equal(validateClaim(null).ok, false);
assert.equal(validateClaim("nope").ok, false);

// ---- a type that needs no target still needs runnable evidence
const restricted = makeClaim({
  type: "restricted-transfer",
  subject: { chain: 4663, address: FAKE },
  says: "Simulated transfers revert for every holder tested.",
  evidence: [symbolEv(FAKE)],
});
assert.equal(validateClaim(restricted).ok, true, "no target required, evidence still is");

// ---- the claim prints its own verification
const plan = verifyPlan(good());
assert.equal(plan.length, 2, "notes are not steps");
assert.match(plan[0].run, /^curl -s -X POST https:\/\/rpc\.mainnet\.chain\.robinhood\.com/);
assert.match(plan[0].run, /"method":"eth_call"/);
assert.match(plan[1].run, /jq /);
assert.ok(plan.every((s) => s.expect), "a step with no expected result is not a check");

const text = verifyPlanText(good());
assert.match(text, /1\. /);
assert.match(text, /expect: /);
assert.equal(verifyPlanText({ evidence: [note("x")] }), "This claim carries nothing that can be run.");

console.log("claim: ok");
