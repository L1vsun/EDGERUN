// The exit simulator: not "can holders move this", but "how much can they move".
//
// The standing exit check transfers 1 wei out of a real holder. That catches a plain
// honeypot, and misses an entire class of trap that is more common and much harder to see:
// a contract that lets small transfers through and reverts large ones. Any `maxTxAmount`,
// any threshold blacklist, any "sell limit" reads as perfectly healthy to a 1-wei probe,
// and the chart looks alive right up until somebody tries to leave with a real position.
//
// So this sweeps sizes instead of asserting a single one. For each of the top live holders
// it simulates transferring 1 wei, then 1%, 10%, 50% and 100% of that holder's own balance,
// and reports the size where it stops working. Everything is eth_call against the current
// block - nothing is signed, nothing is sent, and no wallet is involved at any point.
//
// All of it goes out as one batched JSON-RPC POST: 3 holders x 5 sizes is 15 calls in a
// single request, which is the only reason this is cheap enough to offer on demand.

import * as bs from "./blockscout.js";
import { spend } from "./budget.js";
import { SEL, addrWord, callData, decodeUint, ethCall, revertData, rpc, uintWord } from "./chain.js";
import { decodeRevert, isBenignRevert } from "./selectors.js";

const BURN_SINK = "0x000000000000000000000000000000000000dEaD";

// Fractions of a holder's own balance, in basis points, smallest first. 1 wei rides in front
// as the control: if even that reverts, the token is not size-limited, it is simply shut.
const STEPS = [
  { label: "1 wei", bps: null },
  { label: "1%", bps: 100n },
  { label: "10%", bps: 1000n },
  { label: "50%", bps: 5000n },
  { label: "100%", bps: 10000n },
];

const amountFor = (balance, step) => (step.bps === null ? 1n : (balance * step.bps) / 10000n);

/**
 * @returns {{
 *   verdict: "clear"|"capped"|"blocked"|"selective"|"unresolved",
 *   note: string,
 *   holders: Array<{address: string, balance: string, steps: Array<{label: string, amount: string, status: "ok"|"blocked"|"skipped", reason: string|null}>}>,
 *   ceiling: string|null
 * }}
 */
export async function exitSweep(address, { holders = 3 } = {}) {
  const token = String(address).toLowerCase();

  let list;
  try {
    list = await bs.holders(token, 8);
  } catch (err) {
    return unresolved(`cannot list holders to simulate from: ${err.message}`);
  }

  const candidates = list
    .filter((h) => h.address.toLowerCase() !== BURN_SINK.toLowerCase() && h.address.toLowerCase() !== token)
    .filter((h) => BigInt(h.value || 0) > 0n)
    .slice(0, holders);
  if (!candidates.length) return unresolved("no holder with a non-zero balance to simulate from");

  // The explorer's balances are a cached snapshot, and a stale one turns an ordinary
  // "you have no tokens" revert into a false accusation. Read them live first.
  if (!(await spend("rpc"))) return unresolved("local rate budget spent - not run");
  const balanceReads = await rpc(candidates.map((h) => ethCall(token, callData(SEL.balanceOf, addrWord(h.address)))));
  const live = candidates
    .map((h, i) => ({ address: h.address, balance: decodeUint(balanceReads[i].result) || 0n }))
    .filter((h) => h.balance > 0n);
  if (!live.length) return unresolved("no holder with a live non-zero balance - inconclusive");

  // one POST for the whole grid
  const grid = [];
  for (const h of live) {
    for (const step of STEPS) {
      const amount = amountFor(h.balance, step);
      grid.push({ holder: h, step, amount });
    }
  }
  if (!(await spend("rpc"))) return unresolved("local rate budget spent - not run");
  const sims = await rpc(
    grid.map((g) => ethCall(token, callData(SEL.transfer, addrWord(BURN_SINK), uintWord(g.amount)), g.holder.address)),
  );

  const byHolder = new Map(live.map((h) => [h.address, { address: h.address, balance: h.balance.toString(), steps: [] }]));
  grid.forEach((g, i) => {
    const r = sims[i];
    let status = "ok";
    let reason = null;
    if (r.error) {
      const rd = revertData(r.error);
      // an amount larger than the balance is arithmetic, not a restriction
      if (isBenignRevert(rd) || g.amount === 0n) {
        status = "skipped";
        reason = "nothing to move at this size";
      } else {
        status = "blocked";
        reason = decodeRevert(rd) || r.error.message || "reverted, no reason given";
      }
    }
    byHolder.get(g.holder.address).steps.push({ label: g.step.label, amount: g.amount.toString(), status, reason });
  });

  return classify([...byHolder.values()]);
}

const unresolved = (note) => ({ verdict: "unresolved", note, holders: [], ceiling: null });

/** The largest step a holder could actually move, and the first one they could not. */
function profile(h) {
  const tried = h.steps.filter((s) => s.status !== "skipped");
  const firstBlocked = tried.find((s) => s.status === "blocked") || null;
  const lastOk = [...tried].reverse().find((s) => s.status === "ok") || null;
  return { firstBlocked, lastOk, anyOk: Boolean(lastOk), allBlocked: tried.length > 0 && tried.every((s) => s.status === "blocked") };
}

/** Exported for testing: this is where the sweep turns into a finding. */
export function classify(holders) {
  const profiles = holders.map(profile);
  const tested = profiles.filter((p) => p.firstBlocked || p.anyOk);
  if (!tested.length) return { verdict: "unresolved", note: "every simulation was inconclusive", holders, ceiling: null };

  if (profiles.every((p) => p.allBlocked)) {
    const why = profiles.find((p) => p.firstBlocked)?.firstBlocked?.reason || "reverted";
    return {
      verdict: "blocked",
      note: `every holder tested is blocked at every size, down to 1 wei - "${why}". Nobody can move this token right now.`,
      holders,
      ceiling: null,
    };
  }

  const capped = profiles.filter((p) => p.anyOk && p.firstBlocked);
  const free = profiles.filter((p) => p.anyOk && !p.firstBlocked);

  if (capped.length && !free.length) {
    const ceiling = capped[0].lastOk?.label || "1 wei";
    const breaks = capped[0].firstBlocked?.label;
    return {
      verdict: "capped",
      note: `transfers work up to ${ceiling} of a holder's balance and revert at ${breaks} - "${capped[0].firstBlocked?.reason}". A size limit like this passes any small test and stops a real position from leaving.`,
      holders,
      ceiling,
    };
  }

  if (capped.length && free.length) {
    return {
      verdict: "selective",
      note: `some holders can move their whole balance and others are stopped partway - the signature of a per-wallet restriction rather than a global limit.`,
      holders,
      ceiling: capped[0].lastOk?.label || null,
    };
  }

  const blockedSome = profiles.filter((p) => p.allBlocked);
  if (blockedSome.length) {
    return {
      verdict: "selective",
      note: `${blockedSome.length} of ${profiles.length} holders tested cannot move anything at all while the rest move their full balance - a targeted blacklist.`,
      holders,
      ceiling: null,
    };
  }

  return {
    verdict: "clear",
    note: `every holder tested could move their entire balance at this block. A transfer test, not a DEX sell test - it says nothing about whether there is liquidity to sell into.`,
    holders,
    ceiling: "100%",
  };
}
