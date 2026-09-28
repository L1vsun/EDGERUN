// Running somebody else's accusation.
//
// The format could always be checked BY HAND. This is the part that checks it here, in the
// reader's browser, so believing a claim never requires believing the reporter.
//
// The assertion this file exists for is the one about UNREACHABLE: a public RPC that rate
// limits you must never turn into "this claim is false". The characteristic bug of this
// codebase is the false accusation, and a verifier that calls reporters liars when the
// network hiccups is that same bug one level up.
import assert from "node:assert/strict";
import { runClaim, sayResult } from "../lib/verify.js";

// ---- helpers: a fake endpoint and a real ABI string ----
const abiString = (s) => {
  const hex = Buffer.from(s, "utf8").toString("hex");
  const pad = (h) => h + "0".repeat((64 - (h.length % 64)) % 64);
  return "0x" + "20".padStart(64, "0") + s.length.toString(16).padStart(64, "0") + pad(hex);
};

const okJson = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const okText = (text) => ({ ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) });
const dead = () => { throw new Error("network is down"); };

const rpcEv = (equals) => ({
  kind: "rpc", endpoint: "https://rpc.example/", method: "eth_call",
  params: [{ to: "0xabc", data: "0x95d89b41" }, "latest"],
  expect: 'an ABI-encoded string equal to "TSLA"', means: "it calls itself TSLA",
  ...(equals === undefined ? {} : { equals }),
});

const claimWith = (...evidence) => ({ id: "t/1", says: "it is not the real one", evidence });

// ---- it reproduces ----
let r = await runClaim(claimWith(rpcEv({ decode: "string", value: "TSLA" })), {
  allow: () => true, fetchImpl: async () => okJson({ result: abiString("TSLA") }),
});
assert.equal(r.verdict, "reproduced");
assert.equal(r.reproduced, 1);
assert.equal(r.checks[0].got, "TSLA");
assert.match(sayResult(r), /Reproduced\. 1 check ran here and matched/);

// ---- it is contradicted: the chain said something else ----
r = await runClaim(claimWith(rpcEv({ decode: "string", value: "TSLA" })), {
  allow: () => true, fetchImpl: async () => okJson({ result: abiString("NVDA") }),
});
assert.equal(r.verdict, "contradicted");
assert.equal(r.checks[0].got, "NVDA");
assert.match(sayResult(r), /does not hold/);

// ---- THE RULE: unreachable is never a contradiction ----
r = await runClaim(claimWith(rpcEv({ decode: "string", value: "TSLA" })), { allow: () => true, fetchImpl: dead });
assert.equal(r.checks[0].status, "unreachable");
assert.equal(r.contradicted, 0, "a dead endpoint does not disprove anything");
assert.equal(r.verdict, "unproven");
assert.match(sayResult(r), /That is not evidence against it\./);

// an endpoint that answers with an error is also unreachable, not a contradiction
r = await runClaim(claimWith(rpcEv({ decode: "string", value: "TSLA" })), {
  allow: () => true, fetchImpl: async () => okJson({ error: { message: "rate limited" } }),
});
assert.equal(r.checks[0].status, "unreachable");
assert.equal(r.contradicted, 0);

// so is an HTTP error status
r = await runClaim(claimWith(rpcEv({ decode: "string", value: "TSLA" })), {
  allow: () => true, fetchImpl: async () => ({ ok: false, status: 429 }),
});
assert.equal(r.checks[0].status, "unreachable");
assert.match(r.checks[0].why, /429/);

// ---- evidence with no machine-readable expectation is never scored as a pass ----
r = await runClaim(claimWith(rpcEv(undefined)), { allow: () => true, fetchImpl: async () => okJson({ result: abiString("TSLA") }) });
assert.equal(r.checks[0].status, "manual", "prose expectations are for a human, not a score");
assert.equal(r.verdict, "unproven");
assert.match(sayResult(r), /written for a human to run/);

// ---- a note never counts, however true it is ----
r = await runClaim(claimWith({ kind: "note", means: "tier-2 evidence" }), { allow: () => true, fetchImpl: dead });
assert.equal(r.checks.length, 0, "notes are not evidence and are not run");

// ---- http evidence is containment, and says so ----
const httpEv = {
  kind: "http", url: "https://registry.example/list.json",
  pointer: '.assets[] | select(.s=="TSLA")', expect: "0xD18F",
  equals: { contains: "0xD18F5e73" }, means: "the issuer publishes it here",
};
r = await runClaim(claimWith(httpEv), { allow: () => true, fetchImpl: async () => okText('{"a":"0xd18f5e73ec"}') });
assert.equal(r.verdict, "reproduced");
assert.equal(r.checks[0].weak, true, "containment is a weaker tier and is labelled");
assert.equal(r.checks[0].got, "present in the document");

