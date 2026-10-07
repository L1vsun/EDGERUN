// Solana, read from the chain.
//
// This is a second provider, not another row in the chain table. Nothing here is an address
// with an `eth_call` behind it: a mint is an account, its authorities are fields in that
// account, and there is no bytecode to scan. What replaces bytecode scanning is better than
// bytecode scanning, because the two powers that matter are declared rather than hidden:
//
//   mint authority   - whoever holds it can create supply out of nothing, at any time.
//   freeze authority - whoever holds it can freeze any holder's account at will. This is the
//                      Solana blacklist, and unlike an EVM one it needs no special code in
//                      the token, cannot be found by reading the token's logic, and is a
//                      single field that is either null or a public key.
//
// One `getAccountInfo` with `jsonParsed` returns both, plus decimals, supply, the owning
// token program and - for Token-2022 mints - the metadata and extension set inline. A legacy
// SPL mint carries no name at all, so its Metaplex metadata account is read in the SAME
// batched request (see lib/metaplex.js): one round trip either way. Measured 2026-09-24
// against solana-rpc.publicnode.com: batched, keyless, `access-control-allow-origin: *`.
//
// What this RPC will not answer, measured 2026-10-07: `getTokenLargestAccounts` is blocked
// outright and `getTokenSupply` wants a paid key, and no other keyless endpoint offered both
// CORS and that method. So nothing here claims to have read holders from the chain. Holder
// numbers exist in this product only as an index's figure, attributed, in lib/jupiter.js.
//
// THE THING TO BE CAREFUL ABOUT: real USDC has both authorities set. A live mint authority is
// a fact about who can do what, not a verdict - a centrally issued stablecoin is supposed to
// have one. So the authorities are always reported, and only rise to a warning on a token
// nobody has vouched for. Jupiter's list supplies that vouching and nothing else: its `audit`
// and `organicScore` fields are somebody else's conclusion, and this extension does not
// borrow conclusions, it reads chains.

import { isSolanaAddress } from "./base58.js";
import { spend } from "./budget.js";
import { SOLANA_LIST_ID } from "./chains.js";
import { getList } from "./lists.js";
import { METADATA_PROGRAM, metadataAddress, parseMetadata } from "./metaplex.js";

export const RPC_URL = "https://solana-rpc.publicnode.com";
export const CHAIN_ID = SOLANA_LIST_ID;
export const CHAIN_NAME = "Solana";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export const explorerUrl = (mint) => `https://solscan.io/token/${mint}`;
export const dexUrl = (mint) => `https://dexscreener.com/solana/${mint}`;

const check = (id, label, status, detail) => ({ id, label, status, detail });

