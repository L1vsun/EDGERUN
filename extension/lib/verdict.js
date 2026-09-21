// The checks, ported from the Python scan engine and run here in the worker.
//
// Two tiers, because a scrolling feed and a token page want different things:
//
//   identity — registry + reference list. One batched RPC round trip per address, and the
//              registry is already in storage, so a whole timeline resolves in one call.
//              This is the tier that catches "this is not the official TSLA".
//   full     — everything identity does, plus the contract lane: verified source, mint
//              selectors, ownership, LP lock, and a real simulated transfer out of a live
//              holder's wallet. Costs ~2 explorer + ~3 RPC calls, so it runs on a token
//              page or on an explicit click, never per row of a feed.
//
// Verdicts, and what each one is allowed to mean:
//
//   OFFICIAL    this address IS in Robinhood's published registry. A fact, not a score.
//   FAIL        it claims an official asset and is not it, or holders provably cannot move it.
//   CAUTION     the contract lane found something, or resolved nothing at all.
//   PASS        the full check ran and found nothing. Only reachable at the `full` tier.
//   UNRESOLVED  nothing has been established yet. Identity-clean lands here on purpose:
//               "not impersonating anything" is not the same as "safe", and the badge must
//               never let the first read as the second.
//
// A broken upstream always lands on UNRESOLVED. There is no path in this file from a failed
// request to a green badge.

import * as bs from "./blockscout.js";
import { BudgetExceeded, spend } from "./budget.js";
import { SEL, addrWord, callData, decodeAddress, decodeString, decodeUint, ethCall, getCode, revertData, rpc, uintWord } from "./chain.js";
import { EDIT_DISTANCE_THRESHOLD, REFERENCE_TOKENS, allowedDistance, levenshtein } from "./known.js";
import { OFFICIAL_NAME_MARKER, getRegistry, normalizeName, officialForAddress, officialForTicker } from "./registry.js";
import { decodeRevert, isBenignRevert, selectorsPresent } from "./selectors.js";

const BURN_SINK = "0x000000000000000000000000000000000000dEaD";
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const check = (id, label, status, detail) => ({ id, label, status, detail });

export const isAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(String(s || "").trim());

// ---- identity tier ----

async function readIdentity(address, { withOwner = false } = {}) {
  if (!(await spend("rpc"))) throw new BudgetExceeded("rpc");
  const calls = [getCode(address), ethCall(address, SEL.symbol), ethCall(address, SEL.name), ethCall(address, SEL.uiMultiplier)];
  if (withOwner) calls.push(ethCall(address, SEL.owner)); // ride along rather than pay a second round trip
  const [code, symbol, name, multiplier, owner] = await rpc(calls);
  return {
    code: code.result || null,
    symbol: decodeString(symbol.result),
    name: decodeString(name.result),
    // an ordinary token reverts here; the official stock tokens return 1e18
    uiMultiplier: multiplier.error ? null : decodeUint(multiplier.result),
    owner: withOwner && owner && !owner.error ? decodeAddress(owner.result) : null,
  };
}

/**
 * The stock lane. Returns a check, or null when the token makes no claim on an official
 * asset — so the check only appears on scans where it has something to say.
 */
function stockCheck(reg, address, symbol, name, uiMultiplier) {
  if (!reg.loaded) {
    if (symbol || name) {
      return check("stock_token", "stock token", "unresolved",
        `cannot reach the official Robinhood stock-token registry (${reg.error}) — cannot confirm or deny an official claim`);
    }
    return null;
  }

  const official = officialForAddress(reg, address);
  if (official) {
    return check("stock_token", "stock token", "ok",
      `VERIFIED official Robinhood stock token — ${official.ticker} (${official.name}), matches the registry Robinhood publishes`);
  }

  const claimed = symbol ? officialForTicker(reg, symbol) : null;
  const wearsBranding = normalizeName(name || "").includes(OFFICIAL_NAME_MARKER);

  if (claimed) {
    let detail = `ticker "${symbol.toUpperCase()}" is an OFFICIAL Robinhood tokenised stock (${claimed.name}) deployed at ${short(claimed.address)} — this contract is ${short(address)}, which is NOT it`;
    if (wearsBranding) detail += '. It also copies the official "• Robinhood Token" name format';
    return check("stock_token", "stock token", "fail", detail);
  }

  if (wearsBranding) {
    return check("stock_token", "stock token", "fail",
      `name copies the official "• Robinhood Token" branding used by Robinhood's tokenised securities, but ${short(address)} is not in the official registry`);
  }

  // Suggestive on its own, never proof: anyone can implement a function that returns a number.
  if (uiMultiplier !== null && uiMultiplier > 0n) {
    return check("stock_token", "stock token", "warn",
      "implements the ERC-8056 uiMultiplier() used by the official stock tokens, but is not in the official registry — unusual for an ordinary token");
  }
  return null;
}

