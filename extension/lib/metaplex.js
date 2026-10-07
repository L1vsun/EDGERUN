// A legacy SPL mint does not know its own name.
//
// Token-2022 can carry name and symbol inline, and `lib/solana.js` reads them from the mint.
// The older token program cannot: the name lives in a separate account owned by the Metaplex
// metadata program, at an address DERIVED from the mint. Until this file existed, every
// unlisted legacy mint - BONK-era tokens, and every launchpad that still mints on the old
// program - came back with no symbol at all, which leaves "is this the token the post names"
// with nothing to compare.
//
// Nothing here trusts an index. The address is derived locally and the account is read from
// the chain in the same batched request as the mint, so a name costs no extra round trip.
//
// Verified live 2026-10-07: the derived account for BONK, WIF, USDC and wrapped SOL each
// carries its own mint inside it, which is what `parseMetadata` checks before believing one.

import { decodeBase58, encodeBase58 } from "./base58.js";

export const METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

// ---- is this 32-byte value a point on ed25519 ----
//
// A program-derived address is, by definition, a hash that is NOT a valid public key - that
// is what guarantees nobody holds a private key for it. So deriving one means hashing, asking
// "is this on the curve", and trying the next bump until the answer is no.
//
// y is the low 255 bits, little-endian. The point exists when x^2 = (y^2 - 1) / (d*y^2 + 1)
// has a square root mod p, which Euler's criterion answers without computing the root.

const P = 2n ** 255n - 19n;
const mod = (a) => ((a % P) + P) % P;

function pow(base, exp) {
  let result = 1n;
  let b = mod(base);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

const D = mod(-121665n * pow(121666n, P - 2n));

export function isOnCurve(bytes) {
  if (!bytes || bytes.length !== 32) return false;
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  y = mod(y);
  const y2 = (y * y) % P;
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  const x2 = (u * pow(v, P - 2n)) % P;
  return x2 === 0n || pow(x2, (P - 1n) / 2n) === 1n;
}

const MARKER = [...new TextEncoder().encode("ProgramDerivedAddress")];

/** The first bump, counting down from 255, whose hash falls off the curve. */
export async function findProgramAddress(seeds, programId) {
  const program = decodeBase58(programId);
  if (!program || program.length !== 32) return null;
  const head = seeds.flatMap((s) => [...s]);
  for (let bump = 255; bump >= 0; bump--) {
    const input = new Uint8Array([...head, bump, ...program, ...MARKER]);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
    if (!isOnCurve(hash)) return { address: encodeBase58(hash), bump };
  }
  return null;
}

const SEED = [...new TextEncoder().encode("metadata")];
const derived = new Map(); // a mint's metadata address never changes

/** Where the Metaplex metadata for this mint lives, or null if `mint` is not a key. */
export async function metadataAddress(mint) {
  if (derived.has(mint)) return derived.get(mint);
  const key = decodeBase58(mint);
  if (!key || key.length !== 32) return null;
  const found = await findProgramAddress([SEED, decodeBase58(METADATA_PROGRAM), key], METADATA_PROGRAM);
  const address = found?.address || null;
  if (address) derived.set(mint, address);
  return address;
}

/**
 * The fields that decide anything, out of a raw metadata account.
 *
 * Layout: key(1) updateAuthority(32) mint(32) name symbol uri (each a u32 length then bytes)
 * sellerFee(2) creators(option) primarySale(1) isMutable(1). Strings were once padded with
 * zero bytes to a fixed width and newer accounts are not, so they are read by their length
 * prefix and trimmed - which handles both.
 *
 * Returns null on anything that does not parse. A name that cannot be read is absent, never
 * guessed.
 */
export function parseMetadata(base64) {
  let bytes;
  try {
    bytes = Uint8Array.from(atob(String(base64 || "")), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes.length < 1 + 32 + 32 + 12 + 2 + 1 + 2) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 1;
  const key32 = () => {
    const out = encodeBase58(bytes.subarray(o, o + 32));
    o += 32;
    return out;
  };
  const text = () => {
    if (o + 4 > bytes.length) throw new Error("truncated");
    const n = view.getUint32(o, true);
    o += 4;
    if (n > 512 || o + n > bytes.length) throw new Error("truncated");
    const s = new TextDecoder().decode(bytes.subarray(o, o + n)).replace(/\0+$/, "").trim();
    o += n;
    return s;
  };

  try {
    const updateAuthority = key32();
    const mint = key32();
    const name = text();
    const symbol = text();
    const uri = text();
    o += 2; // seller fee, meaningless for a fungible token
    if (bytes[o++] === 1) {
      const creators = view.getUint32(o, true);
      o += 4 + creators * 34;
    }
    o += 1; // primary sale happened
    if (o >= bytes.length) throw new Error("truncated");
    const isMutable = bytes[o] === 1;
    return { updateAuthority, mint, name: name || null, symbol: symbol || null, uri: uri || null, isMutable };
  } catch {
    return null;
  }
}
