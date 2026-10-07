// Who holds a Solana mint, read from the chain.
//
// For most of a day this file could not exist. The keyless RPC the mint scan uses refuses
// `getTokenLargestAccounts` outright, the foundation's endpoint turns away an extension's
// origin, and every other public endpoint tried wanted a key - so holder numbers in this
// product were an index's count, labelled as one. Then one endpoint answered: a community
// RPC, keyless, with `access-control-allow-origin: *` (measured 2026-10-07, fifteen tried).
//
// It answers slowly and not often. A burst earns a 403; one request every few seconds does
// not; a mint the size of USDC took seven seconds. So this is asked for, never automatic,
// has a budget of its own, and a refusal is reported as "could not be read" - which is about
// that endpoint and says nothing about the token.
//
// ---- what three requests buy ----
//
//   1. the twenty largest token accounts of the mint          (the one scarce request)
//   2. each of those accounts, parsed: its OWNER and its STATE (batched with the mint itself)
//   3. each owner's own account: which PROGRAM controls it
//
// Step 3 is what makes the numbers mean something. The largest "holder" of a token on a
// bonding curve is the curve; of a graduated token, its pool. Counting those as wallets
// turns every launch into "one holder owns 80%", which is a false accusation shaped like a
// statistic. An owner controlled by the system program is a wallet. An owner controlled by
// anything else is a program's account - a pool, a curve, a locker - and is counted apart.
//
// Step 2 carries the finding nothing else in this product could reach on Solana: whether a
// holder's account is FROZEN right now. That is the exit test asked of this chain. On an EVM
// chain it takes a simulated transfer to learn that a holder cannot move a token; here the
// chain simply says so, per account.

import { spend } from "./budget.js";

export const LARGEST_RPC = "https://public.rpc.solanavibestation.com";
const READ_RPC = "https://solana-rpc.publicnode.com";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

const check = (id, label, status, detail) => ({ id, label, status, detail });
const pct = (n) => `${n >= 10 ? n.toFixed(1) : n.toFixed(2)}%`;

/**
 * The three answers, reduced to rows and totals. Pure.
 *
 * `top` is the largest-accounts list, `accounts` the parsed token accounts in the same order,
 * `programs` a map from an owner address to the program that controls it (null when the
 * owner has no account at all - a wallet that holds no SOL, which is still a wallet).
 */
export function shapeHolders({ supply, top = [], accounts = [], programs = {} }) {
  const total = Number(supply);
  if (!(total > 0)) return null;
  const rows = top
    .map((t, i) => {
      const info = accounts[i]?.data?.parsed?.info || null;
      const owner = info?.owner || null;
      // "Not read" and "read, and there is no such account" are different answers. The second
      // is a wallet that holds no SOL. The first is nothing at all, and must not be counted
      // as a wallet: an owner nobody looked up could just as well be the pool.
      const known = owner !== null && Object.prototype.hasOwnProperty.call(programs, owner);
      const program = known ? programs[owner] : null;
      return {
        account: t.address,
        owner,
        pct: (Number(t.amount) / total) * 100,
        frozen: info?.state === "frozen",
        kind: !known ? "unknown" : program && program !== SYSTEM_PROGRAM ? "program" : "wallet",
        program: program && program !== SYSTEM_PROGRAM ? program : null,
      };
    })
    .filter((r) => r.pct > 0);

  const wallets = rows.filter((r) => r.kind === "wallet").sort((a, b) => b.pct - a.pct);
  const sum = (list) => list.reduce((s, r) => s + r.pct, 0);
  return {
    rows,
    listed: rows.length,
    walletCount: wallets.length,
    top1: wallets[0]?.pct ?? 0,
    top10: sum(wallets.slice(0, 10)),
    programPct: sum(rows.filter((r) => r.kind === "program")),
    frozen: rows.filter((r) => r.frozen).length,
    frozenWallets: wallets.filter((r) => r.frozen).length,
  };
}

/**
 * What the holder list is allowed to say.
 *
 * Concentration is a description until it is a majority: one wallet holding more than half
 * of supply, or ten holding four fifths, is stated as a warning because whoever holds it
 * sets the price by selling. Below that it is context. On a token a list vouches for it is
 * always context - the ten largest holders of a stablecoin are exchanges.
 *
 * Frozen accounts are a different kind of finding. They are not a guess about intent: the
 * chain says this holder cannot move this token. All of the largest wallets frozen is the
 * strongest thing a Solana check can say and is a `fail`; some of them is the signature of a
 * freeze being used on particular holders. A regulated issuer freezes accounts as a matter
 * of course, so on a vouched token it is reported and not charged.
 */
