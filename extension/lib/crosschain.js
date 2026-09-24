// Where else this address exists, and what it is there.
//
// An 0x address is not a token, it is a slot number that every EVM chain has. The same forty
// hex characters can be a stablecoin on one chain, a honeypot on another and empty on a
// third, and the post that pasted it usually does not say which one it meant. That ambiguity
// is not a rare edge case, it is the ordinary condition of reading a contract address off a
// timeline.
//
// So rather than ask the reader to pick a chain from a dropdown, this asks every chain at
// once and reports what came back. Three shapes matter, and each is worth saying out loud:
//
//   one chain only     - unambiguous. The post meant that one.
//   several, same token- a real multi-chain deployment. Usually fine, sometimes a clone.
//   several, DIFFERENT - the interesting one. Same address, different symbol per chain, which
//                        is how a transfer ends up on the chain nobody meant.
//
// One batched POST per chain, run in parallel and settled independently: a dead RPC on one
// chain must degrade that row, never the answer. Cached for an hour because deployed
// bytecode does not move.

import { spend } from "./budget.js";
import { SEL, decodeString, decodeUint, ethCall, getCode, rpc } from "./chain.js";
import { ALL, explorerTokenUrl } from "./chains.js";

const TTL_MS = 60 * 60 * 1000;
const key = (address) => `xc:${address.toLowerCase()}`;

/** One chain's answer: is anything deployed here, and if so what does it call itself. */
async function onChain(chain, address) {
  const calls = [
    getCode(address),
    ethCall(address, SEL.symbol),
    ethCall(address, SEL.name),
    ethCall(address, SEL.decimals),
  ];
  const [code, symbol, name, decimals] = await rpc(calls, { chain });

  const bytecode = code?.result;
  // "0x" is the answer for an address that has never been deployed to, and also for a plain
  // wallet. Either way there is no contract here and nothing further to read.
  const present = typeof bytecode === "string" && bytecode.length > 2;
  if (!present) return { key: chain.key, name: chain.name, id: chain.id, present: false };

  const sym = decodeString(symbol?.result);
  const tokenName = decodeString(name?.result);
  const dec = decodeUint(decimals?.result);

  return {
    key: chain.key,
    name: chain.name,
    id: chain.id,
    present: true,
    // a contract that answers none of the ERC-20 identity calls is deployed but is not a token
    isToken: Boolean(sym || tokenName),
    symbol: sym,
    tokenName,
    decimals: dec === null ? null : Number(dec),
    bytes: (bytecode.length - 2) / 2,
    explorerUrl: explorerTokenUrl(chain, address),
  };
}

/**
 * What this address is on every chain in the table.
 *
 * `chains` is injectable so the tests can run this against stubs instead of five live RPCs.
 */
export async function whereItLives(address, { chains = ALL, fresh = false } = {}) {
  const addr = String(address).toLowerCase();

  if (!fresh) {
    try {
      const got = await chrome.storage.local.get(key(addr));
      const hit = got[key(addr)];
      if (hit && Date.now() - hit.at < TTL_MS) return { ...hit, cached: true };
    } catch {
      /* storage blocked: just ask again */
    }
  }

  // One request per chain. Budgeted together rather than one at a time, so a sweep either
  // runs whole or does not run - a half-answered "it exists on 2 chains" is a wrong answer,
  // not a partial one.
  if (!(await spend("rpc", chains.length))) {
    return { address: addr, at: Date.now(), error: "out of rpc budget for this minute", chains: [] };
  }

  const settled = await Promise.allSettled(chains.map((c) => onChain(c, addr)));
  const rows = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : { key: chains[i].key, name: chains[i].name, id: chains[i].id, present: null, error: String(s.reason?.message || s.reason) },
  );

  const out = { address: addr, at: Date.now(), chains: rows, ...summarize(rows) };
  chrome.storage.local.set({ [key(addr)]: out }).catch(() => {});
  return out;
}

/**
 * The one line this is worth. Pure, and exported, because the wording is a claim.
 *
 * "deployed on 3 chains" is an observation. "this is a cross-chain scam" is a guess about
 * intent, and this function is careful never to make it - the disagreement between symbols
 * is stated, and the reader draws the conclusion.
 */
export function summarize(rows) {
  const live = (rows || []).filter((r) => r.present === true);
  const unreachable = (rows || []).filter((r) => r.present === null);
  const tokens = live.filter((r) => r.isToken);
  const symbols = [...new Set(tokens.map((r) => String(r.symbol || "").toUpperCase()).filter(Boolean))];

  const tail = unreachable.length ? ` (${unreachable.length} chain${unreachable.length === 1 ? "" : "s"} unreachable)` : "";

  if (!live.length) {
    return { count: 0, symbols, conflict: false, say: `nothing is deployed at this address on any chain checked${tail}` };
  }
  if (live.length === 1) {
    const only = live[0];
    return {
      count: 1,
      symbols,
      conflict: false,
      say: `${only.isToken ? `${only.symbol || "a token"} on ` : "a contract on "}${only.name} only${tail}`,
    };
  }
  const where = live.map((r) => r.name).join(", ");
  if (symbols.length > 1) {
    return {
      count: live.length,
      symbols,
      conflict: true,
      say: `deployed on ${live.length} chains under different symbols - ${symbols.join(" / ")} - on ${where}${tail}`,
    };
  }
  return {
    count: live.length,
    symbols,
    conflict: false,
    say: `the same ${symbols[0] || "contract"} on ${live.length} chains: ${where}${tail}`,
  };
}