r = await runClaim(claimWith(httpEv), { allow: () => true, fetchImpl: async () => okText('{"a":"0xsomethingelse"}') });
assert.equal(r.verdict, "contradicted");
assert.equal(r.checks[0].got, "not found in the document");

// ---- addresses compare case-insensitively, because hex does ----
r = await runClaim(claimWith({ ...rpcEv({ decode: "address", value: "0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715" }) }), {
  allow: () => true, fetchImpl: async () => okJson({ result: "0x" + "0".repeat(24) + "d18f5e73ec5e2d0b18ebe97426dc5edc2c887715" }),
});
assert.equal(r.verdict, "reproduced", "0xD18F… and 0xd18f… are one address");

// ---- mixed: some ran, some could not ----
r = await runClaim(
  claimWith(rpcEv({ decode: "string", value: "TSLA" }), { ...httpEv, url: "https://dead.example/" }),
  {
    allow: () => true, fetchImpl: async (url) =>
      String(url).includes("dead") ? dead() : okJson({ result: abiString("TSLA") }),
  },
);
assert.equal(r.verdict, "partial");
assert.equal(r.reproduced, 1);
assert.equal(r.unreachable, 1);
assert.match(sayResult(r), /1 of its checks reproduced here; 1 unreachable/);

// ---- one contradiction outranks any number of passes ----
r = await runClaim(
  claimWith(rpcEv({ decode: "string", value: "TSLA" }), { ...httpEv, equals: { contains: "nowhere" } }),
  {
    allow: () => true, fetchImpl: async (url) =>
      String(url).includes("registry") ? okText("{}") : okJson({ result: abiString("TSLA") }),
  },
);
assert.equal(r.verdict, "contradicted", "a claim with one false leg is a claim that does not hold");

// ---- an empty claim is unproven, not true ----
r = await runClaim({ evidence: [] }, { allow: () => true, fetchImpl: dead });
assert.equal(r.verdict, "unproven");
assert.equal(sayResult(null), "nothing to check");

// ---- the receiving end: parsing whatever somebody actually pasted ----
const { parseClaims, validateClaim } = await import("../lib/claim.js");

// A realistic claim: an impersonation must show BOTH sides with runnable evidence - what the
// subject calls itself, AND where the real one is - or validateClaim rejects it. That rule is
// the one that would have caught this surface's two shipped false positives.
const SUBJECT = "0xe9202e91a664fcfc2ee911f617c12b8f64b12f2f";
const TARGET = "0xd18f5e73ec5e2d0b18ebe97426dc5edc2c887715";
const real = {
  v: 1, id: `impersonation/4663:${SUBJECT}/of/4663:${TARGET}`, type: "impersonation",
  subject: { chain: 4663, address: SUBJECT }, target: { chain: 4663, address: TARGET, label: "TSLA" },
  says: `${SUBJECT} presents itself as $TSLA, which Robinhood publishes at ${TARGET}.`,
  evidence: [
    { ...rpcEv({ decode: "string", value: "TSLA" }), params: [{ to: SUBJECT, data: "0x95d89b41" }, "latest"] },
    {
      kind: "http", url: "https://registry.example/list.json",
      pointer: '.assets[] | select(.tokenSymbol=="TSLA")', expect: TARGET,
      equals: { contains: TARGET }, means: "the issuer's own registry gives TSLA at this address",
    },
  ],
  observed: { at: "2026-09-28T00:00:00Z" }, by: { kind: "anon" }, method: { name: "edgerun", version: "0" },
};
const json = JSON.stringify(real, null, 2);

assert.equal(parseClaims(json).length, 1, "bare JSON");
assert.equal(parseClaims(`${json}\n\nHow to check it:\n1. run this\n   $ curl -s x`).length, 1,
  "what this project's own copy button emits");
assert.equal(parseClaims("look at this:\n```json\n" + json + "\n```\nthoughts?").length, 1,
  "inside a fenced code block, as it arrives from a pull request");
assert.equal(parseClaims(`> ${json}`).length, 1, "quoted in a chat reply");
assert.equal(parseClaims(`${json}\n---\n${json}`).length, 1, "the same claim twice is one claim");

// two DIFFERENT claims in one paste both survive
const other = { ...real, id: "other/1", says: "something else" };
assert.equal(parseClaims(`${json}\n\n${JSON.stringify(other)}`).length, 2);