function referenceCheck(address, symbol, name) {
  const matches = [];
  for (const ref of REFERENCE_TOKENS) {
    if (ref.contract.toLowerCase() === address.toLowerCase()) {
      return { check: check("impersonation", "impersonation", "ok", `this is ${ref.name} itself, an established token on this chain`), matches: [] };
    }
    for (const [mine, theirs, what] of [[symbol, ref.ticker, "ticker"], [name, ref.name, "name"]]) {
      if (!mine) continue;
      const d = levenshtein(mine, theirs);
      if (d <= allowedDistance(mine, theirs)) {
        matches.push({ ref, distance: d, what, exact: d === 0 });
      }
    }
  }
  if (!matches.length) {
    return { check: check("impersonation", "impersonation", "ok", `ticker/name matches no established token within edit distance ${EDIT_DISTANCE_THRESHOLD}`), matches: [] };
  }
  const best = matches.sort((a, b) => a.distance - b.distance)[0];
  const detail = best.exact
    ? `uses the same ${best.what} as ${best.ref.name} (${short(best.ref.contract)}), an established token on this chain — check which one you mean`
    : `${best.distance} edit(s) from ${best.ref.name} (${best.ref.ticker}, ${short(best.ref.contract)}) — near-miss of an established token`;
  return { check: check("impersonation", "impersonation", "warn", detail), matches };
}

// ---- contract lane (full tier only) ----

async function sourceCheck(address) {
  try {
    const info = await bs.address(address);
    if (!info) return { check: check("source_verified", "source verification", "unresolved", "the explorer has no record of this address"), info: null };
    return {
      info,
      check: info.is_verified
        ? check("source_verified", "source verification", "ok", "source is verified on the explorer")
        : check("source_verified", "source verification", "fail", "source is NOT verified — nobody can read what this contract actually does"),
    };
  } catch (err) {
    return { check: check("source_verified", "source verification", "unresolved", `explorer unreachable: ${err.message}`), info: null };
  }
}

function mintCheck(code) {
  if (!code || code === "0x") return check("supply_mint", "supply / mint", "unresolved", "no runtime bytecode to read");
  const found = selectorsPresent(code);
  const mint = found.find((f) => f.sig.startsWith("mint("));
  if (mint) {
    return check("supply_mint", "supply / mint", "fail", "mint(address,uint256) is present in the runtime bytecode — supply can be increased after deploy");
  }
  return check("supply_mint", "supply / mint", "ok", "no mint selector in the runtime bytecode");
}

function ownershipCheck(owner, code) {
  const dangerous = selectorsPresent(code).filter((f) => !f.sig.startsWith("mint("));
  if (owner === null) {
    return check("ownership", "ownership", "unresolved", "owner() reverted or this contract has no Ownable-style owner()");
  }
  if (/^0x0{40}$/.test(owner)) {
    return check("ownership", "ownership", "ok", "ownership is renounced (owner is the zero address)");
  }
  if (dangerous.length) {
    const names = dangerous.slice(0, 3).map((d) => d.sig).join(", ");
    return check("ownership", "ownership", "fail", `owned by ${short(owner)}, and the bytecode carries ${names} — that wallet can still change how this token behaves`);
  }
  return check("ownership", "ownership", "warn", `owned by ${short(owner)} — no dangerous selectors found, but ownership is not renounced`);
}

// Honest placeholder. There is no confirmed DEX factory/router address for chain 4663, and
// the pools that do exist are Uniswap v4 — liquidity sits in a singleton PoolManager, so a
// v2/v3-style "is the LP token locked" question does not even have the same shape here.
const lpCheck = () => check("lp_lock", "LP lock", "unresolved",
  "no confirmed DEX factory on this chain and the pools seen are Uniswap v4 (liquidity in a singleton) — LP lock cannot be established, and is not being guessed at");

