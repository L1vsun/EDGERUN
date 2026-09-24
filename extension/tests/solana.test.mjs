// Solana: base58, and what a mint account is allowed to mean.
//
// The trap this file exists to pin: real USDC holds BOTH a live mint authority and a live
// freeze authority. Treating either as a scam signal would flag the largest stablecoin on the
// chain, so the authorities are facts that only become warnings on a token nobody vouched for.
import assert from "node:assert/strict";

const local = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => {
        if (k == null) return Object.fromEntries(local);
        const o = {};
        for (const x of [].concat(k)) if (local.has(x)) o[x] = local.get(x);
        return o;
      },
      set: async (o) => { for (const [k, v] of Object.entries(o)) local.set(k, v); },
    },
    session: { get: async () => ({}), set: async () => {} },
  },
};

const { decodeBase58, isSolanaAddress } = await import("../lib/base58.js");

// ---- base58 ----
for (const key of [
  "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
  "So11111111111111111111111111111111111111112", // leading 1s are leading zero bytes
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
]) {
  assert.equal(decodeBase58(key).length, 32, `${key} is a 32-byte key`);
  assert.equal(isSolanaAddress(key), true);
}
assert.equal(isSolanaAddress("0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715"), false, "hex is not base58");
assert.equal(decodeBase58("contains0OIl"), null, "0, O, I and l are not in the alphabet");
assert.equal(isSolanaAddress("tooshort"), false);
assert.equal(isSolanaAddress("5" + "1".repeat(87)), false, "a transaction signature is 64 bytes, not 32");

// ---- the mint scan, against stubbed accounts ----

const TOKENKEG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

let ACCOUNT = null;
globalThis.fetch = async (url) => {
  if (String(url).includes("tokens.uniswap.org")) {
    return {
      ok: true,
      json: async () => ({
        tokens: [
          { chainId: 501000101, address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USDC" },
          { chainId: 501000101, address: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", symbol: "PUMP", name: "Pump.fun" },
        ],
      }),
    };
  }
  return { ok: true, json: async () => [{ jsonrpc: "2.0", id: 0, result: { value: ACCOUNT } }] };
};

const { scanMint } = await import("../lib/solana.js");

const mint = ({ program = TOKENKEG, mintAuthority = null, freezeAuthority = null, extensions = [] } = {}) => ({
  owner: program,
  data: { parsed: { type: "mint", info: { decimals: 6, supply: "1000", mintAuthority, freezeAuthority, extensions } } },
});

// --- the real USDC: both authorities live, and it is vouched for
ACCOUNT = mint({ mintAuthority: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG", freezeAuthority: "7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar" });
let r = await scanMint("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
assert.equal(r.symbol, "USDC");
assert.equal(r.chainName, "Solana");
assert.notEqual(r.verdict, "CAUTION", "flagging the largest stablecoin on Solana would be the whole tool discredited");
const auth = r.checks.find((c) => c.id === "freeze_authority");
assert.equal(auth.status, "unresolved", "a live freeze authority on a vouched token is a fact, not a warning");
assert.match(auth.detail, /can freeze any holder/, "and it is still reported in full");

// --- the same account data, unvouched: now it is a warning
ACCOUNT = mint({ mintAuthority: "Some1111111111111111111111111111111111111111", freezeAuthority: "Some1111111111111111111111111111111111111111" });
r = await scanMint("6dNVEpAP8tAJqMDJ5tfFTgbfnXPhLjWn5sZVwLTMSZvt");
assert.equal(r.verdict, "CAUTION");
assert.equal(r.checks.find((c) => c.id === "mint_authority").status, "warn");
assert.equal(r.checks.find((c) => c.id === "freeze_authority").status, "warn");

// --- renounced both ways
ACCOUNT = mint();
r = await scanMint("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
assert.equal(r.checks.find((c) => c.id === "mint_authority").status, "ok");
assert.match(r.checks.find((c) => c.id === "freeze_authority").detail, /revoked/);

// --- an armed transfer hook: the Solana honeypot primitive
ACCOUNT = mint({
  program: TOKEN2022,
  extensions: [{ extension: "transferHook", state: { programId: "Hook111111111111111111111111111111111111111" } }],
});
r = await scanMint("6dNVEpAP8tAJqMDJ5tfFTgbfnXPhLjWn5sZVwLTMSZvt");
const hook = r.checks.find((c) => c.id === "transfer_hook");
assert.equal(hook.status, "warn");
assert.match(hook.detail, /can reject it/);
assert.equal(r.verdict, "CAUTION");

// --- the same extension present but UNARMED is not a finding. The real PUMP is like this.
ACCOUNT = mint({
  program: TOKEN2022,
  extensions: [{ extension: "transferHook", state: { programId: null, authority: "x" } }],
});
r = await scanMint("pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn");
assert.equal(r.checks.find((c) => c.id === "transfer_hook"), undefined,
  "a hook slot with no program behind it blocks nothing");

// --- a transfer fee is a sell tax and says so
ACCOUNT = mint({
  program: TOKEN2022,
  extensions: [{ extension: "transferFeeConfig", state: { newerTransferFee: { transferFeeBasisPoints: 500 } } }],
});
r = await scanMint("6dNVEpAP8tAJqMDJ5tfFTgbfnXPhLjWn5sZVwLTMSZvt");
assert.match(r.checks.find((c) => c.id === "transfer_fee").detail, /5\.00%/);

// --- Token-2022 metadata supplies the name with no Metaplex PDA
ACCOUNT = {
  owner: TOKEN2022,
  data: { parsed: { type: "mint", info: { decimals: 6, supply: "1", mintAuthority: null, freezeAuthority: null,
    extensions: [{ extension: "tokenMetadata", state: { name: "Some Token", symbol: "SOME" } }] } } },
};
r = await scanMint("6dNVEpAP8tAJqMDJ5tfFTgbfnXPhLjWn5sZVwLTMSZvt");
assert.equal(r.symbol, "SOME");
assert.equal(r.name, "Some Token");

// --- a mint wearing a symbol the list has already given to another mint
ACCOUNT = {
  owner: TOKENKEG,
  data: { parsed: { type: "mint", info: { decimals: 6, supply: "1", mintAuthority: null, freezeAuthority: null,
    extensions: [{ extension: "tokenMetadata", state: { name: "Definitely USDC", symbol: "USDC" } }] } } },
};
r = await scanMint("6dNVEpAP8tAJqMDJ5tfFTgbfnXPhLjWn5sZVwLTMSZvt");
const claim = r.checks.find((c) => c.id === "symbol_claim");
assert.equal(claim.status, "warn");
assert.match(claim.detail, /EPjFWdd5/);
assert.equal(r.verdict, "CAUTION");

// --- not a mint at all: a wallet in a post is not a token
ACCOUNT = { owner: "11111111111111111111111111111111", data: { parsed: { type: "account", info: {} } } };
r = await scanMint("6dNVEpAP8tAJqMDJ5tfFTgbfnXPhLjWn5sZVwLTMSZvt");
assert.equal(r.verdict, "UNRESOLVED");
assert.equal(r.symbol, null, "no symbol is what the worker uses to drop this before it reaches a badge");

// --- nothing there
ACCOUNT = null;
r = await scanMint("6dNVEpAP8tAJqMDJ5tfFTgbfnXPhLjWn5sZVwLTMSZvt");
assert.equal(r.verdict, "UNRESOLVED");
assert.match(r.checks[0].detail, /no account at this address/);

await assert.rejects(() => scanMint("0xnothex"), /not a Solana address/);

console.log("solana: ok");
