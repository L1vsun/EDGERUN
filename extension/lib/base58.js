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
  // ...and when the value is zero it is ALL that is left. Every zero byte is already counted
  // by `leading`, so keeping it made thirty-two 1s - the system program - decode to 33 bytes.
  if (bytes.length === 1 && bytes[0] === 0) bytes.length = 0;
  return [...new Array(leading).fill(0), ...bytes];
}

/**
 * Bytes back to base58 - needed the moment an address is DERIVED rather than read off a page
 * (a metadata account) or lifted out of raw account data (an update authority).
 */
export function encodeBase58(bytes) {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += "1";
  }
  // the seed digit is a leading zero unless the value filled it, and leading zero bytes are
  // already written above
  while (digits.length > 1 && digits[digits.length - 1] === 0) digits.pop();
  if (digits.length === 1 && digits[0] === 0) return out;
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

/** A Solana address is a 32-byte ed25519 public key written in base58. */
export function isSolanaAddress(s) {
  const str = String(s || "");
  if (str.length < 32 || str.length > 44) return false;
  const bytes = decodeBase58(str);
  return Boolean(bytes) && bytes.length === 32;
}