async function exitCheck(address) {
  let list;
  try {
    list = await bs.holders(address, 6);
  } catch (err) {
    return check("exit_test", "exit test", "unresolved", `cannot list holders to simulate a transfer from: ${err.message}`);
  }
  const candidates = list
    .filter((h) => h.address.toLowerCase() !== BURN_SINK.toLowerCase() && h.address.toLowerCase() !== address.toLowerCase())
    .filter((h) => BigInt(h.value || 0) > 0n)
    .slice(0, 3);
  if (!candidates.length) return check("exit_test", "exit test", "unresolved", "no holder with a non-zero balance to simulate a transfer from");

  // The explorer's holder balances are a cached snapshot. Read each one live first — without
  // this, a stale balance turns an ordinary "you have no tokens" revert into a false
  // accusation of a targeted blacklist. That bug was real; it cost 5 false positives in 45.
  if (!(await spend("rpc"))) return check("exit_test", "exit test", "unresolved", "local rate budget spent — not run");
  const balances = await rpc(candidates.map((h) => ethCall(address, callData(SEL.balanceOf, addrWord(h.address)))));
  const live = candidates.filter((_, i) => (decodeUint(balances[i].result) || 0n) > 0n);
  let skipped = candidates.length - live.length;
  if (!live.length) return check("exit_test", "exit test", "unresolved", `no holder with a live non-zero balance to test (${skipped} skipped) — inconclusive`);

  // 1 wei of the token: the smallest amount that still runs the whole transfer path.
  const data = callData(SEL.transfer, addrWord(BURN_SINK), uintWord(1));
  if (!(await spend("rpc"))) return check("exit_test", "exit test", "unresolved", "local rate budget spent — not run");
  const sims = await rpc(live.map((h) => ethCall(address, data, h.address)));

  const passed = [];
  const blocked = [];
  sims.forEach((r, i) => {
    if (!r.error) return passed.push(live[i].address);
    const rd = revertData(r.error);
    if (isBenignRevert(rd)) return skipped++;
    blocked.push([live[i].address, decodeRevert(rd) || r.error.message || "reverted, no reason given"]);
  });

  if (!passed.length && !blocked.length) return check("exit_test", "exit test", "unresolved", `no holder with a live non-zero balance to test (${skipped} skipped) — inconclusive`);
  if (blocked.length && !passed.length) {
    return check("exit_test", "exit test", "fail", `simulated transfer FAILED for all ${blocked.length} holder(s) tested — ${blocked[0][1]}. Holders cannot move this token right now.`);
  }
  if (blocked.length) {
    return check("exit_test", "exit test", "warn", `simulated transfer succeeded for ${passed.length} holder(s) but FAILED for ${blocked.length} (${short(blocked[0][0])} — ${blocked[0][1]}) — selective restriction, the signature of a targeted blacklist`);
  }
  return check("exit_test", "exit test", "ok", `simulated transfer succeeded from ${passed.length} real holder(s) — tokens are movable at this block (a transfer test, not a DEX sell test)`);
}

// ---- assembly ----

function assemble(impersonation, contract, level, official) {
  const exitBlocked = contract.some((c) => c.id === "exit_test" && c.status === "fail");
  const impersonationFail = impersonation.some((c) => c.status === "fail");
  const contractFail = contract.some((c) => c.status === "fail");
  const contractResolvedNothing = contract.length > 0 && contract.every((c) => c.status === "unresolved");

  let verdict;
  if (exitBlocked || impersonationFail) verdict = "FAIL";
  else if (official) verdict = "OFFICIAL";
  else if (contractFail || contractResolvedNothing) verdict = "CAUTION";
  else if (level === "full" && contract.length) verdict = "PASS";
  else verdict = "UNRESOLVED"; // identity-clean: nothing bad claimed, nothing yet verified

  const all = [...impersonation, ...contract];
  const unresolved = all.filter((c) => c.status === "unresolved").length;
  return { verdict, checks: all, facts: all.length - unresolved, unresolved };
}

export async function scan(address, { level = "identity" } = {}) {
  const addr = String(address).trim().toLowerCase();
  if (!isAddress(addr)) throw new Error("that is not a contract address");

  const base = { address: addr, level, scannedAt: Date.now(), explorerUrl: bs.explorerUrl(addr) };

  let id;
  try {
    id = await readIdentity(addr, { withOwner: level === "full" });
  } catch (err) {
    return { ...base, verdict: "UNRESOLVED", symbol: null, name: null, official: null, impersonates: null, facts: 0, unresolved: 1,
      checks: [check("identity", "identity", "unresolved", err instanceof BudgetExceeded ? "local rate budget spent — try again in a minute" : `could not read the contract: ${err.message}`)] };
  }

  if (!id.code || id.code === "0x") {
    return { ...base, verdict: "UNRESOLVED", symbol: null, name: null, official: null, impersonates: null, facts: 0, unresolved: 1,
      checks: [check("identity", "identity", "unresolved", "there is no contract code at this address — it is a wallet, or nothing at all")] };
  }

  const reg = await getRegistry();
  const official = reg.loaded ? officialForAddress(reg, addr) : null;
  const stock = stockCheck(reg, addr, id.symbol, id.name, id.uiMultiplier);
  const ref = referenceCheck(addr, id.symbol, id.name);
  const impersonation = [stock, ref.check].filter(Boolean);

  // what the badge leads with when it is red
  const claimed = !official && reg.loaded && id.symbol ? officialForTicker(reg, id.symbol) : null;
  const impersonates = claimed ? { ticker: claimed.ticker, officialAddress: claimed.address, name: claimed.name } : null;

  const contract = [];
  if (level === "full") {
    // The explorer is the slow part of this check, and the source lookup and the holder
    // list do not depend on each other — run them together rather than one after the other.
    const [src, exit] = await Promise.all([sourceCheck(addr), exitCheck(addr)]);
    contract.push(src.check, mintCheck(id.code), ownershipCheck(id.owner, id.code), lpCheck(), exit);
  }

  return { ...base, symbol: id.symbol, name: id.name, official, impersonates, ...assemble(impersonation, contract, level, official) };
}

