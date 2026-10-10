// The only place that talks to the network.
//
// Content scripts never fetch anything themselves - they ask for a verdict and get one back,
// from cache where possible. That is what keeps a timeline with forty tickers on screen from
// turning into forty requests: identical addresses collapse into one in-flight promise, the
// whole batch resolves in a single JSON-RPC round trip, and everything is cached by address.
//
// MV3 kills this worker after ~30 s idle, so nothing important lives in a variable: the
// registry, the verdict cache, the watchlist and the spend budget are all in storage.

import { getBlocklist } from "../lib/blocklist.js";
import { remaining } from "../lib/budget.js";
import { ALL as ALL_CHAINS } from "../lib/chains.js";
import { whereItLives } from "../lib/crosschain.js";
import { getList, listCheck } from "../lib/lists.js";
import { isSolanaAddress } from "../lib/base58.js";
import * as solana from "../lib/solana.js";
import { bindingCheck, deepChecks, launchChecks, lookupSymbol, readContext, readDeep, sameSymbol } from "../lib/jupiter.js";
import { readHolders } from "../lib/holders.js";
import { cardCaption, renderCard, stakeCard, tokenCard } from "../lib/card.js";
import {
  creatorChecks, creatorTradeCheck, crowdChecks, forgetNamed, funderGroups, isBusy, namedHolders,
  noteNamed, readCreator, readCrowd, readTrades, spreadCheck, stakeLine, stakeOf, walletsOf,
} from "../lib/crowd.js";
import { deployerTrail, trailChecks } from "../lib/deployer.js";
import { exitSweep } from "../lib/exit.js";
import * as graph from "../lib/graph.js";
import * as ledger from "../lib/ledger.js";
import { pruneMemory, rememberAndRecall } from "../lib/memory.js";
import { parseClaims, validateClaim } from "../lib/claim.js";
import { runClaim } from "../lib/verify.js";
import { readMarket } from "../lib/market.js";
import { readCandles } from "../lib/candles.js";
import { getRegistry } from "../lib/registry.js";
import { isAddress, lookupTicker, rankCandidates, resolveTicker, scan, scanMany } from "../lib/verdict.js";

const TTL = { identity: 15 * 60 * 1000, full: 5 * 60 * 1000 };
const TICKER_TTL = 6 * 60 * 60 * 1000; // which contracts claim a ticker barely changes
const cacheKey = (address, level) => `v:${level}:${address.toLowerCase()}`;
const inflight = new Map();

async function cacheGet(address, level) {
  try {
    const key = cacheKey(address, level);
    const got = await chrome.storage.local.get(key);
    const hit = got[key];
    if (hit && Date.now() - hit.scannedAt < TTL[level]) return hit;
  } catch {
    /* storage blocked: just re-scan */
  }
  return null;
}

const cachePut = (result) =>
  chrome.storage.local.set({ [cacheKey(result.address, result.level)]: result }).catch(() => {});

/** A full verdict outranks an identity one for display, so prefer it when it is still warm. */
async function bestCached(address) {
  return (await cacheGet(address, "full")) || (await cacheGet(address, "identity"));
}

