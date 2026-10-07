// A legacy SPL mint's name lives at an address that has to be DERIVED, not looked up.
//
// Every expected address below was verified against the live chain on 2026-10-07: the account
// at the derived address carried its own mint inside it. If the curve test or the hashing is
// wrong by one bit these do not come out close - they come out as different accounts - so
// four real mints is a complete check of the derivation.
import assert from "node:assert/strict";

const { decodeBase58, encodeBase58 } = await import("../lib/base58.js");
const { METADATA_PROGRAM, findProgramAddress, isOnCurve, metadataAddress, parseMetadata } = await import("../lib/metaplex.js");

// ---- base58 goes both ways now ----
for (const key of [
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  "So11111111111111111111111111111111111111112", // leading 1s are leading zero bytes
  "11111111111111111111111111111111", // all zero: the system program
  METADATA_PROGRAM,
]) {
  assert.equal(encodeBase58(decodeBase58(key)), key, `${key} survives a round trip`);
}
assert.equal(encodeBase58(new Uint8Array(32)).length, 32, "32 zero bytes are 32 ones, not an empty string");

// ---- the curve ----
// A real public key is a point; the derived addresses below are, by construction, not.
assert.equal(isOnCurve(decodeBase58("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")), true);
assert.equal(isOnCurve(decodeBase58("FDZZbyY9XGpL3CNKUZxLk3wFTTQYL3TkDiDzqxrizcPN")), false, "a program-derived address has no private key");
assert.equal(isOnCurve([1, 2, 3]), false, "not 32 bytes, not a point");

// ---- the derivation, against four real mints ----
const REAL = {
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "FDZZbyY9XGpL3CNKUZxLk3wFTTQYL3TkDiDzqxrizcPN", // BONK
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: "C1BpuaMytZAbSCFf9WM2gm6fAm54Yh1gh32ieptrp12B", // WIF
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "5x38Kp4hvdomTCnCrAny4UtMUt5rQBdB6px2K1Ui45Wq", // USDC
  So11111111111111111111111111111111111111112: "6dM4TqWyWJsbx7obrdLcviBkTafD5E8av61zfU6jq57X", // wrapped SOL
};
for (const [mint, expected] of Object.entries(REAL)) {
  assert.equal(await metadataAddress(mint), expected, `metadata account for ${mint}`);
}
assert.equal(await metadataAddress("not a key"), null);
assert.equal(await metadataAddress("0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715"), null, "hex is not a mint");
assert.equal(await findProgramAddress([[1]], "not a program"), null);

// ---- parsing the account ----
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
const str = (s, pad = 0) => {
  const bytes = [...new TextEncoder().encode(s)];
  while (bytes.length < pad) bytes.push(0);
  return [...u32(bytes.length), ...bytes];
};
const account = ({ authority, mint, name, symbol, uri = "", creators = 0, mutable = true, pad = true }) =>
  Buffer.from([
    4, // MetadataV1
    ...decodeBase58(authority),
    ...decodeBase58(mint),
    ...str(name, pad ? 32 : 0),
    ...str(symbol, pad ? 10 : 0),
    ...str(uri, pad ? 200 : 0),
    0, 0, // seller fee
    ...(creators ? [1, ...u32(creators), ...new Array(creators * 34).fill(7)] : [0]),
    1, // primary sale happened
    mutable ? 1 : 0,
    0, 0, 0, // whatever follows
  ]).toString("base64");

const AUTH = "9AhKqLR67hwapvG8SA2JFXaCshXc9nALJjpKaHZrsbkw";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

// the classic layout: strings padded with zero bytes to a fixed width
let m = parseMetadata(account({ authority: AUTH, mint: BONK, name: "Bonk", symbol: "Bonk", uri: "https://arweave.net/x", mutable: true }));
assert.equal(m.mint, BONK);
assert.equal(m.updateAuthority, AUTH);
assert.equal(m.name, "Bonk", "padding is trimmed, not kept as part of the name");
assert.equal(m.symbol, "Bonk");
assert.equal(m.isMutable, true);

// the newer layout: no padding at all. Read by length prefix, so both parse.
m = parseMetadata(account({ authority: AUTH, mint: BONK, name: "dogwifhat", symbol: "$WIF", mutable: false, pad: false }));
assert.equal(m.symbol, "$WIF");
assert.equal(m.isMutable, false);

// creators sit between the strings and the flag, and their count moves the flag
m = parseMetadata(account({ authority: AUTH, mint: BONK, name: "A", symbol: "A", creators: 3, mutable: false }));
assert.equal(m.isMutable, false, "three creators are skipped over, not read as the flag");
m = parseMetadata(account({ authority: AUTH, mint: BONK, name: "A", symbol: "A", creators: 3, mutable: true }));
assert.equal(m.isMutable, true);

// anything that does not parse is absent, never guessed
assert.equal(parseMetadata(""), null);
assert.equal(parseMetadata("not base64 !!"), null);
assert.equal(parseMetadata(Buffer.from([4, 1, 2, 3]).toString("base64")), null, "too short to be one");
const lying = Buffer.from(account({ authority: AUTH, mint: BONK, name: "A", symbol: "A" }), "base64");
lying.writeUInt32LE(0x7fffffff, 65); // a name length that runs off the end
assert.equal(parseMetadata(lying.toString("base64")), null, "a length that overruns the account is not followed");

console.log("metaplex: ok");