/**
 * Identity for many addresses in one RPC round trip — what a timeline scan uses. Falls back
 * to per-address scans only for the ones that need more than the batch can answer.
 */
export async function scanMany(addresses) {
  const list = [...new Set(addresses.map((a) => String(a).toLowerCase()).filter(isAddress))];
  if (!list.length) return {};
  const reg = await getRegistry();

  // Anything already in the registry is answered with no network at all.
  const out = {};
  const need = [];
  for (const addr of list) {
    const official = reg.loaded ? officialForAddress(reg, addr) : null;
    if (official) {
      out[addr] = {
        address: addr, level: "identity", scannedAt: Date.now(), explorerUrl: bs.explorerUrl(addr),
        symbol: official.ticker, name: official.name, official, impersonates: null, verdict: "OFFICIAL", facts: 1, unresolved: 0,
        checks: [check("stock_token", "stock token", "ok", `VERIFIED official Robinhood stock token — ${official.ticker} (${official.name}), matches the registry Robinhood publishes`)],
      };
    } else {
      need.push(addr);
    }
  }
  if (!need.length) return out;

  const unresolvedFor = (addr, why) => ({
    address: addr, level: "identity", scannedAt: Date.now(), explorerUrl: bs.explorerUrl(addr), symbol: null, name: null,
    official: null, impersonates: null, verdict: "UNRESOLVED", facts: 0, unresolved: 1,
    checks: [check("identity", "identity", "unresolved", why)],
  });

  // One request per chunk, not per address. 12 addresses is 48 eth_calls in a single POST —
  // big enough that a whole screen of posts costs one round trip, small enough that the
  // public node is never handed something it might refuse.
  const CHUNK = 12;
  for (let start = 0; start < need.length; start += CHUNK) {
    const slice = need.slice(start, start + CHUNK);
    if (!(await spend("rpc"))) {
      for (const addr of slice) out[addr] = unresolvedFor(addr, "local rate budget spent — try again in a minute");
      continue;
    }
    const calls = [];
    for (const addr of slice) {
      calls.push(getCode(addr), ethCall(addr, SEL.symbol), ethCall(addr, SEL.name), ethCall(addr, SEL.uiMultiplier));
    }
    let res;
    try {
      res = await rpc(calls);
    } catch (err) {
      for (const addr of slice) out[addr] = unresolvedFor(addr, `could not reach the chain: ${err.message}`);
      continue;
    }

    slice.forEach((addr, i) => {
      const code = res[i * 4]?.result || null;
      const symbol = decodeString(res[i * 4 + 1]?.result);
      const name = decodeString(res[i * 4 + 2]?.result);
      const mult = res[i * 4 + 3]?.error ? null : decodeUint(res[i * 4 + 3]?.result);

      if (!code || code === "0x") {
        out[addr] = unresolvedFor(addr, "there is no contract code at this address — it is a wallet, or nothing at all");
        return;
      }
      const stock = stockCheck(reg, addr, symbol, name, mult);
      const ref = referenceCheck(addr, symbol, name);
      const claimed = reg.loaded && symbol ? officialForTicker(reg, symbol) : null;
      out[addr] = {
        address: addr, level: "identity", scannedAt: Date.now(), explorerUrl: bs.explorerUrl(addr), symbol, name,
        official: null,
        impersonates: claimed ? { ticker: claimed.ticker, officialAddress: claimed.address, name: claimed.name } : null,
        ...assemble([stock, ref.check].filter(Boolean), [], "identity", null),
      };
    });
  }
  return out;
}

/**
 * What a bare $TICKER in a post can honestly be answered with: the registry's address for
 * it, if it is an official one. A ticker that is not official gets nothing — on this chain
 * a ticker maps to many contracts, and picking one to badge would be inventing an answer.
 */
export async function resolveTicker(ticker) {
  const reg = await getRegistry();
  if (!reg.loaded) return null;
  const official = officialForTicker(reg, ticker);
  return official ? { ...official, kind: "official" } : null;
}
