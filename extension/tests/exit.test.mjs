import assert from "node:assert/strict";
import { classify } from "../lib/exit.js";

const L = ["1 wei", "1%", "10%", "50%", "100%"];
// statuses given smallest-first, same order the sweep builds them
const h = (address, statuses, reason = "blacklisted") => ({
  address,
  balance: "1000",
  steps: statuses.map((st, i) => ({
    label: L[i], amount: "1", status: st, reason: st === "blocked" ? reason : null,
  })),
});

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

// everything moves
assert.equal(classify([h(A, ["ok","ok","ok","ok","ok"]), h(B, ["ok","ok","ok","ok","ok"])]).verdict, "clear");

// nothing moves, not even 1 wei -> a wall
const blocked = classify([h(A, ["blocked","blocked","blocked","blocked","blocked"])]);
assert.equal(blocked.verdict, "blocked");
assert.match(blocked.note, /down to 1 wei/);
assert.match(blocked.note, /blacklisted/);

// THE ONE THAT MATTERS: small transfers pass, large ones revert -> a size cap that a
// 1-wei probe would call healthy
const capped = classify([h(A, ["ok","ok","blocked","blocked","blocked"]), h(B, ["ok","ok","blocked","blocked","blocked"])]);
assert.equal(capped.verdict, "capped");
assert.equal(capped.ceiling, "1%", "ceiling is the largest size that still moved");
assert.match(capped.note, /revert at 10%/);

// one wallet capped, another totally free -> per-wallet, not global
assert.equal(
  classify([h(A, ["ok","ok","blocked","blocked","blocked"]), h(B, ["ok","ok","ok","ok","ok"])]).verdict,
  "selective",
);

// one wallet fully blocked while another moves everything -> targeted blacklist
const targeted = classify([h(A, ["blocked","blocked","blocked","blocked","blocked"]), h(B, ["ok","ok","ok","ok","ok"])]);
assert.equal(targeted.verdict, "selective");
assert.match(targeted.note, /1 of 2/);

// benign reverts alone decide nothing
assert.equal(classify([h(A, ["skipped","skipped","skipped","skipped","skipped"])]).verdict, "unresolved");

// a skipped step must not be read as a pass or a block
const mixed = classify([h(A, ["ok","skipped","ok","blocked","blocked"])]);
assert.equal(mixed.verdict, "capped");
assert.equal(mixed.ceiling, "10%");

console.log("exit sweep: all assertions passed");
