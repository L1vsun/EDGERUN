// Running somebody else's accusation.
//
// `claim.js` made an accusation writable in a form a stranger could check. This is the other
// half: actually checking it, in the reader's own browser, against the same public endpoints
// the reporter used - so believing a claim never requires believing the reporter.
//
// That is the whole point of the format, and until now it stopped one step short. A claim
// carried a `verifyPlan` - a list of curl commands - and a reader who wanted to know had to
// leave, paste them into a terminal, and decode the results by hand. Which means in practice
// nobody did, which means claims were trusted rather than verified, which is the exact
// failure the format was built to fix. A plan nobody runs is prose with a monospace font.
//
// ---- why `equals` exists next to `expect` ----
//
// `expect` is a sentence for a human: "an ABI-encoded string equal to \"TSLA\"". It is not
// machine-comparable, and matching against it with a regex would be a guess dressed as a
// check. So evidence may carry an optional `equals` - the same expectation, structured - and
// this module only ever machine-checks that. Evidence without `equals` is reported as
// MANUAL, with its command, rather than being quietly scored as if it had passed. Claims
// written before `equals` existed stay valid; they just do not self-check.
//
// ---- the rule that matters ----
//
// A network failure is never a contradiction. This codebase's characteristic bug is the false
// accusation, and the same discipline applies one level up: you do not get to call a reporter
// a liar because a public RPC rate-limited you. Unreachable is its own outcome, it never
// produces "contradicted", and a claim that could not be reached is reported as unproven
// rather than as either true or false.

import { decodeString, decodeAddress, decodeUint } from "./chain.js";
import { ALL } from "./chains.js";
import { REGISTRY_URL } from "./registry.js";
import { LIST_URL } from "./lists.js";

const RUNNABLE = new Set(["rpc", "http"]);

/* ---- why a claim cannot send this extension anywhere it likes ----
 *
 * A claim is a document written by a stranger, and it names the endpoints its own evidence
 * should be fetched from. Following that blindly would turn the verifier into a request
 * proxy: paste a crafted claim, and the extension fetches a URL of the author's choosing
 * with the reader's IP, their cookies for that host, and the extension's own host
 * permissions behind it. That is a bad trade for a security tool, and it is a bad trade even
 * when every claim anyone has ever written is honest.
 *
 * So verification only runs against hosts this extension already talks to - the same
 * endpoints in the manifest, derived from the same chain table rather than copied, so adding
 * a chain cannot leave the two lists disagreeing. Everything else is reported as MANUAL with
 * its command attached: the reader can still run it, in their own terminal, with their own
 * eyes on the URL. The claim is not rejected and it is not scored as failing - it simply is
 * not something this browser will fetch on a stranger's say-so.
 */
const ALLOWED_HOSTS = new Set(
  [...ALL.map((c) => c.rpc), REGISTRY_URL, LIST_URL, "https://solana-rpc.publicnode.com"]
    .filter(Boolean)
    .map((u) => {
      try {
        return new URL(u).host;
      } catch {
        return null;
      }
    })
    .filter(Boolean),
);

export function isAllowedEndpoint(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && ALLOWED_HOSTS.has(u.host);
  } catch {
    return false;
  }
}

/** How long any one piece of evidence gets before it counts as unreachable. */
const EVIDENCE_TIMEOUT_MS = 12000;

const norm = (s) => String(s ?? "").trim();
const sameAddress = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();

/**
 * Decode an `eth_call` result the way the evidence says it should be read.
 *
 * Unknown decoders fall through to the raw hex rather than throwing: a claim naming a decoder
 * this version does not have is a claim this version cannot check, which is MANUAL, not
 * contradicted.
 */
function decodeAs(kind, hex) {
  try {
    if (kind === "string") return decodeString(hex);
    if (kind === "address") return decodeAddress(hex);
    if (kind === "uint") return String(decodeUint(hex));
    if (kind === "raw") return norm(hex);
  } catch {
    return null;
  }
  return null;
}

/**
 * Compare one decoded value against an `equals` spec.
 *
 * Returns true, false, or null for "this spec is not one I know how to check", which the
 * caller turns into MANUAL rather than into a failure.
 */
function matches(equals, got, extra = {}) {
  if (!equals || typeof equals !== "object") return null;
  if (typeof equals.reverts === "boolean") return extra.reverted === equals.reverts;
  if (typeof equals.value === "string") {
    return equals.decode === "address" ? sameAddress(equals.value, got) : norm(equals.value) === norm(got);
  }
  if (typeof equals.contains === "string") {
    return norm(got).toLowerCase().includes(norm(equals.contains).toLowerCase());
  }
  return null;
}

