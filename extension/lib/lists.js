// The tier-2 authority: curated token lists, for the chains where nobody publishes the truth.
//
// On Robinhood Chain the question "which address is the real Tesla" has an answer, because
// Robinhood publishes it. On Ethereum it does not. The closest thing is a curated list, and a
// list is a fundamentally weaker instrument in both directions:
//
//   being ON it     - somebody vouched. Not proof of anything, but a real signal.
//   being OFF it    - proves NOTHING. Every token is off every list on the day it launches,
//                     and most legitimate ones stay off forever. Absence must never read as
//                     an accusation, which is the single easiest way to build a tool that
//                     cries wolf on every new launch.
//
// What a list CAN do is catch a collision: this address calls itself USDC, and the list says
// USDC on this chain is a different address. That is reportable on its own terms, and it is
// as far as tier-2 evidence goes.
//
// Uniswap's default list was chosen because one fetch covers every chain in the table -
// measured 2026-09-24: 1719 tokens, 406 on Ethereum, 203 Arbitrum, 108 Base, 97 BNB Chain,
// and 202 on Robinhood Chain (which is itself a useful demonstration that a curated list and
// an authoritative registry disagree - Robinhood publishes 194).

import { spend } from "./budget.js";
import { chainName } from "./chains.js";

export const LIST_URL = "https://tokens.uniswap.org";
export const LIST_NAME = "Uniswap Labs Default";

const KEY = "tokenlist";
const TTL_MS = 12 * 60 * 60 * 1000; // a curated list moves on the order of weeks

let mem = null;

const addrKey = (chainId, address) => `${chainId}:${String(address).toLowerCase()}`;
const symKey = (chainId, symbol) => `${chainId}:${String(symbol).toUpperCase().replace(/^\$/, "")}`;

/**
 * Flatten the list into the two lookups that get used, and nothing else.
 *
 * The stored `address` keeps its original casing while the lookup KEY is lowercased. That
 * split is not tidiness: Solana addresses are base58 and case-carrying, so lowercasing one
 * produces a string that is not the address. EVM hex is case-insensitive and does not care,
 * which is why doing it to everything looked fine until a Solana entry had to be printed.
 */
export function index(payload) {
  const byAddress = {};
  const bySymbol = {};
  for (const t of payload?.tokens || []) {
    if (!t?.address || !t?.chainId) continue;
    const entry = { chainId: t.chainId, address: String(t.address), symbol: t.symbol || "", name: t.name || "" };
    byAddress[addrKey(t.chainId, t.address)] = entry;
    // A symbol can legitimately appear more than once on a chain. Keeping every claimant is
    // what makes "the list says this symbol is a different address" a checkable statement
    // rather than a coin flip between two list entries.
    (bySymbol[symKey(t.chainId, entry.symbol)] ||= []).push(entry);
  }
  return { byAddress, bySymbol, count: Object.keys(byAddress).length };
}

