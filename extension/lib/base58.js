// Base58, because Solana addresses are not hex and cannot be treated as though they were.
//
// This exists as its own file for one reason: every other address in this codebase is
// case-insensitive hex, and base58 is neither. Lowercasing a Solana address produces a string
// that is not that address - a bug this codebase has already shipped once, in lists.js, where
// every list entry was folded to lowercase on the way in and the Solana ones came back out
// unusable.
//
// The only question asked here is "is this a 32-byte public key", which is what makes a
// candidate string in a post worth spending an RPC call on.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

/**
 * Decode to bytes, or null if the string is not base58.
 *
 * Big-endian base conversion done a byte at a time, so it needs no BigInt and cannot lose
 * precision on a 32-byte value the way a Number-based version would.
 */
export function decodeBase58(input) {
  const s = String(input || "");
  if (!s) return null;

  const out = [0];
  for (const ch of s) {
    const value = INDEX.get(ch);
    if (value === undefined) return null;
    let carry = value;
    for (let i = 0; i < out.length; i++) {
      carry += out[i] * 58;
      out[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      out.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // A leading "1" encodes a leading zero byte and carries no value, so the loop above drops
  // it. Solana keys routinely start with them - So111... is the obvious one.
  let leading = 0;
  for (const ch of s) {
    if (ch !== "1") break;
    leading += 1;
  }

  const bytes = out.reverse();
  // the seed 0 survives as a leading byte whenever the value did not fill it
  while (bytes.length > 1 && bytes[0] === 0) bytes.shift();
  return [...new Array(leading).fill(0), ...bytes];
}

/** A Solana address is a 32-byte ed25519 public key written in base58. */
export function isSolanaAddress(s) {
  const str = String(s || "");
  if (str.length < 32 || str.length > 44) return false;
  const bytes = decodeBase58(str);
  return Boolean(bytes) && bytes.length === 32;
}