async function withTimeout(fetchImpl, url, init, ms) {
  // AbortController is present in every browser this runs in and in Node 18+; the guard is
  // for a caller passing a bare fetch stub in a test.
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  try {
    return await fetchImpl(url, ctrl ? { ...init, signal: ctrl.signal } : init);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runRpc(e, fetchImpl) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: e.method, params: e.params || [] });
  const res = await withTimeout(fetchImpl, e.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }, EVIDENCE_TIMEOUT_MS);
  if (!res?.ok) throw new Error(`endpoint answered ${res?.status ?? "nothing"}`);
  const json = await res.json();

  // A call that REVERTS is the expected outcome for a restricted-transfer claim: "holders
  // provably cannot move this" is proved by the transfer failing. So a revert is a result
  // here, not a failure - but only when the evidence said to expect one. Everywhere else an
  // rpc error still means the endpoint could not answer, which is unreachable, never a
  // contradiction.
  if (e.equals?.reverts !== undefined) {
    const reverted = Boolean(json?.error);
    const why = json?.error?.message || "";
    return { raw: json?.error || json?.result, got: reverted ? `reverted: ${why}` : "the call succeeded", reverted };
  }

  if (json?.error) throw new Error(json.error.message || "rpc error");
  const raw = json?.result;
  const decoded = e.equals?.decode ? decodeAs(e.equals.decode, raw) : norm(raw);
  return { raw, got: decoded };
}

async function runHttp(e, fetchImpl) {
  const res = await withTimeout(fetchImpl, e.url, {}, EVIDENCE_TIMEOUT_MS);
  if (!res?.ok) throw new Error(`document answered ${res?.status ?? "nothing"}`);
  const text = await res.text();
  return { raw: null, got: text };
}

/**
 * Run every runnable piece of evidence in a claim.
 *
 * @param claim     a claim object, ideally one `validateClaim` already accepted
 * @param fetchImpl injected so this is testable without a network
 * @returns {{verdict, says, checks, reproduced, contradicted, manual, unreachable}}
 *
 * `verdict` is one of:
 *   reproduced  - every machine-checkable piece came back as the claim said it would
 *   contradicted - at least one came back DIFFERENT. The claim is wrong, or stale.
 *   unproven    - nothing could be reached, or nothing was machine-checkable
 *   partial     - some reproduced, the rest could not be reached or checked
 */
export async function runClaim(claim, { fetchImpl = fetch, allow = isAllowedEndpoint } = {}) {
  const evidence = (claim?.evidence || []).filter((e) => RUNNABLE.has(e.kind));
  const checks = [];

  for (const e of evidence) {
    const base = { kind: e.kind, means: e.means || "", expect: e.expect || "", where: e.endpoint || e.url || "" };
    // No structured expectation: this is for a human to read, and saying so is the honest
    // outcome. Scoring it as a pass would inflate every claim written before `equals`.
    if (!e.equals) {
      checks.push({ ...base, status: "manual", got: null });
      continue;
    }
    // A host this extension does not already talk to is not fetched on a stranger's say-so.
    if (!allow(base.where)) {
      checks.push({
        ...base,
        status: "manual",
        got: null,
        why: "this endpoint is not one the extension talks to - run it yourself and compare",
      });
      continue;
    }
    try {
      const ran = e.kind === "rpc" ? await runRpc(e, fetchImpl) : await runHttp(e, fetchImpl);
      const { got } = ran;
      const hit = matches(e.equals, got, ran);
      // An http check is containment, not selection: it says the expected value appears in
      // the document, not that it appears in the right FIELD of it. Weaker, and labelled so.
      const shown = e.kind === "http" ? (hit ? "present in the document" : "not found in the document") : got;
      checks.push({
        ...base,
        status: hit === null ? "manual" : hit ? "reproduced" : "contradicted",
        got: shown,
        weak: e.kind === "http",
      });
    } catch (err) {
      checks.push({ ...base, status: "unreachable", got: null, why: String(err?.message || err) });
    }
  }

  const count = (s) => checks.filter((c) => c.status === s).length;
  const reproduced = count("reproduced");
  const contradicted = count("contradicted");
  const manual = count("manual");
  const unreachable = count("unreachable");

  let verdict;
  if (contradicted) verdict = "contradicted";
  else if (reproduced && !unreachable && !manual) verdict = "reproduced";
  else if (reproduced) verdict = "partial";
  else verdict = "unproven";

  return { verdict, says: claim?.says || "", id: claim?.id || null, checks, reproduced, contradicted, manual, unreachable };
}

/** One line a human can read off the result, in this project's voice: plain and bounded. */
export function sayResult(r) {
  if (!r) return "nothing to check";
  if (r.verdict === "contradicted") {
    return `This claim does not hold: ${r.contradicted} of its checks came back different from what it says.`;
  }
  if (r.verdict === "reproduced") {
    return `Reproduced. ${r.reproduced} check${r.reproduced === 1 ? "" : "s"} ran here and matched, without trusting the reporter.`;
  }
  if (r.verdict === "partial") {
    const rest = [r.unreachable ? `${r.unreachable} unreachable` : null, r.manual ? `${r.manual} to read by hand` : null]
      .filter(Boolean)
      .join(", ");
    return `${r.reproduced} of its checks reproduced here; ${rest}.`;
  }
  if (r.unreachable) return "Could not be checked: the endpoints it names did not answer. That is not evidence against it.";
  return "Nothing in this claim can be checked automatically - the evidence is written for a human to run.";
}
