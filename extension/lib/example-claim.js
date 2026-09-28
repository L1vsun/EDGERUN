// A real claim, so the claims tab is not a blank box.
//
// The feature had a chicken-and-egg problem: you cannot check a claim until somebody sends
// you one, and on a fresh install nobody has. So the tab shipped as a textarea with no way
// to see what it did, which for most people is the same as not shipping it.
//
// This is the project's own blocklist entry for 0xd18f5e73…, rewritten in the claim format.
// That makes it the argument in miniature. The blocklist says:
//
//   "Uses the ticker TSLA, which Robinhood publishes at 0x322f0929…"
//
// - true, and not re-runnable. Below is the same accusation as two instructions and two
// expected results, which the reader's own browser executes.
//
// Both facts were checked against live endpoints on 2026-09-28 before this was written:
// symbol() on the subject returns the ABI string "TSLA", and the registry gives TSLA on
// chain 4663 as 0x322F0929c4625eD5bAd873c95208D54E1c003b2d. It is meant to come back
// REPRODUCED. If it ever stops doing so, that is worth knowing - either the registry moved
// or the contract changed, and both are things this project should notice.

import { httpEvidence, makeClaim, note, rpcEvidence } from "./claim.js";
import { HOME } from "./chains.js";
import { SEL } from "./chain.js";
import { REGISTRY_URL } from "./registry.js";

const SUBJECT = "0xd18f5e73ec5e2d0b18ebe97426dc5edc2c887715";
const OFFICIAL = "0x322F0929c4625eD5bAd873c95208D54E1c003b2d";

export function exampleClaim() {
  return makeClaim({
    type: "impersonation",
    subject: { chain: HOME.id, address: SUBJECT, label: "TSLA" },
    target: { chain: HOME.id, address: OFFICIAL, label: "TSLA" },
    says: `${SUBJECT} presents itself as $TSLA on ${HOME.name}. Robinhood publishes $TSLA at ${OFFICIAL}, which is a different contract.`,
    evidence: [
      rpcEvidence({
        endpoint: HOME.rpc,
        method: "eth_call",
        params: [{ to: SUBJECT, data: SEL.symbol }, "latest"],
        expect: 'an ABI-encoded string equal to "TSLA"',
        equals: { decode: "string", value: "TSLA" },
        means: `${SUBJECT} calls itself TSLA on ${HOME.name}`,
      }),
      httpEvidence({
        url: REGISTRY_URL,
        pointer: '.assets[] | select(.tokenSymbol=="TSLA") | .deployments[] | select(.chainId==4663) | .contractAddress',
        expect: OFFICIAL,
        equals: { contains: OFFICIAL },
        means: `the issuer's own registry gives $TSLA on ${HOME.name} as ${OFFICIAL}`,
      }),
      note("Both sides are shown, which is the rule: the first line establishes what this contract calls itself, the second establishes what the real one is. Without the second, a reader would be trusting the reporter about the very thing in dispute."),
    ],
    method: { name: "edgerun", version: "example" },
  });
}