export async function getList({ force = false } = {}) {
  if (!force && mem && Date.now() - mem.fetchedAt < TTL_MS) return mem;

  if (!force) {
    try {
      const got = await chrome.storage.local.get(KEY);
      const cached = got[KEY];
      if (cached && Date.now() - cached.fetchedAt < TTL_MS && cached.byAddress) {
        mem = cached;
        return mem;
      }
    } catch {
      /* storage blocked: fall through to a live fetch */
    }
  }

  if (!(await spend("registry"))) {
    return mem || { loaded: false, error: "token list refresh rate-limited locally", byAddress: {}, bySymbol: {}, fetchedAt: 0 };
  }

  try {
    const res = await fetch(LIST_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { byAddress, bySymbol, count } = index(await res.json());
    if (!count) throw new Error("the token list came back empty");
    mem = { loaded: true, error: null, byAddress, bySymbol, count, fetchedAt: Date.now() };
    chrome.storage.local.set({ [KEY]: mem }).catch(() => {});
    return mem;
  } catch (err) {
    if (mem?.loaded) return { ...mem, error: `refresh failed: ${err.message} (serving cached)` };
    return { loaded: false, error: `token list unreachable: ${err.message}`, byAddress: {}, bySymbol: {}, fetchedAt: 0 };
  }
}

/**
 * What a curated list is allowed to say about one contract. Pure, so the wording is testable.
 *
 * Every branch here is deliberately short of an accusation. The strongest thing on offer is
 * "the list disagrees about which address holds this symbol", which is a statement about the
 * list, not about the contract's intent.
 */
export function listCheck(list, { chainId, address, symbol }) {
  const id = "list";
  const label = "curated list";
  if (!list?.loaded) {
    return { id, label, status: "unresolved", detail: "no curated token list loaded, so nothing was compared" };
  }

  const addr = String(address || "").toLowerCase();
  const listed = list.byAddress[addrKey(chainId, addr)];
  if (listed) {
    return { id, label, status: "ok", detail: `listed on ${LIST_NAME} as ${listed.symbol || listed.name || "a token"}` };
  }

  const sym = String(symbol || "").toUpperCase().replace(/^\$/, "");
  const claimants = sym ? list.bySymbol[symKey(chainId, sym)] || [] : [];
  // `addr` is lowercased and the entries now keep their original casing, so compare folded
  const others = claimants.filter((c) => c.address.toLowerCase() !== addr);
  if (others.length) {
    const one = others[0];
    return {
      id,
      label,
      status: "warn",
      detail:
        others.length === 1
          ? `this calls itself ${sym}, and the list says ${sym} on this chain is ${one.address}`
          : `this calls itself ${sym}, and the list carries ${others.length} other contracts under that symbol on this chain`,
    };
  }

  // The honest non-answer, and the most common one. Written so it cannot be misread as a
  // finding: a token missing from a curated list is the normal state of almost every token.
  return {
    id,
    label,
    status: "unresolved",
    detail: `not on ${LIST_NAME}, which is normal for most tokens and is not a finding on its own`,
  };
}

/**
 * The check that a single-chain scanner structurally cannot run.
 *
 * A contract on Robinhood Chain calling itself "Pump" impersonates nothing *on Robinhood
 * Chain*, so every check that only knows this chain passes it - which is exactly how a
 * contract with the name and symbol of a $1.8bn Solana token earned a green badge on
 * 2026-09-24. The token being copied does not live on the chain being scanned. That is the
 * whole trick, and looking harder at the bytecode will never catch it.
 *
 * Two guards keep this from firing on honest tokens, and both matter:
 *
 *   1. It only fires when this contract is NOT itself listed on its own chain. A listed token
 *      has been vouched for, and a shared symbol is then an ordinary multi-chain deployment -
 *      which is what the 60 symbols appearing on both Solana and an EVM chain here actually
 *      are.
 *   2. Official registry tokens never reach this, because `assemble` decides OFFICIAL before
 *      it weighs warnings.
 *
 * Names are compared loosely and on purpose. The first version of this required exact name
 * equality and missed the case it was written for: Uniswap's list calls the Solana token
 * "Pump.fun" while Jupiter calls it "Pump" and the copy calls itself "Pump". Reference lists
 * do not agree with each other on names, so an exact match is not a test of anything.
 *
 * Tier-2 evidence, so the wording never says fake. What it does do is deny PASS: "nothing
 * found against it" is a false statement about a contract wearing another token's name.
 */
export function crossChainNameCheck(list, { chainId, address, symbol, name }) {
  const id = "cross_name";
  const label = "name used elsewhere";
  if (!list?.loaded) return null;

  const addr = String(address || "").toLowerCase();
  if (list.byAddress[addrKey(chainId, addr)]) return null; // listed here: vouched for

  const sym = String(symbol || "").toUpperCase().replace(/^\$/, "");
  if (!sym) return null;

  const elsewhere = [];
  for (const [key, entries] of Object.entries(list.bySymbol)) {
    const [cid, s] = key.split(":");
    if (s !== sym || Number(cid) === Number(chainId)) continue;
    for (const e of entries) elsewhere.push(e);
  }
  if (!elsewhere.length) return null;

  // A name relation on top of the symbol match identifies WHICH token is being worn.
  const mine = fold(name);
  const twin = mine ? elsewhere.find((e) => related(mine, fold(e.name))) : null;
  const target = twin || elsewhere[0];
  const where = [...new Set(elsewhere.map((e) => chainName(e.chainId)))].slice(0, 3);

  return {
    id,
    label,
    status: "warn",
    detail: twin
      ? `${twin.symbol} "${twin.name}" is an established token on ${chainName(twin.chainId)} at ${twin.address}. This is a different contract on ${chainName(chainId)} carrying that name and symbol, and it is on no curated list.`
      : `${sym} is an established token on ${where.join(", ")} at ${target.address}. This contract claims the same symbol on ${chainName(chainId)} and is on no curated list - check which ${sym} you are being pointed at.`,
  };
}

/** Lowercase alphanumerics only, so "Pump.fun", "PUMP FUN" and "pumpfun" are one string. */
const fold = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Same name, or one contained in the other - "pump" inside "pumpfun" is the reported case. */
const related = (a, b) => Boolean(a && b && a.length >= 3 && b.length >= 3 && (a === b || a.includes(b) || b.includes(a)));
