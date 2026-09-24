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

### Comparison rules

- **Hex is compared case-insensitively.** Found the hard way: Robinhood's registry returns the
  checksummed `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` while claims normalise to lowercase,
  so a strict string comparison reports a mismatch on a claim that is entirely correct.
- **Base58 is compared exactly.** Solana addresses are case-carrying and folding one produces
  a string that is not that address.
- Evidence is expected to be *stable*, not *instantaneous*. A claim about a contract's symbol
  holds at any block; a claim about a balance does not, and needs `observed.block`.

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

**Not every check produces a claim.** The exit sweep is the clearest example: *"three top
holders could not transfer"* needs those holders' addresses to be re-runnable, and that check
currently keeps them inside a sentence. Emitting it would produce something that passes
validation while being unverifiable in practice, which is worse than emitting nothing. The
check has to hand up structured holders first.

---

## Submitting one

The extension's report button produces a filled claim. Open a pull request against
[`frontend/public/blocklist.json`](../frontend/public/blocklist.json) with it. A maintainer
runs the commands in the claim's own verification plan; if they return what the claim says
they will, it goes in, and `git log` records who added it.

A claim that cannot print its verification steps was never checkable, and no amount of
confidence in the prose above it changes that.
