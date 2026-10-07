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
let META = null; // the Metaplex metadata account, when a test wants one
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
  return {
    ok: true,
    json: async () => [
      { jsonrpc: "2.0", id: 0, result: { value: ACCOUNT } },
      { jsonrpc: "2.0", id: 1, result: { value: META } },
    ],
  };
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

// ---- a legacy SPL mint gets its name from the Metaplex account ----
//
// Until this was read, every unlisted legacy mint came back with no symbol at all - and a
// token that names itself nothing cannot be compared with the ticker in the post beside it.
const { METADATA_PROGRAM } = await import("../lib/metaplex.js");
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
const str = (t) => [...u32(t.length), ...new TextEncoder().encode(t)];
const metaplex = ({ mint: forMint, name, symbol, mutable = true, owner = METADATA_PROGRAM }) => ({
  owner,
  data: [
    Buffer.from([4, ...decodeBase58("9AhKqLR67hwapvG8SA2JFXaCshXc9nALJjpKaHZrsbkw"), ...decodeBase58(forMint),
      ...str(name), ...str(symbol), ...str(""), 0, 0, 0, 1, mutable ? 1 : 0, 0]).toString("base64"),
    "base64",
  ],
});

const LEGACY = "6dNVEpAP8tAJqMDJ5tfFTgbfnXPhLjWn5sZVwLTMSZvt";
ACCOUNT = mint();
META = metaplex({ mint: LEGACY, name: "Some Dog", symbol: "$DOG", mutable: false });
r = await scanMint(LEGACY);
assert.equal(r.symbol, "$DOG", "the symbol is read from the derived metadata account");
assert.equal(r.name, "Some Dog");
assert.equal(r.checks.find((c) => c.id === "metadata").status, "ok", "immutable metadata is a fixed name");
assert.match(r.checks.find((c) => c.id === "listed").detail, /calls itself \$DOG/);

META = metaplex({ mint: LEGACY, name: "Some Dog", symbol: "DOG", mutable: true });
r = await scanMint(LEGACY);
const meta = r.checks.find((c) => c.id === "metadata");
assert.equal(meta.status, "unresolved", "mutable is a fact, never a warning - BONK and USDC are both mutable");
assert.match(meta.detail, /9AhKqLR6.* can rewrite/);
assert.notEqual(r.verdict, "CAUTION", "and it does not cost a token its verdict");