async function rpc(items) {
  if (!items.length) return [];
  const body = items.map((c, i) => ({ jsonrpc: "2.0", id: i, method: c.method, params: c.params || [] }));
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`solana rpc ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json) ? json : [json];
  const out = new Array(items.length).fill(null);
  for (const r of list) out[typeof r.id === "number" ? r.id : 0] = r;
  return out;
}

/** The mint account, reduced to the fields that decide anything. */
function readMint(value) {
  const parsed = value?.data?.parsed;
  if (!parsed || parsed.type !== "mint") return null;
  const info = parsed.info || {};
  const list = info.extensions || [];
  const extensions = list.map((e) => e.extension);
  const state = (name) => list.find((e) => e.extension === name)?.state || null;
  const metadata = state("tokenMetadata");
  const transferFee = state("transferFeeConfig");
  const transferHook = state("transferHook");

  return {
    program: value.owner,
    is2022: value.owner === TOKEN_2022,
    decimals: info.decimals ?? null,
    supply: info.supply ?? null,
    mintAuthority: info.mintAuthority || null,
    freezeAuthority: info.freezeAuthority || null,
    extensions,
    symbol: metadata?.symbol || null,
    name: metadata?.name || null,
    // Token-2022 metadata has no "immutable" flag: it can be rewritten for as long as this
    // key exists, and is fixed only once it is null
    inlineMetadata: Boolean(metadata),
    metadataAuthority: metadata?.updateAuthority || null,
    transferFee,
    transferFeeAuthority: transferFee?.transferFeeConfigAuthority || null,
    // a hook with a real programId runs arbitrary code on every transfer; one with a null
    // programId is the extension present but unarmed, which is not the same thing
    transferHookProgram: transferHook?.programId || null,
    transferHookAuthority: transferHook?.authority || null,
    permanentDelegate: state("permanentDelegate")?.delegate || null,
    defaultFrozen: state("defaultAccountState")?.accountState === "frozen",
    nonTransferable: extensions.includes("nonTransferable"),
    pausable: state("pausableConfig"),
  };
}

/**
 * The Metaplex account, believed only when it is what it claims to be.
 *
 * Two things are checked before a name is taken from it: that the metadata program owns the
 * account, and that the account names THIS mint. The address was derived rather than looked
 * up, so both should always hold - which is exactly why a mismatch means something is wrong
 * with the read and the name must not be used.
 */
function readMetaplex(value, mint) {
  if (!value || value.owner !== METADATA_PROGRAM) return null;
  const raw = Array.isArray(value.data) ? value.data[0] : null;
  const meta = parseMetadata(raw);
  if (!meta || meta.mint !== mint) return null;
  return meta;
}

/**
 * Everything worth saying about a Solana mint, in the same shape an EVM verdict uses so the
 * panel and the ledger need to know nothing about which chain produced it.
 */
/**
 * The chain read on its own: the mint account and its metadata account, in one request.
 *
 * Split out so a caller can start it BEFORE it knows anything else about the mint. The index
 * lookup that decides how the result is worded is a separate round trip, and waiting for it
 * before starting this one put a whole extra second or two between a post and its badge.
 *
 * Never throws: `{ limited: true }` is the local budget, `{ error }` is the read failing.
 */
export async function readMintAccounts(mint) {
  const address = String(mint || "").trim();
  if (!(await spend("solana"))) return { limited: true };
  try {
    // The metadata address depends only on the mint, so it is known before anything is read
    // and both accounts come back in one request.
    const pda = await metadataAddress(address).catch(() => null);
    const calls = [{ method: "getAccountInfo", params: [address, { encoding: "jsonParsed" }] }];
    if (pda) calls.push({ method: "getAccountInfo", params: [pda, { encoding: "base64" }] });
    const [res, metaRes] = await rpc(calls);
    if (res?.error) throw new Error(res.error.message || "rpc error");
    // a failed name read never fails the scan
    return { value: res?.result?.value, metaValue: metaRes?.result?.value || null };
  } catch (err) {
    return { error: err.message };
  }
}

export async function scanMint(mint, { context = null, accounts = null } = {}) {
  const address = String(mint || "").trim();
  if (!isSolanaAddress(address)) throw new Error("that is not a Solana address");

  const base = {
    address,
    chainId: CHAIN_ID,
    chainName: CHAIN_NAME,
    level: "full",
    scannedAt: Date.now(),
    explorerUrl: explorerUrl(address),
    dexUrl: dexUrl(address),
  };

  // `accounts` is a read somebody already started; otherwise it is started here
  const read = await (accounts || readMintAccounts(address));
  if (read.limited) {
    return { ...base, symbol: null, name: null, verdict: "UNRESOLVED", facts: 0, unresolved: 1,
      checks: [check("identity", "identity", "unresolved", "local rate budget spent - try again in a minute")] };
  }
  if (read.error) {
    return { ...base, symbol: null, name: null, verdict: "UNRESOLVED", facts: 0, unresolved: 1,
      checks: [check("identity", "identity", "unresolved", `could not read the mint: ${read.error}`)] };
  }
  const { value, metaValue } = read;

  if (!value) {
    return { ...base, symbol: null, name: null, verdict: "UNRESOLVED", facts: 0, unresolved: 1,
      checks: [check("identity", "identity", "unresolved", "there is no account at this address on Solana")] };
  }

  const m = readMint(value);
  if (!m) {
    const kind = value.owner === TOKEN_PROGRAM || value.owner === TOKEN_2022 ? "a token account, not a mint" : "not a token";
    return { ...base, symbol: null, name: null, verdict: "UNRESOLVED", facts: 0, unresolved: 1,
      checks: [check("identity", "identity", "unresolved", `this address is ${kind} - it holds no supply and has no ticker`)] };
  }

  const list = await getList();
  const listed = list.loaded ? list.byAddress[`${CHAIN_ID}:${address.toLowerCase()}`] : null;
  // Inline Token-2022 metadata wins over the Metaplex account when a mint has both: it is
  // the one the token program itself serves.
  const metaplex = m.inlineMetadata ? null : readMetaplex(metaValue, address);
  const symbol = listed?.symbol || m.symbol || metaplex?.symbol || null;
  const name = listed?.name || m.name || metaplex?.name || null;

  // Two sources can vouch, and both are lists - neither is an issuer's registry. The curated
  // list is the one this extension loads itself; `context.verified` is Jupiter's, handed in
  // by the worker when it has it. Without either, a token is simply unvouched.
  const vouchedBy = listed ? "the curated Solana list" : context?.verified ? "Jupiter's verified token list" : null;
  const vouched = Boolean(vouchedBy);

  const checks = [
    identityCheck(listed, { ...m, symbol: m.symbol || metaplex?.symbol || null, name: m.name || metaplex?.name || null }, vouchedBy),
    ...authorityChecks(m, vouched),
    ...extensionChecks(m, vouched),
    metadataCheck(m, metaplex),
  ].filter(Boolean);
  const impersonation = symbolClaimCheck(list, address, symbol, vouched) || rivalCheck(context?.rivals, address, symbol, vouched);
  if (impersonation) checks.unshift(impersonation);

  return { ...base, symbol, name, ...assemble(checks) };
}

function identityCheck(listed, m, vouchedBy) {
  if (listed) {
    return check("listed", "curated list", "ok", `this mint is ${listed.symbol}${listed.name ? ` (${listed.name})` : ""} on the curated Solana list`);
  }
  if (vouchedBy) {
    return check("listed", "curated list", "ok", `this mint is ${m.symbol || m.name || "listed"} on ${vouchedBy}`);
  }
  if (m.symbol || m.name) {
    return check("listed", "curated list", "unresolved",
      `calls itself ${m.symbol || m.name} in its own on-chain metadata and is on no curated list, which is normal for a new token and is not a finding on its own`);
  }
  return check("listed", "curated list", "unresolved", "no on-chain metadata and not on any curated list, so this mint names itself nothing");
}

/**
 * The two powers, always reported and only sometimes a warning.
 *
 * Real USDC holds both. A stablecoin issuer that could not mint or freeze would not be able
 * to do its job, so "has a mint authority" is not a finding about a vouched-for token. It is
 * a finding about one nobody has vouched for, and the difference is the entire reason the
 * curated list is consulted before the status is chosen.
 */
function authorityChecks(m, vouched) {
  const out = [];
  const status = vouched ? "unresolved" : "warn";

  out.push(
    m.mintAuthority
      ? check("mint_authority", "mint authority", status,
          `${m.mintAuthority} can mint new supply at any time${vouched ? " - expected for a token with an issuer, and worth knowing" : ", and nobody has vouched for this token"}`)
      : check("mint_authority", "mint authority", "ok", "revoked - the supply cannot be increased by anyone"),
  );

  out.push(
    m.freezeAuthority
      ? check("freeze_authority", "freeze authority", status,
          `${m.freezeAuthority} can freeze any holder's account at will${vouched ? " - expected for a regulated issuer" : ", which is how a Solana token stops you selling"}`)
      : check("freeze_authority", "freeze authority", "ok", "revoked - no account can be frozen, by anyone"),
  );

  return out;
}

