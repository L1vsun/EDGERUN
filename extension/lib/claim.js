// A claim: one accusation, shaped so a stranger who does not trust you can re-derive it.
//
// Everything in this project ran into the same wall. On Robinhood Chain there is a published
// registry, so "that is not Tesla" is a fact. On Ethereum, Base and Solana there is no such
// thing, and the strongest honest sentence available was "a curated list disagrees". Curated
// lists catalogue what is legitimate; almost nobody maintains the negative space - what is
// *pretending* - in a form anything can query.
//
// The blocklist in this repo is the prototype of that negative space and it is already better
// than most: the entries are readable, and git log says who added each one. But its `evidence`
// field is PROSE -
//
//   "eth_call transfer(0x…dEaD, 1) simulated from each of the 3 top holders, all reverted"
//
// - and prose is not re-runnable. A reader who wants to check it has to reconstruct the call
// by hand, which means in practice nobody checks, which means the list is trusted rather than
// verified. That is the difference between a registry and a rumour with a URL in front of it.
//
// So a claim carries its evidence as INSTRUCTIONS plus EXPECTED RESULTS. The rule the
// validator enforces, and the only rule that really matters:
//
//   A claim needs at least one piece of evidence a stranger can execute. A claim made
//   entirely of prose is rejected, however true it is.
//
// The second rule is the one this codebase learned the hard way, twice, from false positives:
// an impersonation claim must establish BOTH SIDES. "This is not the real TSLA" is uncheckable
// unless the claim also says, reproducibly, what the real TSLA is. Otherwise the reader is
// trusting the reporter about the very thing in dispute.
//
// Pure: no chrome APIs, no network, no storage. It builds, validates and explains claims.
// Executing them is deliberately somebody else's job - including a stranger's.

export const CLAIM_VERSION = 1;

export const CLAIM_TYPES = {
  // this contract presents itself as a specific other token and is not it
  impersonation: { needsTarget: true },
  // this contract wears the name of an established token on a different chain
  "cross-chain-name": { needsTarget: true },
  // holders provably cannot move it
  "restricted-transfer": { needsTarget: false },
  // several contracts on one chain answer to the same ticker
  "symbol-collision": { needsTarget: false },
};

// Evidence a stranger can run. `note` is allowed, and deliberately does not count.
const RUNNABLE = new Set(["rpc", "http"]);

const lower = (a) => (/^0x[0-9a-fA-F]{40}$/.test(String(a || "")) ? String(a).toLowerCase() : String(a || ""));

/**
 * A deterministic, readable id.
 *
 * Content-derived rather than assigned, so two people who report the same thing without ever
 * speaking produce the same id and the registry can merge them. Readable rather than hashed,
 * because these end up in a git-tracked file that humans review, and a diff full of opaque
 * digests is a diff nobody reads.
 */
export function claimId({ type, subject, target }) {
  const part = (r) => (r ? `${r.chain}:${lower(r.address)}` : "-");
  return `${type}/${part(subject)}/of/${part(target)}`;
}

/**
 * An `eth_call` anyone can paste into curl, with what it should return.
 *
 * `expect` is the sentence a human reads. `equals` is the same expectation in a form a
 * machine can compare - `{ decode: "string"|"address"|"uint"|"raw", value }` - and is what
 * `verify.js` actually checks against. Both, because matching a regex against the human
 * sentence would be a guess wearing the costume of a check. Optional: evidence without it is
 * reported as needing a human, never as passing.
 */
export const rpcEvidence = ({ endpoint, method, params, expect, means, at, equals }) => ({
  kind: "rpc",
  endpoint,
  method,
  params,
  expect,
  means,
  ...(equals ? { equals } : {}),
  ...(at ? { at } : {}),
});

/**
 * A fact read out of a public document, addressed precisely enough to find again.
 *
 * `pointer` is a jq expression for a person at a terminal. `equals` here is `{ contains }`,
 * because an automatic check of a document fetched in a browser is containment, not
 * selection - it establishes that the expected value is in the document, not that it sits in
 * the right field. Genuinely weaker, reported as weaker, and not pretended otherwise.
 */
export const httpEvidence = ({ url, pointer, expect, means, equals }) => ({
  kind: "http",
  url,
  pointer,
  expect,
  means,
  ...(equals ? { equals } : {}),
});

/** Context a human needs and a machine cannot check. Never counts toward verifiability. */
export const note = (text) => ({ kind: "note", means: text });

export function makeClaim({ type, subject, target = null, says, evidence = [], observed = {}, by = null, method = null }) {
  const claim = {
    v: CLAIM_VERSION,
    id: claimId({ type, subject, target }),
    type,
    subject: subject ? { chain: subject.chain, address: lower(subject.address), ...(subject.label ? { label: subject.label } : {}) } : null,
    target: target ? { chain: target.chain, address: lower(target.address), ...(target.label ? { label: target.label } : {}) } : null,
    says,
    evidence,
    observed: { at: observed.at || new Date().toISOString(), ...(observed.block ? { block: observed.block } : {}) },
    by: by || { kind: "anon" },
    method: method || { name: "edgerun", version: "0" },
  };
  return claim;
}

/**
 * Is this claim checkable by someone who does not trust the reporter.
 *
 * Not "is it true" - nothing here runs anything. The question is narrower and more useful:
 * has the reporter written down enough that the reader could find out for themselves.
 */
