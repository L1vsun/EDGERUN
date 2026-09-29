# Claims

A claim is one accusation, written so that a stranger who does not trust the person making it
can find out for themselves.

This is the format behind the [blocklist](../frontend/public/blocklist.json), and it exists
because the blocklist's `evidence` field is prose:

```
"evidence": "eth_call transfer(0x…dEaD, 1) simulated from each of the 3 top holders, all reverted"
```

That sentence is true and it is not re-runnable. Checking it means reconstructing the call by
hand, which means in practice nobody checks, which means the list is *trusted* rather than
*verified*. A list nobody can execute is a rumour with a URL in front of it.

So evidence is carried as **instructions plus expected results**. A claim can print the
commands that check it.

---

## The two rules

**1. A claim needs at least one piece of evidence a stranger can run.**
Prose is welcome and proves nothing. A claim built only from notes is a report, not a claim,
and the validator rejects it however true it is.

**2. A claim that names a victim must establish both sides.**
*"This is not the real TSLA"* is uncheckable unless the claim also shows, reproducibly, what
the real TSLA is. Otherwise the reader is being asked to trust the reporter about the exact
thing in dispute.

Rule 2 is matched on **address, never on label**. In an impersonation claim the subject's own
symbol *is* the target's label - a fake TSLA calls itself TSLA - so a label match is satisfied
by evidence about the subject and establishes nothing about the target. The only way to show
what the real one is, is to point at it.

---

## Shape

```json
{
  "v": 1,
  "id": "impersonation/4663:0xd18f…/of/4663:0x322f…",
  "type": "impersonation",
  "subject": { "chain": 4663, "address": "0xd18f…", "label": "TSLA" },
  "target":  { "chain": 4663, "address": "0x322f…", "label": "TSLA" },
  "says": "0xd18f… presents itself as $TSLA on Robinhood Chain. Robinhood publishes $TSLA at 0x322f…, which is a different contract.",
  "evidence": [ … ],
  "observed": { "at": "2026-09-24T09:00:00.000Z" },
  "by": { "kind": "anon" },
  "method": { "name": "edgerun/extension", "version": "0.1.0" }
}
```

`id` is **derived from the content**, not assigned. Two people who report the same thing
without ever speaking produce the same id, so a registry can merge them with no coordination.
It is readable rather than hashed because these land in a git diff that humans review, and a
diff full of opaque digests is a diff nobody reads.

### Types

| type | needs a target | means |
|---|---|---|
| `impersonation` | yes | presents itself as a specific other token and is not it |
| `cross-chain-name` | yes | wears the name of an established token that lives on another chain |
| `restricted-transfer` | no | holders provably cannot move it |
| `symbol-collision` | no | several contracts on one chain answer to the same ticker |

### Evidence

Two kinds are runnable. Both carry `expect`, because a step with no expected result proves
nothing when you run it.

```json
{ "kind": "rpc",  "endpoint": "https://…", "method": "eth_call", "params": [ … ],
  "expect": "an ABI-encoded string equal to \"TSLA\"", "means": "…" }

{ "kind": "http", "url": "https://api.robinhood.com/rhj/assets",
  "pointer": ".assets[] | select(.tokenSymbol==\"TSLA\") | …",
  "expect": "0x322f…", "means": "…" }
```

A third kind, `note`, carries context a machine cannot check. It never counts toward rule 1.

Runnable evidence may also carry **`equals`**, which is the same expectation in a form a
machine can compare. `expect` is a sentence written for a person - *"an ABI-encoded string
equal to \"TSLA\""* - and matching a regex against it would be a guess wearing the costume of
a check, so the verifier only ever compares against `equals`:

```json
{ "equals": { "decode": "string", "value": "TSLA" } }     // decode the eth_call result, compare
{ "equals": { "contains": "0x322f…" } }                   // the value appears in the document
{ "equals": { "reverts": true } }                         // the call is EXPECTED to fail
```

`equals` is optional and additive: claims written before it stay valid, they simply do not
self-check. Evidence without it is reported as needing a human, never scored as a pass.

`reverts` exists for the restricted-transfer case, where a failing call *is* the proof. It is
the one place where the semantics invert, and it must never be confused with an endpoint that
could not be reached.

### Comparison rules

- **Hex is compared case-insensitively.** Found the hard way: Robinhood's registry returns the
  checksummed `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` while claims normalise to lowercase,
  so a strict string comparison reports a mismatch on a claim that is entirely correct.
- **Base58 is compared exactly.** Solana addresses are case-carrying and folding one produces
  a string that is not that address.
- Evidence is expected to be *stable*, not *instantaneous*. A claim about a contract's symbol
  holds at any block; a claim about a balance does not, and needs `observed.block`.

---

## Running one

A plan nobody runs is prose in a monospace font, so the extension executes claims rather than
only printing the commands for them. Paste one into the panel's **claims** tab - raw JSON, a
quoted chat message, a fenced block out of a pull request - and the runnable evidence is
executed against the endpoints the claim names. Four outcomes:

| | |
| --- | --- |
| **reproduced** | every machine-checkable piece came back as the claim said |
| **contradicted** | at least one came back **different**. The claim is wrong, or stale |
| **partial** | some reproduced; the rest could not be reached or need a human |
| **unproven** | nothing could be reached, or nothing was machine-checkable |

Two rules govern it, and both are the false-accusation discipline one level up:

- **A network failure is never a contradiction.** You do not get to call a reporter a liar
  because a public RPC rate-limited you. Unreachable is its own outcome and never produces
  `contradicted`.
- **The verifier will not fetch wherever a claim points.** A claim is a document written by a
  stranger that names its own endpoints; following that blindly turns the verifier into a
  request proxy aimed wherever the author chose, carrying the reader's IP and the extension's
  host permissions. Verification runs only against hosts the extension already talks to, and
  anything else comes back with its command attached, to run by hand.

---

## What is deliberately not in here yet

**No stake, no slashing, no token.** Those are how an open registry stays honest once anyone
can write to it, and they are premature: the claim format is what everything else has to agree
on, and it can be specified, used and argued about today with no chain involved. Designing the
economics before the data shape is how registries end up with mechanisms that secure the wrong
thing.

**No signatures.** `by` currently records `{ "kind": "anon" }`. Provenance today is git history
on the blocklist file, which is weak but real and costs nothing. Keys matter when submissions
outgrow pull requests.

**Not every check produces a claim**, and that is still true - a verdict resting on prose
cannot become a claim, which is the point of the format rather than a shortcoming of it.

The exit sweep used to be the example here, and it no longer is. *"Three top holders could not
transfer"* was unverifiable in practice because the check kept the holders inside a sentence,
with a shortened address in it. The check now hands up structured holders and the sweep emits
a `restricted-transfer` claim that re-runs the same calls from the same wallets - which means
the strongest statement this project can make is no longer the one it could not make.

---

## Submitting one

The extension's report button produces a filled claim. Open a pull request against
[`frontend/public/blocklist.json`](../frontend/public/blocklist.json) with it. A maintainer
runs the commands in the claim's own verification plan; if they return what the claim says
they will, it goes in, and `git log` records who added it.

A claim that cannot print its verification steps was never checkable, and no amount of
confidence in the prose above it changes that.