/**
 * Token-2022 can attach powers to a mint that legacy SPL simply does not have.
 *
 * The rule for each is the one the authorities already follow: a power is always REPORTED,
 * and it is a WARNING only on a token nobody has vouched for. PayPal's PYUSD carries a
 * permanent delegate, a fee authority and a hook authority at once, on purpose - it is a
 * regulated stablecoin - and flagging it would be the USDC mistake again with more rows.
 *
 * Two of them are not powers but STATES, and those do not soften for anyone: a token that is
 * paused right now, or that cannot be transferred at all, is a fact about whether you can
 * leave, whoever issued it.
 */
function extensionChecks(m, vouched) {
  const out = [];
  if (!m.is2022) {
    out.push(check("program", "token program", "ok", "a legacy SPL token - no transfer hooks, transfer fees or delegates exist on this program"));
    return out;
  }

  const power = vouched ? "unresolved" : "warn";

  out.push(check("program", "token program", "unresolved",
    `Token-2022${m.extensions.length ? ` with ${m.extensions.join(", ")}` : ""} - this program allows powers legacy SPL tokens cannot have`));

  if (m.permanentDelegate) {
    out.push(check("permanent_delegate", "permanent delegate", power,
      `${m.permanentDelegate} can move or burn tokens out of ANY holder's account, at any time, with no approval${vouched ? " - a recovery power some regulated issuers keep" : ". No holder can refuse it and it cannot be seen in a wallet"}`));
  }

  if (m.defaultFrozen) {
    out.push(check("default_frozen", "accounts start frozen", power,
      `every new holder's account is created FROZEN${m.freezeAuthority ? ` and only ${m.freezeAuthority} can thaw it` : ""} - you can be sent this token and be unable to move it${vouched ? ", which is how a permissioned asset works" : ". This is the Token-2022 honeypot"}`));
  }

  if (m.nonTransferable) {
    out.push(check("non_transferable", "non-transferable", "warn",
      "this token cannot be transferred at all - whoever holds it keeps it. That is by design for a badge or a receipt, and it means there is no selling it"));
  }

  if (m.pausable?.paused) {
    out.push(check("paused", "paused", "fail",
      "every transfer of this token is PAUSED right now - nobody can move it until whoever paused it lifts the pause"));
  } else if (m.pausable?.authority) {
    out.push(check("pausable", "pausable", power,
      `${m.pausable.authority} can pause every transfer of this token at once${vouched ? "" : ", and nobody has vouched for this token"}`));
  }

  if (m.transferHookProgram) {
    out.push(check("transfer_hook", "transfer hook", "warn",
      `every transfer calls ${m.transferHookProgram} first, and that program can reject it - this is the Solana equivalent of a blocked transfer and it is not visible in the token itself`));
  } else if (m.transferHookAuthority && !vouched) {
    // Unarmed on a vouched token is nothing: the real PUMP is exactly this. Unarmed on a
    // token nobody vouches for is a switch that has not been thrown yet.
    out.push(check("hook_authority", "transfer hook, unarmed", "warn",
      `no hook program is set today, but ${m.transferHookAuthority} can attach one at any time - and a hook can reject any transfer`));
  }

  const fee = m.transferFee?.newerTransferFee || m.transferFee?.olderTransferFee || null;
  const bps = fee?.transferFeeBasisPoints ?? null;
  if (bps != null && Number(bps) > 0) {
    out.push(check("transfer_fee", "transfer fee", "warn",
      `${(Number(bps) / 100).toFixed(2)}% is taken by the token on every transfer${m.transferFeeAuthority ? `, and ${m.transferFeeAuthority} can change that rate` : ""}`));
  } else if (m.transferFee && m.transferFeeAuthority && !vouched) {
    out.push(check("fee_authority", "transfer fee, at zero", "warn",
      `the fee is 0% today, but ${m.transferFeeAuthority} can raise it - a sell tax that can be switched on after you buy`));
  }

  return out;
}