export function holderChecks(h, { vouched = false, freezeAuthority = null } = {}) {
  if (!h || !h.listed) return [];
  const out = [];
  const among = `among the ${h.listed} largest accounts`;

  const spread = `the largest wallet holds ${pct(h.top1)} of supply and the ten largest ${pct(h.top10)}`;
  if (!vouched && h.top1 >= 50) {
    out.push(check("holders_top", "one wallet", "warn",
      `one wallet holds ${pct(h.top1)} of supply. Whoever holds it sets the price by selling - read from the chain, ${among}`));
  } else if (!vouched && h.top10 >= 80) {
    out.push(check("holders_top", "ten wallets", "warn",
      `ten wallets hold ${pct(h.top10)} of supply between them - read from the chain, ${among}`));
  } else if (h.walletCount) {
    out.push(check("holders_top", "who holds it", "unresolved", `${spread} - read from the chain, ${among}`));
  }

  if (h.programPct > 0) {
    out.push(check("holders_program", "held by programs", "unresolved",
      `${pct(h.programPct)} of supply sits in accounts controlled by programs rather than wallets - a pool, a launchpad's curve, a locker. Not counted as anybody's holding`));
  }

  if (h.frozenWallets && !vouched && h.frozenWallets === h.walletCount && h.walletCount >= 3) {
    out.push(check("holders_frozen", "frozen", "fail",
      `every one of the ${h.walletCount} largest wallet accounts is FROZEN right now - these holders cannot move this token`));
  } else if (h.frozen) {
    out.push(check("holders_frozen", "frozen", vouched ? "unresolved" : "warn",
      `${h.frozen} of the ${h.listed} largest accounts ${h.frozen === 1 ? "is" : "are"} frozen right now and cannot move this token${vouched ? " - an issuer using its freeze authority" : ", while the rest can - a freeze being used on particular holders"}`));
  } else if (freezeAuthority) {
    out.push(check("holders_frozen", "frozen", "ok",
      `a freeze authority exists, and none of the ${h.listed} largest accounts is frozen right now`));
  }
  return out;
}

async function post(url, body, fetchImpl) {
  const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  // this endpoint answers a burst with 403, not 429: both mean "not now"
  if (res?.status === 429 || res?.status === 403) throw new Error("rate limited");
  if (!res?.ok) throw new Error("unreachable");
  return res.json();
}

/**
 * Read the holders of one mint.
 *
 * `{ status }` is always present: "read", "limited" (asked too often - about us), "none"
 * (the mint has no holders listed) or "unreachable". Never throws.
 */
export async function readHolders(mint, { fetchImpl = fetch, vouched = false } = {}) {
  if (!(await spend("holders"))) return { status: "limited" };
  try {
    const largest = await post(LARGEST_RPC, { jsonrpc: "2.0", id: 1, method: "getTokenLargestAccounts", params: [mint] }, fetchImpl);
    if (largest?.error) return { status: /block|limit/i.test(largest.error.message || "") ? "limited" : "unreachable" };
    const top = largest?.result?.value || [];
    if (!top.length) return { status: "none" };

    const batch = await post(READ_RPC, [
      { jsonrpc: "2.0", id: 0, method: "getAccountInfo", params: [mint, { encoding: "jsonParsed" }] },
      { jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [top.map((t) => t.address), { encoding: "jsonParsed" }] },
    ], fetchImpl);
    const by = new Map((Array.isArray(batch) ? batch : []).map((r) => [r.id, r]));
    const info = by.get(0)?.result?.value?.data?.parsed?.info;
    const accounts = by.get(1)?.result?.value;
    if (!info || !Array.isArray(accounts)) return { status: "unreachable" };

    const owners = [...new Set(accounts.map((a) => a?.data?.parsed?.info?.owner).filter(Boolean))];
    const programs = {};
    if (owners.length) {
      const res = await post(READ_RPC, {
        jsonrpc: "2.0", id: 2, method: "getMultipleAccounts",
        // no data wanted - only which program controls each owner
        params: [owners, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }],
      }, fetchImpl);
      const list = res?.result?.value;
      // without this answer nobody can tell a wallet from a pool, and guessing "wallet" is
      // how a bonding curve becomes "one holder owns 80%"
      if (!Array.isArray(list) || list.length !== owners.length) return { status: "unreachable" };
      list.forEach((acct, i) => { programs[owners[i]] = acct?.owner || null; });
    }

    const h = shapeHolders({ supply: info.supply, top, accounts, programs });
    if (!h) return { status: "none" };
    return { status: "read", ...h, checks: holderChecks(h, { vouched, freezeAuthority: info.freezeAuthority || null }) };
  } catch (err) {
    return { status: /rate limited/.test(String(err?.message)) ? "limited" : "unreachable" };
  }
}