// ---- things that are not claims ----
assert.equal(parseClaims("").length, 0);
assert.equal(parseClaims("no braces here at all").length, 0);
assert.equal(parseClaims('{"hello":"world"}').length, 0, "JSON is not automatically a claim");
assert.equal(parseClaims("{ not json {{{").length, 0, "unbalanced junk does not hang or throw");
assert.equal(parseClaims('{"type":"x","evidence":"not-an-array"}').length, 0);

// a brace inside a STRING must not end the object early
const tricky = JSON.stringify({ ...real, says: "it contains a } brace and a { one" });
assert.equal(parseClaims(tricky).length, 1);

// ---- parsing is shape-checking, not judging: an unverifiable claim still comes through ----
const proseOnly = { ...real, evidence: [{ kind: "note", means: "trust me" }] };
const got = parseClaims(JSON.stringify(proseOnly));
assert.equal(got.length, 1, "it parses...");
assert.equal(validateClaim(got[0]).ok, false, "...and then validateClaim gets to reject it with reasons");

// ---- the whole loop: paste a stranger's claim, run it, disbelieve it ----
const pasted = parseClaims(`someone in a group chat said:\n${json}`)[0];
assert.equal(validateClaim(pasted).ok, true, validateClaim(pasted).errors?.join("; "));

// the accusation holds up: the chain and the registry both say what the reporter said
let ran = await runClaim(pasted, {
  allow: () => true, fetchImpl: async (url) =>
    String(url).includes("registry") ? okText(`{"a":"${TARGET}"}`) : okJson({ result: abiString("TSLA") }),
});
assert.equal(ran.verdict, "reproduced");
assert.equal(ran.reproduced, 2);

// and the same machinery disbelieves it when the chain disagrees
ran = await runClaim(pasted, {
  allow: () => true, fetchImpl: async (url) =>
    String(url).includes("registry") ? okText(`{"a":"${TARGET}"}`) : okJson({ result: abiString("NVDA") }),
});
assert.equal(ran.verdict, "contradicted",
  "a stranger's accusation, checked against the chain, and found wanting - without trusting them");

// ---- a claim cannot make this extension fetch wherever it likes ----
//
// A claim is a stranger's document that names its own endpoints. Following that blindly would
// turn the verifier into a request proxy pointed wherever the author chose, carrying the
// reader's IP and the extension's host permissions. So verification only runs against hosts
// the extension already talks to; anything else is handed back as a command to run by hand.
const { isAllowedEndpoint } = await import("../lib/verify.js");

assert.equal(isAllowedEndpoint("https://rpc.mainnet.chain.robinhood.com"), true, "a chain in the table");
assert.equal(isAllowedEndpoint("https://ethereum-rpc.publicnode.com/anything"), true);
assert.equal(isAllowedEndpoint("https://evil.example/collect"), false);
assert.equal(isAllowedEndpoint("http://rpc.mainnet.chain.robinhood.com"), false, "plain http is not allowed either");
assert.equal(isAllowedEndpoint("https://rpc.mainnet.chain.robinhood.com.evil.example"), false,
  "a suffix that merely looks like an allowed host is a different host");
assert.equal(isAllowedEndpoint("not a url"), false);
assert.equal(isAllowedEndpoint(""), false);

// and the real default refuses to fetch an unknown host, without calling the claim false
let blocked = false;
r = await runClaim(claimWith(rpcEv({ decode: "string", value: "TSLA" })), {
  fetchImpl: async () => { blocked = true; return okJson({ result: abiString("NVDA") }); },
});
assert.equal(blocked, false, "the endpoint was never contacted");
assert.equal(r.checks[0].status, "manual");
assert.match(r.checks[0].why, /run it yourself/);
assert.equal(r.contradicted, 0, "refusing to fetch is not evidence against the claim");
assert.equal(r.verdict, "unproven");

// ---- restricted-transfer: evidence whose expected outcome is a REVERT ----
//
// "Holders provably cannot move it" is the strongest finding this project makes, and it was
// the one that could not become a claim: the exit test threw the holder addresses away and
// kept a sentence with a shortened address in it. Now the holders travel with the check.
//
// The semantics are inverted here and that is the whole subtlety: a call that fails is the
// evidence. It must NOT be confused with an endpoint that could not be reached.
const { restrictedTransferClaim } = await import("../lib/claim-from.js");

