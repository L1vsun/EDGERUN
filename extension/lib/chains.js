// The chains this extension can read, and - more importantly - what it is allowed to say
// about each of them.
//
// Robinhood Chain is not just the first entry, it is a different KIND of entry. Robinhood
// publishes the authoritative contract address for all 194 of its tokenised securities at a
// keyless endpoint, which is what lets the extension say "this is not Tesla" as a fact
// rather than as a heuristic. Nothing equivalent exists anywhere else: on Ethereum the best
// available answer is "not on any curated list, and six other contracts share this ticker".
//
// Those are not the same claim and must never render as though they were. A tool that says
// "FAKE" on tier-2 evidence is wrong often enough to be uninstalled, and being right about
// the fakes it does catch will not save it. So `authority` is carried on the chain itself
// and every verdict is capped by it:
//
//   registry - an issuer publishes the true address. Impersonation is provable.
//   list     - curated token lists only. Absence proves nothing; collisions are reportable.
//
// Every endpoint below was probed live on 2026-09-24: batched JSON-RPC, no API key, and
// `access-control-allow-origin: *`. BSC has no working Blockscout instance (bsc.blockscout.com
// and binance.blockscout.com both 404 a real token), so its explorer-backed checks - verified
// source, creator, holders - stay unresolved rather than being faked from somewhere else.

export const CHAINS = {
  robinhood: {
    key: "robinhood",
    dex: "robinhood",
    id: 4663,
    name: "Robinhood Chain",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    authority: "registry",
  },
  ethereum: {
    key: "ethereum",
    dex: "ethereum",
    id: 1,
    name: "Ethereum",
    rpc: "https://ethereum-rpc.publicnode.com",
    explorer: "https://eth.blockscout.com",
    authority: "list",
  },
  base: {
    key: "base",
    dex: "base",
    id: 8453,
    name: "Base",
    rpc: "https://mainnet.base.org",
    explorer: "https://base.blockscout.com",
    authority: "list",
  },
  arbitrum: {
    key: "arbitrum",
    dex: "arbitrum",
    id: 42161,
    name: "Arbitrum One",
    rpc: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbitrum.blockscout.com",
    authority: "list",
  },
  bsc: {
    key: "bsc",
    dex: "bsc",
    id: 56,
    name: "BNB Chain",
    rpc: "https://bsc-rpc.publicnode.com",
    explorer: null, // no Blockscout instance: source, creator and holders stay unresolved
    authority: "list",
  },
};

export const HOME = CHAINS.robinhood;

// Every entry in CHAINS is EVM. Solana is not here on purpose: it is a different provider
// (lib/solana.js), not a row with a different RPC url - there is no eth_call, no bytecode and
// no 0x address, so anything that fans out over this table would break on it.
export const ALL = Object.values(CHAINS);

/** Everywhere an 0x address could be, home chain first. */
export const ELSEWHERE = ALL.filter((c) => c !== HOME);

export const chainByKey = (key) => CHAINS[String(key || "").toLowerCase()] || null;
export const chainById = (id) => ALL.find((c) => c.id === Number(id)) || null;

/**
 * Names for chains the extension can NAME but cannot READ.
 *
 * Knowing that the real PUMP is a Solana token is worth a great deal even though nothing here
 * speaks SPL: it is the difference between "this contract impersonates nothing on this chain"
 * and "this contract is using the name of a $1.8bn token on another one". Curated token lists
 * carry that knowledge for free, and the ids below are the ones Uniswap's default list
 * actually uses (measured 2026-09-24). 501000101 is their identifier for Solana, which has no
 * EVM chain id of its own.
 */
export const CHAIN_NAMES = {
  1: "Ethereum",
  10: "Optimism",
  56: "BNB Chain",
  130: "Unichain",
  137: "Polygon",
  324: "zkSync Era",
  480: "World Chain",
  1868: "Soneium",
  4663: "Robinhood Chain",
  7777777: "Zora",
  8453: "Base",
  42161: "Arbitrum One",
  42220: "Celo",
  43114: "Avalanche",
  57073: "Ink",
  81457: "Blast",
  501000101: "Solana",
};

export const SOLANA_LIST_ID = 501000101;

export const chainName = (id) => CHAIN_NAMES[Number(id)] || `chain ${id}`;

/** True for a chain this extension can only name, not query. */
export const isReadable = (id) => Boolean(chainById(id));

export const explorerAddressUrl = (chain, address) =>
  chain?.explorer ? `${chain.explorer}/address/${address}` : null;

export const explorerTokenUrl = (chain, address) =>
  chain?.explorer ? `${chain.explorer}/token/${address}` : null;

/**
 * Where to go to actually look at the thing trading.
 *
 * Chain-scoped on purpose. Dexscreener's token endpoint is cross-chain, so the same address
 * can answer with pairs from a chain nobody meant - asking it about USDT's Ethereum address
 * returns PulseChain first, because that address exists there too and has pairs. An unscoped
 * link is the "an 0x address is a slot number on every chain" problem with a chart on top.
 * Slugs verified against the live API 2026-09-24.
 */
export const dexUrl = (chain, address) =>
  chain?.dex ? `https://dexscreener.com/${chain.dex}/${address}` : null;

/**
 * What a verdict on this chain is permitted to assert.
 *
 * The cap is the whole point of the tier: a `list` chain can report a collision and can say
 * a contract is absent from every list it knows, but it can never call something a fake,
 * because no list it has is authoritative about what the real one is.
 */
export const canProveImpersonation = (chain) => chain?.authority === "registry";
