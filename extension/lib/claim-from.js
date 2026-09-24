// Turning a verdict this extension reached into a claim a stranger can re-run.
//
// Kept apart from claim.js on purpose. claim.js knows what a claim is and nothing about this
// product; this file knows where Robinhood publishes its registry and which selector returns
// a symbol. The schema has to outlive the checker that first filled it in, or the registry is
// just this extension's output with extra steps.
//
// Only the claim types whose evidence can be made genuinely executable are built here. The
// exit sweep is the clear example of what is deliberately NOT built: "three top holders could
// not transfer" needs those holders' addresses to be re-runnable, and the current check keeps
// them only inside a prose sentence. Emitting that as a claim would produce something that
// passes validation while being unverifiable in practice, which is worse than emitting
// nothing. The check has to hand up structured holders first.

import { HOME, chainName } from "./chains.js";
import { httpEvidence, makeClaim, note, rpcEvidence } from "./claim.js";
import { SEL } from "./chain.js";
import { REGISTRY_URL } from "./registry.js";
import { LIST_NAME, LIST_URL } from "./lists.js";

const METHOD = { name: "edgerun/extension", version: "0.1.0" };

/** `symbol()`, written as a call anyone can paste into curl, with the answer it should give. */
const symbolCall = (chain, address, expect) =>
  rpcEvidence({
    endpoint: chain.rpc,
    method: "eth_call",
    params: [{ to: address, data: SEL.symbol }, "latest"],
    expect: `an ABI-encoded string equal to ${JSON.stringify(expect)}`,
    means: `${address} calls itself ${expect} on ${chain.name}`,
  });

/**
 * A registry-backed impersonation claim: the strongest kind this project can make, because
 * the issuer publishes the answer and the reader can fetch it without trusting anyone.
 */
export function impersonationClaim(verdict, { chain = HOME } = {}) {
  const i = verdict?.impersonates;
  if (!i?.ticker || !i?.officialAddress) return null;

  return makeClaim({
    type: "impersonation",
    subject: { chain: chain.id, address: verdict.address, ...(verdict.symbol ? { label: verdict.symbol } : {}) },
    target: { chain: chain.id, address: i.officialAddress, label: i.ticker },
    says: `${verdict.address} presents itself as $${i.ticker} on ${chain.name}. Robinhood publishes $${i.ticker} at ${i.officialAddress}, which is a different contract.`,
    evidence: [
      symbolCall(chain, verdict.address, verdict.symbol || i.ticker),
      httpEvidence({
        url: REGISTRY_URL,
        pointer: `.assets[] | select(.tokenSymbol=="${i.ticker}") | .deployments[] | select(.chainId==${chain.id}) | .contractAddress`,
        expect: i.officialAddress,
        means: `the issuer's own registry gives $${i.ticker} on ${chain.name} as ${i.officialAddress}`,
      }),
    ],
    observed: { at: new Date(verdict.scannedAt || Date.now()).toISOString() },
    method: METHOD,
  });
}

/**
 * The cross-chain case, which is the one a single-chain scanner cannot see at all: a contract
 * wearing the name of a token that lives somewhere else. Weaker evidence by construction - a
 * curated list is not an issuer - and the claim says so in its own words rather than dressing
 * it up as the registry case.
 */
export function crossChainNameClaim(verdict, { chain = HOME } = {}) {
  const found = (verdict?.checks || []).find((c) => c.id === "cross_name" && c.status === "warn");
  if (!found) return null;

  // the check's detail carries the established token's chain and address; parse rather than
  // re-derive, and bail if the shape is not what this code expects
  const target = /\bon ([A-Za-z0-9 ]+?) at ([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})/.exec(found.detail);
  if (!target) return null;
  const [, whereRaw, address] = target;
  const where = whereRaw.trim();
  const chainId = chainIdNamed(where);
  if (!chainId) return null;

  return makeClaim({
    type: "cross-chain-name",
    subject: { chain: chain.id, address: verdict.address, ...(verdict.symbol ? { label: verdict.symbol } : {}) },
    target: { chain: chainId, address, label: verdict.symbol || "" },
    says: `${verdict.address} on ${chain.name} carries the name and symbol of an established token on ${where} at ${address}, and is on no curated list.`,
    evidence: [
      symbolCall(chain, verdict.address, verdict.symbol || ""),
      httpEvidence({
        url: LIST_URL,
        pointer: `.tokens[] | select(.address=="${address}")`,
        expect: `an entry on ${LIST_NAME} for chainId ${chainId}`,
        means: `${address} on ${where} is the listed token for this symbol`,
      }),
      note(`Tier-2 evidence: a curated list is not an issuer. It establishes that a token of this name exists elsewhere, not that ${verdict.address} is fraudulent.`),
    ],
    observed: { at: new Date(verdict.scannedAt || Date.now()).toISOString() },
    method: METHOD,
  });
}

// Built from the same table the rest of the extension names chains with, so a claim can never
// name a chain the extension does not recognise - and a rename there cannot silently produce
// claims pointing at a chain id nobody meant.
const KNOWN_IDS = [1, 10, 56, 130, 137, 324, 480, 1868, 4663, 7777777, 8453, 42161, 42220, 43114, 57073, 81457, 501000101];

function chainIdNamed(name) {
  const wanted = String(name).trim().toLowerCase();
  return KNOWN_IDS.find((id) => chainName(id).toLowerCase() === wanted) || null;
}

/** Whatever this verdict supports, strongest first. Never guesses. */
export function claimsFor(verdict, opts) {
  return [impersonationClaim(verdict, opts), crossChainNameClaim(verdict, opts)].filter(Boolean);
}