export function validateClaim(claim) {
  const errors = [];
  const add = (e) => errors.push(e);

  if (!claim || typeof claim !== "object") return { ok: false, errors: ["not an object"] };
  if (claim.v !== CLAIM_VERSION) add(`unknown claim version ${claim.v}`);

  const spec = CLAIM_TYPES[claim.type];
  if (!spec) add(`unknown claim type ${JSON.stringify(claim.type)}`);

  if (!claim.subject?.address) add("no subject address");
  if (claim.subject && !Number.isFinite(Number(claim.subject.chain))) add("subject has no chain");

  if (spec?.needsTarget && !claim.target?.address) {
    add(`a ${claim.type} claim must name what the subject is pretending to be`);
  }
  if (claim.target && !Number.isFinite(Number(claim.target.chain))) add("target has no chain");

  if (claim.subject && claim.target &&
      Number(claim.subject.chain) === Number(claim.target.chain) &&
      lower(claim.subject.address) === lower(claim.target.address)) {
    add("subject and target are the same token");
  }

  if (!claim.says || String(claim.says).trim().length < 10) add("no readable statement of what is being claimed");

  const evidence = Array.isArray(claim.evidence) ? claim.evidence : [];
  const runnable = evidence.filter((e) => RUNNABLE.has(e?.kind));

  // THE rule. Prose is welcome and proves nothing.
  if (!runnable.length) {
    add("no evidence a stranger can run - a claim built only from prose is a report, not a claim");
  }

  evidence.forEach((e, i) => {
    if (!e?.kind) return add(`evidence[${i}] has no kind`);
    if (!RUNNABLE.has(e.kind) && e.kind !== "note") add(`evidence[${i}] has unknown kind ${JSON.stringify(e.kind)}`);
    if (RUNNABLE.has(e.kind) && (e.expect === undefined || e.expect === null || e.expect === "")) {
      add(`evidence[${i}] has no expected result, so running it proves nothing`);
    }
    if (e.kind === "rpc" && (!e.endpoint || !e.method)) add(`evidence[${i}] is an rpc call with no endpoint or method`);
    if (e.kind === "http" && !e.url) add(`evidence[${i}] is an http fact with no url`);
  });

  // Both sides, and it has to be evidence rather than assertion. This is the rule that would
  // have caught the two false positives this surface shipped: each of them asserted what the
  // real token was instead of showing it.
  if (spec?.needsTarget && runnable.length) {
    // Matched on ADDRESS only, never on the label. In an impersonation claim the subject's own
    // symbol is the target's label - a fake TSLA calls itself TSLA - so a label match is
    // satisfied by evidence about the subject and establishes nothing about the target. The
    // only way to show what the real one is, is to point at it.
    const mentions = (needle) =>
      needle && runnable.some((e) => JSON.stringify(e).toLowerCase().includes(String(needle).toLowerCase()));
    const mentionsSubject = mentions(lower(claim.subject?.address));
    const mentionsTarget = mentions(lower(claim.target?.address));
    if (!mentionsSubject) add("no runnable evidence about the subject");
    if (!mentionsTarget) add("no runnable evidence establishing the target - the reader would have to take your word for what the real one is");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * The claim, rendered as the commands that check it.
 *
 * This is the promise made literal: a claim that cannot print its own verification steps was
 * never checkable, and a reader should not have to believe a word of the prose above it.
 */
export function verifyPlan(claim) {
  const lines = [];
  for (const e of claim?.evidence || []) {
    if (e.kind === "rpc") {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: e.method, params: e.params || [] });
      lines.push({
        run: `curl -s -X POST ${e.endpoint} -H 'Content-Type: application/json' -d '${body}'`,
        expect: e.expect,
        means: e.means,
      });
    } else if (e.kind === "http") {
      lines.push({
        run: e.pointer ? `curl -s ${e.url} | jq '${e.pointer}'` : `curl -s ${e.url}`,
        expect: e.expect,
        means: e.means,
      });
    }
  }
  return lines;
}

/**
 * Pull claims out of whatever somebody actually pasted.
 *
 * The receiving end of sharing, and it has to be tolerant, because what a person pastes is
 * rarely a bare document. This project's own "copy claim" emits JSON followed by a prose
 * "How to check it:" block; a claim arriving from a chat app carries quote markers and a
 * name; one from a pull request arrives inside a fenced code block. Rejecting all of those
 * for not being clean JSON would make the format shareable in theory only.
 *
 * So: find every balanced brace run, try to parse each, and keep the ones shaped like a
 * claim. Shape, not validity - `validateClaim` is the judge of whether a claim is checkable,
 * and it must get the chance to say so with its own reasons rather than have this quietly
 * drop the thing and leave the reader staring at "nothing found".
 */
export function parseClaims(text) {
  const s = String(text || "");
  const out = [];
  const seen = new Set();
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < s.length; j++) {
      const ch = s[j];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth !== 0) continue;
        try {
          const parsed = JSON.parse(s.slice(i, j + 1));
          if (parsed && typeof parsed === "object" && parsed.type && Array.isArray(parsed.evidence)) {
            const key = parsed.id || JSON.stringify(parsed);
            if (!seen.has(key)) { seen.add(key); out.push(parsed); }
          }
        } catch {
          /* not JSON, or not whole: the next brace gets its own try */
        }
        i = j; // skip past what was just consumed, balanced or not
        break;
      }
    }
  }
  return out;
}

/** The plan as text, for a pull request body or a clipboard. */
export function verifyPlanText(claim) {
  const steps = verifyPlan(claim);
  if (!steps.length) return "This claim carries nothing that can be run.";
  return steps
    .map((s, i) => `${i + 1}. ${s.means}\n   $ ${s.run}\n   expect: ${s.expect}`)
    .join("\n\n");
}
