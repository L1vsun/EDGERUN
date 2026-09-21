// 4-byte selectors and revert signatures, ported from the Python engine where each one was
// computed as keccak256(signature)[:4] and cross-checked against real deployed bytecode on
// this chain.
//
// A selector found in runtime bytecode is a presence check, not a reachability proof: a
// contract can carry mint() behind onlyOwner, or never route to it. Reported as a flag to
// investigate, never as a conviction.

export const DANGEROUS = [
  ["40c10f19", "mint(address,uint256)", "supply can be increased after deploy"],
  ["8456cb59", "pause()", "transfers can be frozen by the owner"],
  ["3f4ba83a", "unpause()", "pairs with pause(), confirms a pausable pattern"],
  ["f9f92be4", "blacklist(address)", "specific wallets can be blocked from trading"],
  ["9cfe42da", "addBlacklist(address)", "blacklist pattern, alternate naming"],
  ["fe575a87", "isBlacklisted(address)", "blacklist pattern present"],
  ["c4081a4c", "setTaxFee(uint256)", "transfer tax can be changed after launch"],
  ["69fe0e2d", "setFee(uint256)", "fee can be changed after launch"],
  ["ec28438a", "setMaxTxAmount(uint256)", "per-tx transfer cap can be set by the owner"],
  ["437823ec", "excludeFromFee(address)", "fee can be selectively waived"],
];

export const MINT_SELECTOR = "40c10f19";

export function selectorsPresent(code) {
  if (!code || code === "0x") return [];
  const hex = code.toLowerCase().replace(/^0x/, "");
  return DANGEROUS.filter(([sel]) => hex.includes(sel)).map(([sel, sig, why]) => ({ sel, sig, why }));
}

// Revert selectors we can name. Anything unrecognised is reported as-is rather than guessed.
const KNOWN_REVERTS = {
  e450d38c: "insufficient balance",
  f4d678b8: "insufficient balance",
  ec442f05: "receiver rejected",
  "96c6fd1e": "sender rejected",
  d93c0665: "transfers are PAUSED",
  "55697f8b": "transfers are PAUSED",
  ffa4e618: "sender is BLACKLISTED",
  "12f1f923": "trading not enabled yet",
  a24e573d: "transfers disabled",
};

// "This wallet is empty" is not "this wallet is blocked". The explorer's holder list is a
// cached snapshot, so a listed holder may already have moved their tokens — treating that
// as a restriction produced false blacklist accusations against legitimate tokens (1INCH,
// SHRUB) in a live 45-token run. Balances are re-read on chain before simulating, and these
// reverts are still treated as benign on top of that.
const BENIGN_SELECTORS = new Set(["e450d38c", "f4d678b8"]);
const BENIGN_TEXT = ["exceeds balance", "insufficient balance", "subtraction overflow", "underflow", "transfer amount exceeds", "not enough"];

export function decodeRevert(data) {
  if (!data) return "";
  const raw = data.toLowerCase().replace(/^0x/, "");
  if (raw.length < 8) return "";
  const sel = raw.slice(0, 8);
  if (KNOWN_REVERTS[sel]) return KNOWN_REVERTS[sel];
  // Error(string)
  if (sel === "08c379a0") {
    try {
      const len = parseInt(raw.slice(72, 136), 16);
      let s = "";
      for (let i = 0; i < len; i++) s += String.fromCharCode(parseInt(raw.slice(136 + i * 2, 138 + i * 2), 16));
      const text = s.replace(/[^\x20-\x7e]/g, "").trim();
      return text ? `reverted: "${text}"` : "";
    } catch {
      return "";
    }
  }
  return `reverted with unrecognised error 0x${sel}`;
}

export function isBenignRevert(data) {
  if (!data) return false;
  const sel = data.toLowerCase().replace(/^0x/, "").slice(0, 8);
  if (BENIGN_SELECTORS.has(sel)) return true;
  const reason = decodeRevert(data).toLowerCase();
  return BENIGN_TEXT.some((t) => reason.includes(t));
}