const HOLDER_A = "0x1111111111111111111111111111111111111111";
const HOLDER_B = "0x2222222222222222222222222222222222222222";
const blockedVerdict = {
  address: "0xd18f5e73ec5e2d0b18ebe97426dc5edc2c887715", symbol: "TSLA", scannedAt: Date.now(),
  checks: [{
    id: "exit_test", label: "exit test", status: "fail", detail: "all holders blocked",
    data: { sink: "0x000000000000000000000000000000000000dEaD", amount: "1",
            blocked: [{ address: HOLDER_A, why: "blacklisted" }], passed: [] },
  }],
};

const rt = restrictedTransferClaim(blockedVerdict);
assert.ok(rt, "a blocked exit test now produces a claim");
assert.equal(rt.type, "restricted-transfer");
assert.equal(rt.target, null, "nothing is being impersonated, so there is no target to show");
assert.equal(validateClaim(rt).ok, true, validateClaim(rt).errors?.join("; "));
assert.ok(rt.evidence[0].params[0].from === HOLDER_A, "it re-runs the call from the real holder");
assert.deepEqual(rt.evidence[0].equals, { reverts: true });

// the revert IS the reproduction
r = await runClaim(rt, { allow: () => true, fetchImpl: async () => okJson({ error: { message: "execution reverted: blacklisted" } }) });
assert.equal(r.verdict, "reproduced", "a call that reverts as predicted reproduces the claim");
assert.match(r.checks[0].got, /^reverted: execution reverted/);

// and a call that unexpectedly SUCCEEDS contradicts it - the token became movable
r = await runClaim(rt, { allow: () => true, fetchImpl: async () => okJson({ result: "0x01" }) });
assert.equal(r.verdict, "contradicted", "if holders can move it now, the claim no longer holds");
assert.equal(r.checks[0].got, "the call succeeded");

// a dead endpoint is STILL not a reproduction, even though this evidence expects a failure
r = await runClaim(rt, { allow: () => true, fetchImpl: dead });
assert.equal(r.checks[0].status, "unreachable");
assert.equal(r.reproduced, 0, "an unreachable endpoint must never be mistaken for a revert");

// ---- selective restriction: some move, some cannot, same block ----
const selective = restrictedTransferClaim({
  ...blockedVerdict,
  checks: [{ ...blockedVerdict.checks[0], status: "warn",
    data: { ...blockedVerdict.checks[0].data, passed: [HOLDER_B] } }],
});
assert.match(selective.says, /selective restriction/);
assert.equal(selective.evidence.filter((e) => e.kind === "rpc").length, 2,
  "both sides: one holder who cannot move it and one who can");
assert.deepEqual(selective.evidence[1].equals, { reverts: false });

// an exit test that PASSED makes no claim at all
assert.equal(restrictedTransferClaim({ address: "0xa", checks: [{ id: "exit_test", status: "ok" }] }), null);
assert.equal(restrictedTransferClaim({ address: "0xa", checks: [] }), null);
// nor does a fail with no structured residue - an old verdict from before `data` existed
assert.equal(restrictedTransferClaim({ address: "0xa", checks: [{ id: "exit_test", status: "fail" }] }), null,
  "no holders recorded means nothing to re-run, and a claim that cannot be re-run is not made");

// ---- the worked example shipped in the panel ----
//
// The claims tab is unusable until somebody sends you a claim, so it ships with a real one:
// this project's own blocklist entry, rewritten in the format. It has to be VALID and it has
// to be self-checkable, or the first thing a new user clicks returns "nothing can be checked
// automatically" and teaches them the feature does not work.
//
// Offline here on purpose - a test suite that needs the network is a test suite that fails on
// a plane. Both facts were confirmed against live endpoints on 2026-09-28 and the claim came
// back reproduced, 2 of 2.
const { exampleClaim } = await import("../lib/example-claim.js");
const ex = exampleClaim();
const exValid = validateClaim(ex);
assert.equal(exValid.ok, true, exValid.errors?.join("; "));

const exRunnable = ex.evidence.filter((e) => e.kind === "rpc" || e.kind === "http");
assert.equal(exRunnable.length, 2, "two runnable legs: what it calls itself, and what the real one is");
assert.ok(exRunnable.every((e) => e.equals), "every runnable leg carries a machine-checkable expectation");
assert.ok(ex.evidence.some((e) => e.kind === "note"), "and the note explaining the both-sides rule");

// it must point at endpoints the verifier will actually contact, or the example returns
// "run it yourself" and demonstrates nothing
assert.ok(exRunnable.every((e) => isAllowedEndpoint(e.endpoint || e.url)),
  "the example only uses endpoints the extension already talks to");

// and it must survive the round trip through a clipboard
assert.equal(parseClaims(JSON.stringify(ex, null, 2))[0].id, ex.id);

console.log("verify: ok");