// an account that names a DIFFERENT mint is not this mint's metadata, whatever address it sits at
META = metaplex({ mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", name: "Bonk", symbol: "BONK" });
r = await scanMint(LEGACY);
assert.equal(r.symbol, null, "a name is not taken from metadata that belongs to another mint");

// nor one the metadata program does not own
META = metaplex({ mint: LEGACY, name: "Fake", symbol: "FAKE", owner: "11111111111111111111111111111111" });
r = await scanMint(LEGACY);
assert.equal(r.symbol, null);

// inline Token-2022 metadata wins when a mint somehow has both
ACCOUNT = { owner: TOKEN2022, data: { parsed: { type: "mint", info: { decimals: 6, supply: "1", mintAuthority: null, freezeAuthority: null,
  extensions: [{ extension: "tokenMetadata", state: { name: "Inline", symbol: "INL", updateAuthority: null } }] } } } };
META = metaplex({ mint: LEGACY, name: "Other", symbol: "OTH" });
r = await scanMint(LEGACY);
assert.equal(r.symbol, "INL");
assert.equal(r.checks.find((c) => c.id === "metadata").status, "ok", "no update authority: the inline name is fixed");
META = null;

// ---- the Token-2022 powers a mint can carry ----
const t22 = (extensions, extra = {}) => ({
  owner: TOKEN2022,
  data: { parsed: { type: "mint", info: { decimals: 6, supply: "1", mintAuthority: null, freezeAuthority: null, ...extra, extensions } } },
});
const KEY = "2apBGMsS6ti9RyF5TwQTDswXBWskiJP2LD4cUEDqYJjk";
const find = (id) => r.checks.find((c) => c.id === id);

// a permanent delegate can take tokens out of anybody's account
ACCOUNT = t22([{ extension: "permanentDelegate", state: { delegate: KEY } }]);
r = await scanMint(LEGACY);
assert.equal(find("permanent_delegate").status, "warn");
assert.match(find("permanent_delegate").detail, /ANY holder's account/);
assert.equal(r.verdict, "CAUTION");

// ...and PayPal's PYUSD really has one. The same field on a vouched token is a fact.
r = await scanMint("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
assert.equal(find("permanent_delegate").status, "unresolved", "a recovery power on a vouched stablecoin is not an accusation");
assert.notEqual(r.verdict, "CAUTION");

// the slot present with nobody in it is nothing
ACCOUNT = t22([{ extension: "permanentDelegate", state: { delegate: null } }]);
r = await scanMint(LEGACY);
assert.equal(find("permanent_delegate"), undefined);

// accounts that start frozen: you can receive it and cannot move it
ACCOUNT = t22([{ extension: "defaultAccountState", state: { accountState: "frozen" } }], { freezeAuthority: KEY });
r = await scanMint(LEGACY);
assert.equal(find("default_frozen").status, "warn");
assert.match(find("default_frozen").detail, /created FROZEN and only 2apBGMsS/);
ACCOUNT = t22([{ extension: "defaultAccountState", state: { accountState: "initialized" } }]);
r = await scanMint(LEGACY);
assert.equal(find("default_frozen"), undefined, "initialized is the ordinary state");

// a token that cannot be transferred cannot be sold
ACCOUNT = t22([{ extension: "nonTransferable" }]);
r = await scanMint(LEGACY);
assert.equal(find("non_transferable").status, "warn");

// paused right now is a STATE, not a power: nobody can leave, whoever issued it
ACCOUNT = t22([{ extension: "pausableConfig", state: { authority: KEY, paused: true } }]);
r = await scanMint(LEGACY);
assert.equal(find("paused").status, "fail");
assert.equal(r.verdict, "FAIL");
r = await scanMint("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
assert.equal(r.verdict, "FAIL", "being on a list does not unpause a token");

// able to pause is a power, and softens for a vouched token like every other power
ACCOUNT = t22([{ extension: "pausableConfig", state: { authority: KEY, paused: false } }]);
r = await scanMint(LEGACY);
assert.equal(find("pausable").status, "warn");
assert.equal(find("paused"), undefined);
r = await scanMint("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
assert.equal(find("pausable").status, "unresolved");

// an unarmed hook that somebody can still arm, on a token nobody vouches for
ACCOUNT = t22([{ extension: "transferHook", state: { programId: null, authority: KEY } }]);
r = await scanMint(LEGACY);
assert.equal(find("hook_authority").status, "warn");
assert.equal(find("transfer_hook"), undefined, "it is not reported as an armed hook");
ACCOUNT = t22([{ extension: "transferHook", state: { programId: null, authority: null } }]);
r = await scanMint(LEGACY);
assert.equal(find("hook_authority"), undefined, "no program and no authority: nothing can ever be attached");

// a fee at zero that somebody can raise
ACCOUNT = t22([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: KEY, newerTransferFee: { transferFeeBasisPoints: 0 } } }]);
r = await scanMint(LEGACY);
assert.equal(find("fee_authority").status, "warn");
assert.equal(find("transfer_fee"), undefined);
ACCOUNT = t22([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: null, newerTransferFee: { transferFeeBasisPoints: 0 } } }]);
r = await scanMint(LEGACY);
assert.equal(find("fee_authority"), undefined, "a fee nobody can change, at zero, is no fee");

// ---- a second list can vouch: Jupiter's verified set, handed in by the worker ----
ACCOUNT = mint({ mintAuthority: KEY, freezeAuthority: KEY });
r = await scanMint(LEGACY);
assert.equal(r.verdict, "CAUTION", "unvouched, both authorities are warnings");
r = await scanMint(LEGACY, { context: { verified: true } });
assert.notEqual(r.verdict, "CAUTION", "a liquid-staking token has a mint authority by design, and a list that knows it says so");
assert.match(find("listed").detail, /Jupiter's verified token list/);
assert.match(find("mint_authority").detail, /worth knowing/);
r = await scanMint(LEGACY, { context: { verified: false } });
assert.equal(r.verdict, "CAUTION", "the index knowing a mint exists is not the index vouching for it");

// ---- the same symbol, already held by a verified mint ----
const { rivalCheck } = await import("../lib/solana.js");
const REAL_PUMP = { mint: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", symbol: "PUMP", name: "Pump", verified: true, holders: 310688 };
let rival = rivalCheck([REAL_PUMP], LEGACY, "$pump", false);
assert.equal(rival.status, "warn", "list-grade evidence: a warning, never a fail");
assert.match(rival.detail, /pumpCmXq.*310,688 wallets.*different mint/);
assert.equal(rivalCheck([REAL_PUMP], REAL_PUMP.mint, "PUMP", false), null, "the verified mint is not its own rival");
assert.equal(rivalCheck([REAL_PUMP], LEGACY, "PUMP", true), null, "a vouched mint is not second-guessed");
assert.equal(rivalCheck([{ ...REAL_PUMP, verified: false }], LEGACY, "PUMP", false), null,
  "an unverified token sharing a ticker is every memecoin on the chain");
assert.equal(rivalCheck([REAL_PUMP], LEGACY, "PUMPV2", false), null, "only an exact symbol counts");
assert.equal(rivalCheck(null, LEGACY, "PUMP", false), null, "the index not answering is not a finding");
assert.equal(rivalCheck([{ ...REAL_PUMP, holders: 3, mint: "x" }, REAL_PUMP], LEGACY, "PUMP", false).detail.includes("pumpCmXq"), true,
  "of several, the one most wallets hold is named");

ACCOUNT = { owner: TOKEN2022, data: { parsed: { type: "mint", info: { decimals: 6, supply: "1", mintAuthority: null, freezeAuthority: null,
  extensions: [{ extension: "tokenMetadata", state: { name: "Pump", symbol: "PUMP", updateAuthority: null } }] } } } };
r = await scanMint(LEGACY, { context: { verified: false, rivals: [REAL_PUMP] } });
assert.equal(r.verdict, "CAUTION", "a clean mint wearing a verified token's symbol is not a clean answer");
assert.equal(r.checks[0].id, "symbol_claim", "and that is the first thing said about it");

console.log("solana: ok");