/**
 * Can the name change after you have read it.
 *
 * Reported for every mint and never a warning: BONK and USDC are both mutable. It is here
 * because the symbol is what every other identity check compares, and a reader should know
 * whether it is fixed or merely current.
 */
function metadataCheck(m, metaplex) {
  if (m.inlineMetadata) {
    return m.metadataAuthority
      ? check("metadata", "name and symbol", "unresolved", `${m.metadataAuthority} can rewrite this token's name and symbol - what it is called today is not fixed`)
      : check("metadata", "name and symbol", "ok", "fixed - the metadata has no update authority, so the name and symbol cannot be changed");
  }
  if (!metaplex) return null;
  return metaplex.isMutable
    ? check("metadata", "name and symbol", "unresolved", `${metaplex.updateAuthority} can rewrite this token's name and symbol - what it is called today is not fixed`)
    : check("metadata", "name and symbol", "ok", "fixed - the metadata is immutable, so the name and symbol cannot be changed");
}

/**
 * Is this mint wearing a symbol the curated list gives to a different mint.
 *
 * The mirror of `crossChainNameCheck`: there, an EVM contract wears a Solana token's name;
 * here, an unvouched Solana mint wears a name the list has already assigned on Solana.
 */
function symbolClaimCheck(list, address, symbol, vouched) {
  if (!list?.loaded || vouched || !symbol) return null;
  const key = `${CHAIN_ID}:${String(symbol).toUpperCase().replace(/^\$/, "")}`;
  const claimants = (list.bySymbol[key] || []).filter((c) => c.address !== address);
  if (!claimants.length) return null;
  const one = claimants[0];
  return check("symbol_claim", "symbol already taken", "warn",
    `the curated Solana list gives ${one.symbol} to ${one.address}${one.name ? ` (${one.name})` : ""}. This is a different mint using that symbol.`);
}

