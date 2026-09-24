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
// token program and - for Token-2022 mints - the metadata and extension set inline, which
// means name and symbol with no Metaplex PDA derivation. Measured 2026-09-24 against
// solana-rpc.publicnode.com: batched, keyless, `access-control-allow-origin: *`.
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

export const RPC_URL = "https://solana-rpc.publicnode.com";
export const CHAIN_ID = SOLANA_LIST_ID;
export const CHAIN_NAME = "Solana";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export const explorerUrl = (mint) => `https://solscan.io/token/${mint}`;

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
  const extensions = (info.extensions || []).map((e) => e.extension);
  const metadata = (info.extensions || []).find((e) => e.extension === "tokenMetadata")?.state || null;
  const transferFee = (info.extensions || []).find((e) => e.extension === "transferFeeConfig")?.state || null;
  const transferHook = (info.extensions || []).find((e) => e.extension === "transferHook")?.state || null;

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
    transferFee,
    // a hook with a real programId runs arbitrary code on every transfer; one with a null
    // programId is the extension present but unarmed, which is not the same thing
    transferHookProgram: transferHook?.programId || null,
  };
}

/**
 * Everything worth saying about a Solana mint, in the same shape an EVM verdict uses so the
 * panel and the ledger need to know nothing about which chain produced it.
 */
export async function scanMint(mint) {
  const address = String(mint || "").trim();
  if (!isSolanaAddress(address)) throw new Error("that is not a Solana address");

  const base = {
    address,
    chainId: CHAIN_ID,
    chainName: CHAIN_NAME,
    level: "full",
    scannedAt: Date.now(),
    explorerUrl: explorerUrl(address),
  };

  if (!(await spend("solana"))) {
    return { ...base, symbol: null, name: null, verdict: "UNRESOLVED", facts: 0, unresolved: 1,
      checks: [check("identity", "identity", "unresolved", "local rate budget spent - try again in a minute")] };
  }

  let value;
  try {
    const [res] = await rpc([{ method: "getAccountInfo", params: [address, { encoding: "jsonParsed" }] }]);
    if (res?.error) throw new Error(res.error.message || "rpc error");
    value = res?.result?.value;
  } catch (err) {
    return { ...base, symbol: null, name: null, verdict: "UNRESOLVED", facts: 0, unresolved: 1,
      checks: [check("identity", "identity", "unresolved", `could not read the mint: ${err.message}`)] };
  }

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
  const symbol = listed?.symbol || m.symbol || null;
  const name = listed?.name || m.name || null;

  const checks = [identityCheck(listed, m), ...authorityChecks(m, Boolean(listed)), ...extensionChecks(m)];
  const impersonation = symbolClaimCheck(list, address, symbol, Boolean(listed));
  if (impersonation) checks.unshift(impersonation);

  return { ...base, symbol, name, ...assemble(checks) };
}

function identityCheck(listed, m) {
  if (listed) {
    return check("listed", "curated list", "ok", `this mint is ${listed.symbol}${listed.name ? ` (${listed.name})` : ""} on the curated Solana list`);
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

/** Token-2022 can attach powers to a mint that legacy SPL simply does not have. */
function extensionChecks(m) {
  const out = [];
  if (!m.is2022) {
    out.push(check("program", "token program", "ok", "a legacy SPL token - no transfer hooks or transfer fees exist on this program"));
    return out;
  }

  out.push(check("program", "token program", "unresolved",
    `Token-2022${m.extensions.length ? ` with ${m.extensions.join(", ")}` : ""} - this program allows powers legacy SPL tokens cannot have`));

  if (m.transferHookProgram) {
    out.push(check("transfer_hook", "transfer hook", "warn",
      `every transfer calls ${m.transferHookProgram} first, and that program can reject it - this is the Solana equivalent of a blocked transfer and it is not visible in the token itself`));
  }

  const fee = m.transferFee?.newerTransferFee || m.transferFee?.olderTransferFee || null;
  const bps = fee?.transferFeeBasisPoints ?? null;
  if (bps != null && Number(bps) > 0) {
    out.push(check("transfer_fee", "transfer fee", "warn",
      `${(Number(bps) / 100).toFixed(2)}% is taken by the token on every transfer`));
  }

  return out;
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