async function getVerdict(address, level = "identity", { fresh = false } = {}) {
  if (!isAddress(address)) throw new Error("that is not a contract address");
  const addr = address.toLowerCase();
  if (!fresh) {
    const cached = level === "identity" ? await bestCached(addr) : await cacheGet(addr, level);
    if (cached) return { ...cached, cached: true };
  }
  const key = `${level}:${addr}`;
  if (inflight.has(key)) return inflight.get(key);
  const p = scan(addr, { level })
    .then(async (r) => {
      // recorded once, on the fresh scan - a cached read must not inflate "seen 9 times"
      const notes = await rememberAndRecall(r);
      const out = notes.length ? { ...r, checks: [...r.checks, ...notes] } : r;
      cachePut(out);
      return out;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function getVerdicts(addresses) {
  const wanted = [...new Set((addresses || []).filter(isAddress).map((a) => a.toLowerCase()))];
  const out = {};
  const missing = [];
  for (const addr of wanted) {
    const cached = await bestCached(addr);
    if (cached) out[addr] = { ...cached, cached: true };
    else missing.push(addr);
  }
  if (missing.length) {
    const fresh = await scanMany(missing);
    for (const [addr, r] of Object.entries(fresh)) {
      const notes = await rememberAndRecall(r);
      const withNotes = notes.length ? { ...r, checks: [...r.checks, ...notes] } : r;
      out[addr] = withNotes;
      cachePut(withNotes);
    }
  }
  return out;
}

// The deployer trail is slow and expensive, so it is asked for explicitly and cached for an
// hour - a wallet's launch history does not change minute to minute.
const trailCache = new Map();
async function getTrail(address) {
  const addr = String(address).toLowerCase();
  const hit = trailCache.get(addr);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.data;
  const trail = await deployerTrail(addr);
  const data = { trail, checks: trailChecks(trail) };
  trailCache.set(addr, { at: Date.now(), data });
  return data;
}

// The size sweep is one batched POST but still a real round trip, and the answer only moves
// when the contract's limits do. Ten minutes is short enough to catch a limit being switched
// on mid-session and long enough that reopening a row is free.
const exitCache = new Map();
async function getExitSweep(address) {
  const addr = String(address).toLowerCase();
  const hit = exitCache.get(addr);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  const data = await exitSweep(addr);
  exitCache.set(addr, { at: Date.now(), data });
  return data;
}

// ---- Solana ----
//
// Same cache shape as the EVM side and a separate key space, because a base58 mint and a hex
// address can never collide but the two scans answer different questions and have different
// costs.
const SOL_TTL = 10 * 60 * 1000;
const solCache = new Map();

const mintCached = (mint, fresh) => {
  const hit = solCache.get(mint);
  return !fresh && hit && Date.now() - hit.at < SOL_TTL ? hit.data : null;
};

async function getMint(mint, { fresh = false, context = null, accounts = null } = {}) {
  const hit = mintCached(mint, fresh);
  if (hit) return hit;
  const scanned = await solana.scanMint(mint, { context, accounts });
  // The index's context rides along on the result but stays OUT of the checks: the verdict
  // above was reached from the chain and two lists, and a row that says "147 holders" next
  // to "freeze authority revoked" would be passing off somebody's count as something read.
  const data = context ? { ...scanned, context: slim(context) } : scanned;
  solCache.set(mint, { at: Date.now(), data });
  return data;
}

/** The part of the context a badge or a panel row draws from, and nothing else. */
const slim = ({ verified, x, dev, launchpad, createdAt, graduatedAt, holders, top10Pct, devPct, devMints, devMigrations, supply, priceUsd, mcapUsd, at }) =>
  ({ verified, x, dev, launchpad, createdAt, graduatedAt, holders, top10Pct, devPct, devMints, devMigrations, supply, priceUsd, mcapUsd, at });

/**
 * Resolve base58 candidates found in page text.
 *
 * The content script cannot decode base58, so what arrives here is "32 to 44 characters that
 * could be a key" - most of which are not. Validation drops the junk, and anything that is a
 * real account but not a MINT is dropped too rather than badged: a wallet address in a post
 * is not a token, and putting "this is not a mint" under every post that quotes one is the
 * bare-ticker noise problem in a new alphabet.
 *
 * One request to the index covers the whole batch, before any mint is scanned, because two
 * things in it change what the scan is allowed to say: whether a list vouches for the mint,
 * and which verified mints already hold its symbol. If the index does not answer, every mint
 * is scanned exactly as it was before the index existed.
 */
async function scanMints(wanted, { fresh = false } = {}) {
  if (!wanted.length) return [];
  // The chain reads start NOW, before the index has said anything. They do not depend on it -
  // only the wording of the result does - so the two run together rather than in a queue.
  const reads = new Map(wanted.filter((m) => !mintCached(m, fresh)).map((m) => [m, solana.readMintAccounts(m)]));
  const known = await readContext(wanted, { fresh }).catch(() => ({}));
  // Side by side, not one after another. A timeline unmounts a post the moment it scrolls
  // away, so an answer that arrives late arrives to nothing: four mints read in sequence was
  // nine round trips before the first badge could be drawn, and by then the post was gone.
  const scanned = await Promise.all(wanted.map(async (mint) => {
    try {
      const ctx = known[mint] || null;
      const rivals = ctx && !ctx.verified && ctx.symbol ? await sameSymbol(ctx.symbol).catch(() => null) : null;
      return await getMint(mint, { fresh, context: ctx ? { ...ctx, rivals } : null, accounts: reads.get(mint) || null });
    } catch {
      return null; // one bad mint must not sink the batch
    }
  }));
  return scanned.filter(Boolean);
}

// not a mint, or unreadable: nothing a badge could honestly say
const isNothing = (r) => r.verdict === "UNRESOLVED" && !r.symbol;

async function resolveMints(candidates, { fresh = false, limit = 4 } = {}) {
  const wanted = [...new Set(candidates || [])].filter(isSolanaAddress).slice(0, limit);
  return (await scanMints(wanted, { fresh })).filter((r) => !isNothing(r));
}

/**
 * One mint, asked for by name - a token page, or a re-check.
 *
 * Unlike a batch off a timeline, a failure here is reported rather than dropped, and reported
 * as what it was: "not a mint", "could not be read" and "out of budget" are three different
 * answers and the page that asked shows whichever one is true.
 */
async function resolveMint(address, { fresh = false } = {}) {
  if (!isSolanaAddress(address)) throw new Error("that is not a Solana address");
  const [r] = await scanMints([address], { fresh });
  if (!r) throw new Error("the mint could not be read");
  if (isNothing(r)) throw new Error(r.checks?.[0]?.detail || "that address is not a token mint");
  return r;
}

// ---- the crowd around a mint ----
//
// The index's holder list, kept for five minutes. Every list that is read also teaches the
// book which wallet the index files under which X account - that is the only place such a
// pairing ever appears, so it is harvested whenever it goes by.
const CROWD_TTL = 5 * 60 * 1000;
const crowdCache = new Map();

async function getCrowd(mint, { fresh = false } = {}) {
  const hit = crowdCache.get(mint);
  if (!fresh && hit && Date.now() - hit.at < CROWD_TTL) return hit.data;
  const ctx = (await readContext([mint]).catch(() => ({})))[mint] || null;
  // no supply, no percentages: the list's amounts mean nothing without the total
  if (!ctx?.supply) return { status: "none" };
  const read = await readCrowd(mint, ctx.supply);
  if (read.status !== "read") return read;
  const data = { ...read, vouched: ctx.verified === true, supply: ctx.supply };
  crowdCache.set(mint, { at: Date.now(), data });
  await noteNamed(data.rows);
  return data;
}

/** Who paid for the wallets that hold it. Asked for, never automatic. */
async function getCrowdChecks(mint, { fresh = false, vouched = false } = {}) {
  if (!isSolanaAddress(mint)) throw new Error("that is not a Solana mint");
  const c = await getCrowd(mint, { fresh });
  if (c.status !== "read") return { status: c.status, checks: [] };
  // Only a group that could become a warning is worth a chain read, and only two are shown.
  const busy = {};
  for (const g of funderGroups(c.rows).slice(0, 2)) {
    const b = await isBusy(g.funder);
    if (b !== null) busy[g.funder] = b;
  }
  return {
    status: "read",
    count: c.count,
    listed: c.listed,
    named: namedHolders(c.rows).slice(0, 8),
    spread: spreadCheck(c),
    checks: crowdChecks(c, { vouched: vouched || c.vouched, busy }),
  };
}

/** The creator wallet: what else it launched, and what it did with this token. Asked for. */
async function getCreator(mint) {
  if (!isSolanaAddress(mint)) throw new Error("that is not a Solana mint");
  const ctx = (await readContext([mint]).catch(() => ({})))[mint] || null;
  if (!ctx?.dev) return { record: null, checks: [] };
  const [record, trades] = await Promise.all([readCreator(ctx.dev), readTrades(mint, ctx.dev)]);
  const vouched = ctx.verified === true;
  return {
    record,
    checks: [
      ...creatorChecks(record, { vouched, mint }),
      creatorTradeCheck(trades?.length ? stakeOf(trades) : null, { vouched }),
    ].filter(Boolean),
  };
}

/**
 * The account that wrote a post, against its own wallet.
 *
 * Automatic, because it is the one line here a reader cannot get by clicking anything else:
 * the post is by @someone, the index files a wallet under @someone, and that wallet's trades
 * in this token have times on them. Null - which draws nothing - whenever any link in that
 * chain is missing. It never guesses a wallet.
 */
const stakeCache = new Map();

async function getStake({ handle, mint, postedAt = null }) {
  const h = String(handle || "").toLowerCase();
  if (!h || !isSolanaAddress(mint)) return null;
  const key = `${h}:${mint}:${postedAt ?? ""}`;
  const hit = stakeCache.get(key);
  if (hit && Date.now() - hit.at < CROWD_TTL) return hit.data;

  let wallets = await walletsOf(h);
  // The holder list is read either way: it may be what names this account for the first
  // time, and it says what the wallet holds now.
  const crowd = await getCrowd(mint);
  if (!wallets.length) wallets = await walletsOf(h);
  let data = null;
  if (wallets.length) {
    const held = new Map(crowd.status === "read" ? crowd.rows.map((r) => [r.address, r.pct]) : []);
    // wallets seen holding this token first; two reads at most
    const order = [...wallets].sort((a, b) => (held.get(b) || 0) - (held.get(a) || 0)).slice(0, 2);
    for (const wallet of order) {
      const trades = await readTrades(mint, wallet);
      const holdsPct = held.get(wallet) ?? null;
      data = stakeLine({
        handle: h, wallet, holdsPct,
        stake: trades?.length ? stakeOf(trades, postedAt) : null,
        holdsAmount: holdsPct != null && crowd.supply ? holdsPct / 100 * crowd.supply : null,
      });
      if (data) break;
    }
  }
  stakeCache.set(key, { at: Date.now(), data });
  return data;
}

/**
 * Who launched a Solana token, and whether its claimed X account has ever posted it.
 *
 * The Solana half of "who launched it". Asked for, never automatic, and every row says whose
 * count it is. The last row is the one only this extension can write: the token names an X
 * account in its own metadata, and the account graph knows whether that account has actually
 * put this contract in front of the reader.
 */
async function getLaunch(mint, { fresh = false } = {}) {
  if (!isSolanaAddress(mint)) throw new Error("that is not a Solana mint");
  const ctx = (await readContext([mint], { fresh }))[mint] || null;
  if (!ctx) return { context: null, checks: [] };
  const callers = ctx.x?.handle ? (await graph.tokenCallers(mint))?.callers || [] : [];
  const posted = callers.some((c) => c.handle === ctx.x?.handle);
  // The creator's record is the other half of "who launched it": what else that wallet made,
  // and what it did with this one. Asked for, so the two extra reads are paid for by a click.
  const creator = await getCreator(mint).catch(() => ({ checks: [] }));
  return { context: slim(ctx), checks: [...launchChecks(ctx), bindingCheck(ctx.x, posted), ...creator.checks].filter(Boolean) };
}

// Dexscreener puts the *pair* in the URL, not the token - and on some chains those are
// Uniswap v4 pool ids (32 bytes), not addresses. Resolving pair -> baseToken is the worker's
// job because it owns the network and the cache.
//
// `chain` is Dexscreener's own slug, straight from the path. On Solana the id in the URL may
// also be the MINT rather than a pair, and may arrive lowercased - their site folds it. Both
// endpoints accept the folded form and answer with the real casing (verified live
// 2026-10-07), so the address that comes back is always the one to use, never the one in
// the URL.
const PAIR_CHAINS = new Set(["solana", "robinhood"]);

async function resolvePair(pairId, chain = "robinhood") {
  const slug = String(chain || "").toLowerCase();
  if (!PAIR_CHAINS.has(slug)) throw new Error("this chain is not read from a pair page yet");
  const key = `pair:${slug}:${String(pairId).toLowerCase()}`;
  try {
    const got = await chrome.storage.local.get(key);
    if (got[key]) return got[key];
  } catch {}

  let pair = null;
  const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${slug}/${pairId}`);
  if (!res.ok) throw new Error(`dexscreener HTTP ${res.status}`);
  pair = (await res.json())?.pairs?.[0] || null;

  if (!pair && slug === "solana") {
    // not a pair: the URL was carrying the token itself
    const byToken = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${pairId}`);
    const pairs = byToken.ok ? await byToken.json() : [];
    const mine = (p) => String(p?.baseToken?.address || "").toLowerCase() === String(pairId).toLowerCase();
    pair = (Array.isArray(pairs) ? pairs : []).find(mine) || null;
  }
  if (!pair) throw new Error("no such pair on this chain");

  const base = pair.baseToken?.address || null;
  const info = {
    chain: slug,
    // hex folds safely; a Solana mint must keep the casing the API answered with
    baseToken: base && slug !== "solana" ? base.toLowerCase() : base,
    baseSymbol: pair.baseToken?.symbol || null,
    quoteSymbol: pair.quoteToken?.symbol || null,
    dex: pair.dexId || null,
    labels: pair.labels || [],
  };
  chrome.storage.local.set({ [key]: info }).catch(() => {});
  return info;
}

// ---- watchlist: local only, never synced anywhere ----

async function watchList() {
  try {
    const got = await chrome.storage.local.get("watch");
    // Entries written while every address was folded to lowercase are not addresses if they
    // were Solana mints - a real base58 key always carries capitals - so they are left out
    // rather than counted as things being watched that can never be re-checked.
    return (got.watch || []).filter((w) => isAddress(w.address) || /[A-Z]/.test(String(w.address)));
  } catch {
    return [];
  }
}

// Hex folds; base58 does not. A watched Solana mint was being stored lowercased, which is a
// different string from the address - so it could never be found again, the button never
// turned to "unwatch", and the watch tab silently had nothing to re-check.
const watchKey = (address) => (isAddress(address) ? String(address).toLowerCase() : String(address));

async function watchToggle(address) {
  const addr = watchKey(address);
  const list = await watchList();
  const next = list.some((w) => w.address === addr)
    ? list.filter((w) => w.address !== addr)
    : [...list, { address: addr, at: Date.now() }];
  await chrome.storage.local.set({ watch: next });
  return next;
}

/**
 * Fold fresh verdicts into the watchlist and report what moved.
 *
 * This is the whole point of watching something. A list that only ever shows the current
 * verdict makes you remember what it said last time, which nobody does - so the verdict at
 * each sighting is stored and the change is what gets surfaced. Ownership un-renounced, a
 * blacklist switched on after launch, a PASS that quietly became a FAIL: all of it is a
 * comparison against a number we kept, not something the chain will tell you.
 */
async function watchSync(verdicts) {
  const list = await watchList();
  const byAddress = new Map(list.map((w) => [w.address, w]));
  const changes = [];
  const now = Date.now();
  for (const [address, verdict] of Object.entries(verdicts || {})) {
    const w = byAddress.get(address);
    if (!w) continue;
    if (w.verdict && w.verdict !== verdict) changes.push({ address, from: w.verdict, to: verdict, since: w.checkedAt || w.at });
    byAddress.set(address, { ...w, verdict, checkedAt: now });
  }
  await chrome.storage.local.set({ watch: [...byAddress.values()] });
  return changes;
}

// Every handler gets the sender, because a verdict is only half the story - which tab asked
// is what turns a stream of one-off checks into a readable session.
const HANDLERS = {
  // A check asked for by the side panel has no sender.tab - it is an extension page - so the
  // source page is passed explicitly. Without this, anything typed into the panel would be
  // recorded with no idea where it came from.
  verdict: async (m, sender) => {
    const r = await getVerdict(m.address, m.level || "identity", { fresh: m.fresh });
    await ledger.record(sender?.tab?.url ?? m.url, r);
    return r;
  },
  verdicts: async (m, sender) => {
    const out = await getVerdicts(m.addresses);
    // An address with no contract on the chain that was read gets no badge on the page, and
    // gets no row here either: off a timeline it is a wallet or another chain's token, and a
    // row would file it under this chain's name. A pasted address still gets its answer -
    // that goes through `verdict`, singular.
    await ledger.recordMany(sender?.tab?.url ?? m.url, Object.values(out).filter((r) => !r?.absent));
    return out;
  },
  ticker: (m) => resolveTicker(m.ticker),
  tickers: async (m) => {
    // An official ticker costs nothing (the registry is already local). Anything else needs
    // one explorer search, so it is cached hard - a ticker's contract set barely moves, and
    // a timeline full of $PEPE must not spend a search per post.
    const out = {};
    for (const t of [...new Set(m.tickers || [])].slice(0, 12)) {
      const key = `tk:${t.toUpperCase()}`;
      try {
        const got = await chrome.storage.local.get(key);
        if (got[key] && Date.now() - got[key].at < TICKER_TTL) {
          if (got[key].hit) out[t] = got[key].hit;
          continue;
        }
      } catch {}
      const hit = await lookupTicker(t);
      chrome.storage.local.set({ [key]: { at: Date.now(), hit } }).catch(() => {});
      if (hit) out[t] = hit;
    }
    return out;
  },
  // A bare $TICKER, asked of Solana: which mints use that symbol. One index request per
  // ticker the first time, then cached for hours - so they run together, capped, and a
  // ticker that could not be looked up is simply left out.
  symbols: async (m) => {
    const out = {};
    const wanted = [...new Set((m.tickers || []).map((t) => String(t).toUpperCase()))].slice(0, 6);
    await Promise.all(wanted.map(async (t) => {
      const hit = await lookupSymbol(t).catch(() => null);
      if (hit) out[t] = hit;
    }));
    return out;
  },
  pair: (m) => resolvePair(m.pairId, m.chain),
  deployer: (m) => getTrail(m.address),
  exit: (m) => getExitSweep(m.address),
  rank: (m) => rankCandidates(m.addresses),
  blocklist: () => getBlocklist().then((b) => ({ count: b.count, updated: b.updated, source: b.source })),
  registry: () => getRegistry().then((r) => ({ loaded: r.loaded, count: r.count || 0, error: r.error, fetchedAt: r.fetchedAt })),
  budget: async () => ({ blockscout: await remaining("blockscout"), rpc: await remaining("rpc") }),
  "watch:list": () => watchList(),
  "watch:toggle": (m) => watchToggle(m.address),
  "watch:sync": (m) => watchSync(m.verdicts),

  /**
   * Where else this address exists, and what a curated list says about it there.
   *
   * On demand only, never on the feed. It is one request per chain, and a timeline batch
   * that fanned out across five chains per post would spend a minute's budget in a scroll -
   * the same reason the deployer trail and the exit sweep are buttons rather than automatic.
   */
  crosschain: async (m) => {
    const found = await whereItLives(m.address, { fresh: m.fresh });
    const list = await getList();
    const chains = found.chains.map((row) =>
      row.present === true
        ? { ...row, list: listCheck(list, { chainId: row.id, address: found.address, symbol: row.symbol }) }
        : row,
    );
    return { ...found, chains, listLoaded: Boolean(list.loaded) };
  },

  // Solana. A separate provider, not a chain row - see lib/solana.js.
  mint: async (m, sender) => {
    const r = await resolveMint(m.address, { fresh: m.fresh });
    await ledger.record(sender?.tab?.url ?? m.url, r);
    return r;
  },
  mints: async (m, sender) => {
    const out = await resolveMints(m.candidates, { fresh: m.fresh, limit: m.limit === "watch" ? 12 : 4 });
    await ledger.recordMany(sender?.tab?.url ?? m.url, out);
    return out;
  },
  launch: (m) => getLaunch(m.address, { fresh: m.fresh }),
  // The two expensive Solana reads, each behind a click. Holders come from the chain, through
  // the one keyless endpoint that will list them; the rest is an index's deeper record.
  holders: (m) => readHolders(m.address, { vouched: Boolean(m.vouched) }),
  deep: async (m) => {
    const deep = await readDeep(m.address);
    return { deep, checks: deepChecks(deep) };
  },
  /**
   * A finding as a picture. The page sends back the result it was given and the sentence it
   * showed; nothing is read again and nothing new is claimed. Drawn here because this is the
   * one place with a canvas, the extension's own font and no page CSP in the way.
   */
  card: async (m) => {
    const model = m.kind === "stake"
      ? stakeCard(m.stake, { symbol: m.symbol, mint: m.mint, post: m.post })
      : tokenCard(m.result, { lead: m.lead, label: m.label, post: m.post });
    if (!model) throw new Error("nothing to put on a receipt");
    return { image: await renderCard(model), caption: cardCaption(model), name: `edgerun-${(m.symbol || m.result?.symbol || "receipt").replace(/[^A-Za-z0-9]/g, "") || "receipt"}.png` };
  },
  crowd: (m) => getCrowdChecks(m.address, { fresh: m.fresh, vouched: Boolean(m.vouched) }),
  creator: (m) => getCreator(m.address),
  stake: (m) => getStake({ handle: m.handle, mint: m.mint, postedAt: Number.isFinite(m.postedAt) ? m.postedAt : null }),

  chains: () => ALL_CHAINS.map(({ key, id, name, authority, explorer }) => ({ key, id, name, authority, explorer: Boolean(explorer) })),

  // ---- the account graph: who put that contract in front of you ----
  //
  // Written by the X surface, read by the panel. It lives in the worker for the same reason
  // the ledger does: a content script on x.com must not be able to read back the record of
  // every account you have ever scrolled past.
  "graph:record": (m) => graph.recordSightings(m.sightings),
  "graph:caller": (m) => graph.callerRecord(m.handle),
  "graph:callers": (m) => graph.callerRecords(m.handles),
  "graph:token": (m) => graph.tokenCallers(m.address),
  "graph:tokens": (m) => graph.tokenCallersMany(m.addresses),
  "graph:top": (m) => graph.topCallers(m.limit),
  // What the price did after each of an account's calls. Asked for, never automatic: every
  // call priced costs a request against the tightest rate limit in the product.
  "graph:outcomes": (m) => graph.priceCalls(m.handle),
  "graph:stats": () => graph.graphStats(),
  "graph:pause": (m) => graph.setPaused(m.paused),
  // "forget everyone" means everyone: the account records and the wallets filed under them
  "graph:wipe": async () => { await forgetNamed(); return graph.wipeGraph(); },

  // ---- the sidebar ----
  "ledger:get": () => ledger.read(),
  "ledger:clear": () => ledger.clear().then(() => ({ cleared: true })),

  /**
   * Open the side panel beside the tab that asked.
   *
   * chrome.sidePanel.open() needs a user gesture, and the gesture here happened in a content
   * script (a click on the badge). It survives the hop through sendMessage and does NOT
   * survive an await: with one storage write in front of it Chrome answered every click with
   * "may only be called in response to a user gesture" (measured 2026-10-07), so the badge
   * fell back to its in-page window every time. open() is therefore the first thing called,
   * and everything else waits behind it. It is still allowed to fail - the badge keeps its
   * in-page window for a browser that has no side panel.
   */
  "panel:open": async (m, sender) => {
    const tabId = sender?.tab?.id ?? m.tabId;
    if (!tabId) throw new Error("no tab to open beside");
    const opening = chrome.sidePanel?.open
      ? chrome.sidePanel.open({ tabId })
      : Promise.reject(new Error("this browser has no side panel"));
    // A line about a ticker points at a mint nobody has scanned yet. It is read whichever
    // window ends up showing it: the reader asked about it, so it belongs in the session.
    if (m.address && !isAddress(m.address) && isSolanaAddress(m.address)) {
      resolveMint(m.address).then((r) => ledger.record(sender?.tab?.url ?? m.url, r)).catch(() => {});
    }
    await Promise.all([opening, m.address ? ledger.setFocus(tabId, m.address) : null]);
    return { opened: true };
  },

  /**
   * What the trades say about a token, as corroboration rather than as a price readout.
   *
   * Deliberately not folded into `scan`: a verdict must not become slower, or start failing,
   * because a market API is having a bad day. It is asked for separately, when a reader wants
   * it, and a null answer costs nothing.
   */
  "market:get": (m) => readMarket(m.address, { chain: m.chain }),

  /**
   * Price history, from a different source than the tape.
   *
   * GeckoTerminal's free tier is tight - enumerating their network list while building this
   * earned a 429 - so this is only ever called when a reader asks for a chart, and the pool
   * address found by the market read is passed through to save the lookup call.
   */
  "candles:get": (m) => readCandles(m.address, { chain: m.chain, pool: m.pool, key: m.key }),

  /**
   * Check somebody else's accusation.
   *
   * Takes whatever was pasted - the format's own copy output, a chat quote, a fenced block -
   * finds the claims in it, and runs the evidence here against the public endpoints the claim
   * names. Nothing about the reporter is consulted, which is the entire point: the reader
   * ends up believing the chain, or not, rather than believing a stranger.
   *
   * Invalid claims come back with their reasons rather than being dropped. "This is not
   * checkable and here is why" is a useful answer about an accusation someone is spreading.
   */
  "claim:check": async (m) => {
    const claims = parseClaims(m.text);
    if (!claims.length) return { claims: [] };
    const out = [];
    for (const claim of claims.slice(0, 5)) {
      const valid = validateClaim(claim);
      out.push({
        claim,
        valid: valid.ok,
        errors: valid.errors || [],
        result: valid.ok ? await runClaim(claim) : null,
      });
    }
    return { claims: out };
  },

  /** The account strip under a post was clicked: open the panel on that account's record. */
  "panel:caller": async (m, sender) => {
    const tabId = sender?.tab?.id ?? m.tabId;
    if (!tabId) throw new Error("no tab to open beside");
    // open() first, for the same reason as above: the click does not survive an await
    const opening = chrome.sidePanel?.open
      ? chrome.sidePanel.open({ tabId })
      : Promise.reject(new Error("this browser has no side panel"));
    await Promise.all([opening, ledger.setCallerFocus(tabId, m.handle)]);
    return { opened: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) return false;
  Promise.resolve(handler(msg, sender))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true; // keep the channel open for the async reply
});

// A closed tab's reading session is over. Session storage would clear on browser exit
// anyway, but a long-lived window should not accumulate ledgers for tabs that are gone.
chrome.tabs.onRemoved.addListener((tabId) => ledger.drop(tabId));

// The toolbar icon opens the side panel directly. There is no popup any more: two surfaces
// meant every feature had to be decided twice, and the sidebar is the one with room.
const useSidePanel = () =>
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

// Keep the registry warm so no badge ever waits on it.
chrome.runtime.onInstalled.addListener(() => {
  useSidePanel();
  chrome.alarms.create("registry", { periodInMinutes: 55 });
  chrome.alarms.create("upkeep", { periodInMinutes: 180 });
  getRegistry({ force: true }).catch(() => {});
  getBlocklist({ force: true }).catch(() => {});
  // The curated list is over a megabyte and the first mint scan used to wait for it: four
  // and a half seconds, measured, before the first badge on a fresh install.
  getList().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  useSidePanel();
  getRegistry().catch(() => {});
  getBlocklist().catch(() => {});
  getList().catch(() => {});
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "registry") {
    getRegistry({ force: true }).catch(() => {});
    getBlocklist({ force: true }).catch(() => {});
  }
  if (a.name === "upkeep") {
    pruneMemory().catch(() => {});
    graph.pruneGraph().catch(() => {});
  }
});