/**
 * The same question asked of a much longer list.
 *
 * The curated list above knows a couple of hundred Solana tokens. Jupiter's verified set
 * knows thousands, and the worker hands in whichever VERIFIED tokens already use this symbol.
 * A hit is still list-grade evidence - "a different mint already has this name", never
 * "this is a fake" - so it is a warning, exactly as the curated-list version is.
 *
 * Only an exact symbol counts, and only a verified holder of it. An unverified token sharing
 * a ticker with other unverified tokens is every memecoin on the chain, and saying so under
 * each of them would be the bare-ticker noise problem again.
 */
const sym = (s) => String(s || "").toUpperCase().replace(/^\$/, "").trim();

export function rivalCheck(rivals, address, symbol, vouched) {
  if (vouched || !symbol || !rivals?.length) return null;
  const mine = sym(symbol);
  const taken = rivals
    .filter((r) => r?.verified && r.mint && r.mint !== address && sym(r.symbol) === mine)
    .sort((a, b) => (b.holders || 0) - (a.holders || 0))[0];
  if (!taken) return null;
  const held = taken.holders ? `, held by ${Number(taken.holders).toLocaleString("en-US")} wallets` : "";
  return check("symbol_claim", "symbol already taken", "warn",
    `Jupiter's verified list gives ${taken.symbol} to ${taken.mint}${taken.name ? ` (${taken.name})` : ""}${held}. This is a different mint using that symbol.`);
}

function assemble(checks) {
  const anyFail = checks.some((c) => c.status === "fail");
  const anyWarn = checks.some((c) => c.status === "warn");
  const unresolved = checks.filter((c) => c.status === "unresolved").length;

  // Same rule as the EVM side: PASS means nothing was found against it, so a warning denies
  // it. There is no OFFICIAL here - nobody publishes an authoritative registry for Solana.
  let verdict;
  if (anyFail) verdict = "FAIL";
  else if (anyWarn) verdict = "CAUTION";
  else if (unresolved === checks.length) verdict = "UNRESOLVED";
  else verdict = "PASS";

  return { verdict, checks, facts: checks.length - unresolved, unresolved };
}
