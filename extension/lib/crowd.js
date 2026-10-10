// The crowd around a Solana token: who paid for the wallets that hold it, which of them an
// index files under a name, and what one wallet did before and after a post.
//
// A pump.fun mint is nearly always clean. Supply is fixed, nothing can freeze, the metadata is
// locked - the mint scan passes and has told the reader almost nothing, because the weapon was
// never in the mint. It is in who holds it and who is telling you to buy it. This file is the
// part of the product that looks there.
//
// ---- the source, and what it is trusted with ----
//
// Jupiter's token pages are fed by `datapi.jup.ag`. Three of its endpoints answer a browser
// extension keyless (measured 2026-10-10, twelve requests back to back, none refused):
//
//   /v1/holders/<mint>                    the hundred largest holders, and for each: the address
//                                         that first funded it and when, the index's own tags
//                                         (pool, exchange, bundler, sniper, insider), and the
//                                         accounts it files that wallet under
//   /v1/txs/<mint>?traderAddress=<wallet>  every trade one wallet made in one token, timed
//   /v1/dev/stats/<wallet>                 how many tokens a creator launched, how many
//                                         graduated, and the best three
//
// All three are UNDOCUMENTED. That decides how they are used, the same way it did for the
// deep read in jupiter.js: never on the path to a verdict, always worded as the index's
// record, and written to disappear quietly on the day the endpoint does.
//
// Checked against itself before being believed: for a wallet the index names, the trades it
// lists (bought 18,870,382, sold 14,705,362) leave exactly the balance its holder list shows
// (4,165,020). The two endpoints agree to the token.
//
// ---- what can accuse ----
//
// Two findings here can turn amber, and both are narrow on purpose.
//
// "Funded together" needs three wallets, first funded by ONE address inside ONE hour, holding
// a twentieth of supply between them - and a funder that is not an exchange. That last clause
// is the whole difficulty: four holders of a hyped token who all withdrew from Binance share a
// funder and share nothing else. A withdrawal wallet is told apart by its traffic, read from
// the chain, and if that read fails the finding is stated without colour.
//
// "Sold after posting" needs a wallet the index files under the SAME X handle that wrote the
// post, and trades that say so. The attribution is the index's and every sentence carries it.

import { spend } from "./budget.js";
import { spanWords } from "./jupiter.js";

const API = "https://datapi.jup.ag/v1";
const READ_RPC = "https://solana-rpc.publicnode.com";

const check = (id, label, status, detail) => ({ id, label, status, detail });
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);
const when = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const pct = (n) => `${n >= 10 ? n.toFixed(1) : n.toFixed(2)}%`;
const short = (a) => (a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || "");
const people = (n) => Number(n).toLocaleString("en-US");
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/**
 * The holder list, reduced to rows. Pure.
 *
 * `supply` is the total supply in whole tokens - the same unit the list's amounts are in.
 * Without it nothing here can be a percentage, so the answer is null rather than a guess.
 *
 * A row's `kind` separates what holds from who holds: a pool, a bonding curve, an exchange's
 * wallet and a market maker are all tagged by the index, and none of them is a person's
 * position. Everything untagged is treated as a wallet.
 */
export function shapeCrowd(body, supply) {
  const total = num(supply);
  const list = Array.isArray(body?.holders) ? body.holders : null;
  if (!list || !(total > 0)) return null;
  const rows = list.map((h) => {
    const tag = (h.tags || [])[0] || null;
    const info = h.addressInfo || {};
    const x = h.usernames?.twitter?.username;
    return {
      address: String(h.address || ""),
      pct: (num(h.amount) || 0) / total * 100,
      kind: !tag ? "wallet" : tag.id === "CEX" ? "exchange" : tag.id === "MM" ? "maker" : "pool",
      name: tag?.name || null,
      funder: info.fundingAddress || null,
      fundedAt: when(info.fundingBlockTime),
      marks: (h.holderTags || []).map(String),
      classes: (h.walletCategories || []).map(String),
      // only the index's X attribution is a claim about an X account. The same wallet's
      // name on a launchpad or a trading app is a different namespace and is not used.
      handle: x && HANDLE.test(x) ? String(x).toLowerCase() : null,
    };
  }).filter((r) => r.address && r.pct > 0);
  return { count: num(body.count), listed: rows.length, rows };
}

const FUND_WINDOW_MS = 60 * 60 * 1000;
const FUND_MIN_WALLETS = 3;
const FUND_MIN_PCT = 5;
const FUND_TOP = 50;

/**
 * Wallets among the largest that one address paid for, inside one hour. Pure.
 *
 * Sorted by funding time and swept with a window, so a funder that also paid for an unrelated
 * wallet two years ago does not stretch the group: only the tightest hour counts. Returns the
 * groups that reach the floor, largest share first.
 */
export function funderGroups(rows, { top = FUND_TOP, windowMs = FUND_WINDOW_MS, min = FUND_MIN_WALLETS } = {}) {
  const wallets = (rows || []).filter((r) => r.kind === "wallet").slice(0, top);
  const by = new Map();
  for (const w of wallets) {
    if (!w.funder || w.fundedAt == null || w.funder === w.address) continue;
    if (!by.has(w.funder)) by.set(w.funder, []);
    by.get(w.funder).push(w);
  }
  const out = [];
  for (const [funder, list] of by) {
    if (list.length < min) continue;
    list.sort((a, b) => a.fundedAt - b.fundedAt);
    let best = null;
    for (let i = 0, j = 0; i < list.length; i++) {
      while (list[i].fundedAt - list[j].fundedAt > windowMs) j++;
      const size = i - j + 1;
      if (!best || size > best.size) best = { size, from: j, to: i };
    }
    if (!best || best.size < min) continue;
    const members = list.slice(best.from, best.to + 1);
    out.push({
      funder,
      wallets: members.map((m) => m.address),
      pct: members.reduce((s, m) => s + m.pct, 0),
      spanMs: members.at(-1).fundedAt - members[0].fundedAt,
      at: members[0].fundedAt,
    });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

/** Accounts the index files a holding wallet under. One row per handle, largest first. Pure. */
export function namedHolders(rows) {
  const by = new Map();
  for (const r of rows || []) {
    if (!r.handle || r.kind !== "wallet") continue;
    const prev = by.get(r.handle);
    if (prev) { prev.pct += r.pct; prev.wallets.push(r.address); }
    else by.set(r.handle, { handle: r.handle, pct: r.pct, wallets: [r.address] });
  }
  return [...by.values()].sort((a, b) => b.pct - a.pct);
}

/**
 * What the holder list is allowed to say.
 *
 * `busy` maps a funder address to true (a high-traffic address: an exchange's withdrawal
 * wallet, a bridge), false (quiet) or is missing the key (could not be read). Only a funder
 * read as quiet can make the row amber. `vouched` turns every row into context, as it does
 * everywhere else: the ten largest holders of a stablecoin are exchanges and that is fine.
 */
export function crowdChecks(c, { vouched = false, busy = {} } = {}) {
  if (!c?.rows?.length) return [];
  const out = [];
  const wallets = c.rows.filter((r) => r.kind === "wallet");
  const among = `among the ${Math.min(FUND_TOP, wallets.length)} largest wallets`;

  for (const g of funderGroups(c.rows).slice(0, 2)) {
    const what = `${g.wallets.length} of the largest wallets, holding ${pct(g.pct)} of supply between them, were first funded by one address (${short(g.funder)}) within ${spanWords(Math.max(g.spanMs, 60_000))}`;
    if (busy[g.funder] === true) {
      out.push(check("funders", "one funder", "unresolved",
        `${what}. That address signs over a thousand transactions a day - an exchange's withdrawal wallet, a bridge or a bot - so sharing it means little`));
    } else if (busy[g.funder] === false && !vouched && g.pct >= FUND_MIN_PCT) {
      out.push(check("funders", "funded together", "warn",
        `${what}, and that address is not an exchange. Wallets paid for together are usually one holder - the index's funding record, ${among}`));
    } else {
      out.push(check("funders", "one funder", "unresolved",
        `${what} - the index's funding record, ${among}${busy[g.funder] === false ? "" : ". Whether that address is an exchange could not be read"}`));
    }
  }

  const marked = (mark) => wallets.filter((r) => r.marks.includes(mark));
  const sum = (list) => list.reduce((s, r) => s + r.pct, 0);
  const bundlers = marked("bundler");
  if (bundlers.length) {
    const share = sum(bundlers);
    out.push(check("bundle_holders", "bundle wallets", !vouched && share >= 10 ? "warn" : "unresolved",
      `${bundlers.length} of the ${c.listed} largest holders are wallets the index tags as part of a bundled buy, and they still hold ${pct(share)} of supply`));
  }
  const early = [...new Set([...marked("sniper"), ...marked("insider")])];
  if (early.length) {
    out.push(check("early_holders", "early wallets", "unresolved",
      `${early.length} of the ${c.listed} largest holders are tagged sniper or insider by the index, holding ${pct(sum(early))} of supply - its classification, not something read here`));
  }

  const named = namedHolders(c.rows);
  if (named.length) {
    const list = named.slice(0, 5).map((n) => `@${n.handle} ${pct(n.pct)}`).join(", ");
    out.push(check("named_holders", "accounts holding it", "unresolved",
      `the index files ${named.length === 1 ? "one of these wallets" : `${named.length} of these wallets`} under an X account: ${list}${named.length > 5 ? ` and ${named.length - 5} more` : ""}`));
  }

  const venues = c.rows.filter((r) => r.kind === "exchange" || r.kind === "maker");
  if (venues.length) {
    out.push(check("venues", "exchanges", "unresolved",
      `${venues.slice(0, 4).map((v) => `${v.name} holds ${pct(v.pct)}`).join(", ")} - an exchange's or a market maker's wallet, counted as nobody's position`));
  }
  return out;
}

/**
 * How the supply is spread across the largest wallets, by the index's list.
 *
 * The chain read in holders.js says this better - it sees frozen accounts and reads who
 * controls each owner - but the one endpoint it depends on refuses often. This row is what
 * the panel shows when it has, and it is context only: the split between wallets, pools and
 * exchanges is the index's tagging, so it never turns amber.
 */
export function spreadCheck(c) {
  const wallets = (c?.rows || []).filter((r) => r.kind === "wallet");
  if (!wallets.length) return null;
  const ten = wallets.slice(0, 10).reduce((s, r) => s + r.pct, 0);
  return check("spread", "who holds it", "unresolved",
    `the largest wallet holds ${pct(wallets[0].pct)} of supply and the ten largest ${pct(ten)}, with pools and exchanges set aside - the index's list of the ${c.listed} largest holders, not read from the chain`);
}

/* ---- one wallet against one post ---- */

/** A wallet's trades in one token, oldest first. Pure. */
export function shapeTrades(body) {
  const list = Array.isArray(body?.txs) ? body.txs : [];
  return list
    .map((t) => ({ at: when(t.timestamp), side: t.type === "sell" ? "sell" : t.type === "buy" ? "buy" : null, amount: num(t.amount) || 0, usd: num(t.usdVolume) || 0 }))
    .filter((t) => t.at != null && t.side && t.amount > 0)
    .sort((a, b) => a.at - b.at);
}

/**
 * What a wallet had done by the time a post was written, and what it did afterwards. Pure.
 *
 * `postedAt` may be null (a post with no readable time): the totals are still true, there is
 * just no before and after. Tokens that arrived by transfer are invisible to a list of
 * trades, so "held at the post" is what was bought minus what was sold and never below zero.
 */
export function stakeOf(trades, postedAt = null) {
  const list = trades || [];
  if (!list.length) return null;
  const sum = (side, test) => list.filter((t) => t.side === side && test(t)).reduce((s, t) => s + t.amount, 0);
  const usd = (side) => list.filter((t) => t.side === side).reduce((s, t) => s + t.usd, 0);
  const all = () => true;
  const out = {
    trades: list.length,
    bought: sum("buy", all), sold: sum("sell", all),
    usdIn: usd("buy"), usdOut: usd("sell"),
    firstBuyAt: list.find((t) => t.side === "buy")?.at ?? null,
    lastSellAt: list.filter((t) => t.side === "sell").at(-1)?.at ?? null,
    postedAt: postedAt ?? null,
  };
  if (postedAt == null) return out;
  const before = (t) => t.at <= postedAt;
  const after = (t) => t.at > postedAt;
  const heldAtPost = Math.max(0, sum("buy", before) - sum("sell", before));
  const soldAfter = sum("sell", after);
  const base = heldAtPost + sum("buy", after);
  return {
    ...out,
    heldAtPost,
    // the lead time only means something if the wallet still had the position when the post
    // went out - a buy and a full exit last month is not "bought before this post"
    leadMs: heldAtPost > 0 && out.firstBuyAt != null && out.firstBuyAt <= postedAt ? postedAt - out.firstBuyAt : null,
    soldAfter,
    soldAfterPct: base > 0 ? Math.min(100, soldAfter / base * 100) : 0,
    firstSellAfterMs: (() => { const s = list.find((t) => t.side === "sell" && after(t)); return s ? s.at - postedAt : null; })(),
    boughtAfterMs: heldAtPost === 0 ? (() => { const b = list.find((t) => t.side === "buy" && after(t)); return b ? b.at - postedAt : null; })() : null,
  };
}

const SOLD_LOUD_PCT = 50;
const lead = (ms) => {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} seconds`;
  if (ms < 3_600_000) { const m = Math.floor(ms / 60_000), s = Math.round((ms % 60_000) / 1000); return s && m < 10 ? `${m}m ${s}s` : `${m} minutes`; }
  return spanWords(ms);
};

/**
 * The line under a post, when the account that wrote it is one the index has a wallet for.
 *
 * Returns `{ handle, wallet, tone, lead, checks }` or null when there is nothing to say - no
 * trades by that wallet in that token and no holding. `tone` is "warn" in exactly one case:
 * the wallet held the token when the post went out and has sold most of that since.
 */
export function stakeLine({ handle, wallet, stake, holdsPct = null, holdsAmount = null }) {
  if (!handle || !wallet) return null;
  if (!stake && !(holdsPct > 0)) return null;
  const whose = `the wallet an index files under @${handle} (${short(wallet)})`;
  const checks = [];
  const said = [];
  let tone = "flat";

  if (stake?.leadMs != null) {
    said.push(`bought ${lead(stake.leadMs)} before this post`);
    checks.push(check("stake_before", "bought before", "unresolved",
      `${whose} first bought this token ${lead(stake.leadMs)} before the post was written, and was holding it when it was`));
  } else if (stake?.boughtAfterMs != null) {
    said.push(`bought ${lead(stake.boughtAfterMs)} after posting`);
    checks.push(check("stake_before", "bought after", "unresolved", `${whose} first bought this token ${lead(stake.boughtAfterMs)} after the post`));
  }

  if (stake?.postedAt != null && stake.heldAtPost > 0 && stake.soldAfter > 0) {
    const share = stake.soldAfterPct;
    const loud = share >= SOLD_LOUD_PCT;
    if (loud) tone = "warn";
    const how = share >= 99.5 ? "sold all of it" : `sold ${Math.round(share)}% of it`;
    said.push(`${how} since`);
    checks.push(check("stake_after", "sold after posting", loud ? "warn" : "unresolved",
      `${whose} has ${how} since the post${stake.firstSellAfterMs != null ? `, the first sale ${lead(stake.firstSellAfterMs)} after it` : ""}`));
  } else if (stake?.postedAt != null && stake.heldAtPost > 0) {
    said.push("none sold since");
    checks.push(check("stake_after", "sold after posting", "ok", `${whose} has not sold any of it since the post`));
  }

  if (holdsPct > 0) {
    // What the trades leave and what the wallet holds are two different numbers when tokens
    // arrived by transfer - an allocation, or a second wallet's bag. Said when most of the
    // holding is unexplained by purchases, because "bought $12k, holds nine percent of
    // supply" is the more interesting half of that sentence.
    const net = stake ? Math.max(0, stake.bought - stake.sold) : 0;
    const sent = holdsAmount > 0 && holdsAmount - net > holdsAmount * 0.5;
    said.push(`holds ${pct(holdsPct)} now${sent ? ", most of it sent to the wallet rather than bought" : ""}`);
    checks.push(check("stake_now", "holds now", "unresolved", `${whose} is among the largest holders, with ${pct(holdsPct)} of supply`));
    if (sent) {
      checks.push(check("stake_sent", "sent, not bought", "unresolved",
        `its recorded trades account for ${stake ? `about ${Math.round(net / holdsAmount * 100)}%` : "none"} of what it holds. The rest reached the wallet by transfer - from another wallet, not from the market`));
    }
  } else if (stake && stake.bought > 0 && stake.sold >= stake.bought * 0.995) {
    if (!said.some((s) => s.startsWith("sold all"))) said.push("holds none of it now");
  }
  if (stake && !said.length) {
    said.push(`${stake.trades} trade${stake.trades === 1 ? "" : "s"} in this token`);
  }
  if (stake) {
    checks.push(check("stake_money", "in and out", "unresolved",
      `bought $${people(Math.round(stake.usdIn))} of it and sold $${people(Math.round(stake.usdOut))}, across ${stake.trades} trade${stake.trades === 1 ? "" : "s"} - the index's record of that wallet`));
  }
  return {
    handle, wallet, tone,
    lead: `@${handle}'s listed wallet ${said.join(", ")}.`,
    checks,
  };
}

/* ---- the book: which wallet the index files under which account ----
 *
 * The index has no "wallets of @handle" question to ask - fourteen guesses at one were all
 * 404 (2026-10-10). The only place an attribution appears is beside a wallet in a holder
 * list. So every list that is read is also read for names, and the pairs are kept: an account
 * that sold everything last week is in nobody's holder list today, and the book is the only
 * reason its wallet can still be found when it posts the next one.
 *
 * It is local, like everything else kept about accounts, and "forget everyone" empties it.
 */

const BOOK_KEY = "book:x";
const BOOK_MAX = 4000;
const WALLETS_PER_HANDLE = 4;

let bookQueue = Promise.resolve();
const bookSerial = (job) => { const run = bookQueue.then(job, job); bookQueue = run.catch(() => {}); return run; };

async function loadBook() {
  try { return (await chrome.storage.local.get(BOOK_KEY))[BOOK_KEY] || {}; } catch { return {}; }
}

/** Keep every (handle, wallet) pair a holder list carried. */
export function noteNamed(rows, now = Date.now()) {
  const pairs = (rows || []).filter((r) => r.handle && r.kind === "wallet").map((r) => [r.handle, r.address]);
  if (!pairs.length) return Promise.resolve(0);
  return bookSerial(async () => {
    const book = await loadBook();
    let added = 0;
    for (const [handle, wallet] of pairs) {
      const prev = book[handle]?.w || [];
      if (!prev.includes(wallet)) added++;
      book[handle] = { w: [wallet, ...prev.filter((w) => w !== wallet)].slice(0, WALLETS_PER_HANDLE), at: now };
    }
    const keys = Object.keys(book);
    if (keys.length > BOOK_MAX) {
      for (const k of keys.sort((a, b) => book[a].at - book[b].at).slice(0, keys.length - BOOK_MAX)) delete book[k];
    }
    try { await chrome.storage.local.set({ [BOOK_KEY]: book }); } catch { /* a convenience, never a dependency */ }
    return added;
  });
}

export async function walletsOf(handle) {
  const h = String(handle || "").toLowerCase();
  return h ? (await loadBook())[h]?.w || [] : [];
}

export async function bookSize() {
  return Object.keys(await loadBook()).length;
}

export function forgetNamed() {
  return bookSerial(async () => { try { await chrome.storage.local.remove(BOOK_KEY); } catch { /* nothing to forget */ } });
}

/* ---- the creator's record ---- */

const SERVICE_FLOOR = 1000;

/** Reduce the creator answer to what will be repeated. Null when the index knows nothing. */
export function shapeCreator(body, now = Date.now()) {
  const made = num(body?.numCreated);
  if (!made) return null;
  return {
    made,
    graduated: num(body.numMigrated) || 0,
    week: num(body.numCreatedInPast7Days) || 0,
    best: (Array.isArray(body.topTokens) ? body.topTokens : []).slice(0, 3).map((t) => {
      const born = when(t.firstPool?.createdAt) ?? when(t.createdAt);
      const day = (t.stats24h?.buyVolume || 0) + (t.stats24h?.sellVolume || 0);
      const liq = num(t.liquidity) || 0;
      return {
        mint: String(t.id || ""),
        symbol: t.symbol ? String(t.symbol).slice(0, 12) : null,
        mcap: num(t.mcap) || 0,
        ageMs: born != null ? Math.max(0, now - born) : null,
        graduated: Boolean(t.graduatedAt),
        // "dead" is a description of the market, not of anybody: under a thousand dollars of
        // liquidity, or a pool nobody traded a hundred dollars through all day
        state: liq < 1000 || day < 100 ? "dead" : "trading",
      };
    }).filter((t) => t.mint),
  };
}

const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`);

/**
 * The creator's history, as rows.
 *
 * A "creator" with thousands of launches is a launch service's signing address or a deploy
 * bot, not a person, and saying "this deployer launched 170,332 tokens" about one of them
 * would be an accusation against a piece of infrastructure. Past the floor the row says what
 * the address is and stops.
 */
export function creatorChecks(c, { vouched = false, mint = null } = {}) {
  if (!c) return [];
  if (c.made >= SERVICE_FLOOR) {
    return [check("creator_record", "creator", "unresolved",
      `the creating address has ${people(c.made)} launches to its name - that is a launch service or a bot signing for its users, not one person's record`)];
  }
  const out = [];
  const rate = c.made ? Math.round(c.graduated / c.made * 100) : 0;
  const serial = !vouched && c.made >= 10 && rate < 10;
  out.push(check("creator_record", serial ? "creator, serial launcher" : "creator", serial ? "warn" : "unresolved",
    c.made === 1
      ? "this is the only token the index attributes to its creator wallet"
      : `the index attributes ${people(c.made)} tokens to this creator wallet; ${c.graduated ? `${people(c.graduated)} graduated from their launchpad (${rate}%)` : "none graduated from its launchpad"}${c.week ? `, and ${people(c.week)} were launched in the last seven days` : ""}`));
  const others = c.best.filter((t) => t.mint !== mint);
  if (others.length) {
    const dead = others.filter((t) => t.state === "dead").length;
    out.push(check("creator_best", "its best so far", "unresolved",
      `${others.map((t) => `$${t.symbol || short(t.mint)} ${money(t.mcap)}${t.state === "dead" ? ", no longer trading" : ""}`).join("; ")} - the creator's largest other tokens by the index's count${dead === others.length ? ". None of them is still trading" : ""}`));
  }
  return out;
}

/** What the creator wallet did in this token. Null when the index lists no trade by it. */
export function creatorTradeCheck(stake, { vouched = false } = {}) {
  if (!stake || !(stake.bought > 0)) return null;
  const share = Math.min(100, stake.sold / stake.bought * 100);
  const out = share >= 99.5 ? "has sold all of it" : share >= 1 ? `has sold ${Math.round(share)}% of it` : "has sold none of it";
  const last = stake.lastSellAt != null ? `, the last sale ${spanWords(Math.max(0, Date.now() - stake.lastSellAt))} ago` : "";
  return check("creator_trades", "creator's own trades", !vouched && share >= 90 ? "warn" : "unresolved",
    `the creator wallet bought $${people(Math.round(stake.usdIn))} of its own token and ${out}${last} - the index's record of that wallet's trades`);
}

/* ---- the reads ---- */

async function get(path, fetchImpl) {
  const res = await fetchImpl(`${API}${path}`, { headers: { Accept: "application/json" } });
  if (res?.status === 429) throw new Error("rate limited");
  if (!res?.ok) throw new Error("unreachable");
  return res.json();
}

/** `{ status: "read", ...crowd }`, or "limited" / "none" / "unreachable". Never throws. */
export async function readCrowd(mint, supply, { fetchImpl = fetch } = {}) {
  if (!(await spend("datapi"))) return { status: "limited" };
  try {
    const c = shapeCrowd(await get(`/holders/${encodeURIComponent(mint)}`, fetchImpl), supply);
    return c?.rows.length ? { status: "read", ...c } : { status: "none" };
  } catch (err) {
    return { status: /rate limited/.test(String(err?.message)) ? "limited" : "unreachable" };
  }
}

const TRADE_PAGES = 4;

/** One wallet's trades in one token, oldest first. Null when they could not be read. */
export async function readTrades(mint, wallet, { fetchImpl = fetch } = {}) {
  const all = [];
  let cursor = null;
  try {
    for (let page = 0; page < TRADE_PAGES; page++) {
      if (!(await spend("datapi"))) return all.length ? shapeTrades({ txs: all }) : null;
      const body = await get(`/txs/${encodeURIComponent(mint)}?traderAddress=${encodeURIComponent(wallet)}${cursor ? `&next=${encodeURIComponent(cursor)}` : ""}`, fetchImpl);
      const txs = Array.isArray(body?.txs) ? body.txs : [];
      // the filter is the whole point of this request: if the index ever stops honouring it,
      // the answer would be the token's latest trades by strangers, charged to this wallet
      if (txs.some((t) => t.traderAddress !== wallet)) return null;
      all.push(...txs);
      if (!body?.next || !txs.length) break;
      cursor = body.next;
    }
    return shapeTrades({ txs: all });
  } catch {
    return all.length ? shapeTrades({ txs: all }) : null;
  }
}

export async function readCreator(wallet, { fetchImpl = fetch } = {}) {
  if (!wallet || !(await spend("datapi"))) return null;
  try {
    return shapeCreator(await get(`/dev/stats/${encodeURIComponent(wallet)}`, fetchImpl));
  } catch {
    return null;
  }
}

const BUSY_SIGNATURES = 1000;
const BUSY_SPAN_S = 24 * 3600;

/**
 * Is this address a high-traffic one? Read from the chain: its thousand newest signatures.
 *
 * An exchange's withdrawal wallet signs a thousand transactions in a few hours, every day
 * (Binance's: fifty in four minutes, measured 2026-10-10). A wallet somebody used once to
 * spread money across ten others has a few dozen signatures in total. The first test of this
 * looked at fifty and was wrong in the direction that matters: a distributor paying for fifty
 * wallets right now looks exactly like an exchange for an hour, and would have been excused
 * as one. A thousand in a day is a service; anything less is not.
 *
 * Returns true, false, or null when the read failed - and null must never be read as "quiet".
 */
export async function isBusy(address, { fetchImpl = fetch } = {}) {
  if (!(await spend("solana"))) return null;
  try {
    const res = await fetchImpl(READ_RPC, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [address, { limit: BUSY_SIGNATURES }] }),
    });
    if (!res?.ok) return null;
    const list = (await res.json())?.result;
    if (!Array.isArray(list)) return null;
    if (list.length < BUSY_SIGNATURES) return false;
    const newest = num(list[0]?.blockTime), oldest = num(list.at(-1)?.blockTime);
    if (newest == null || oldest == null) return null;
    return newest - oldest < BUSY_SPAN_S;
  } catch {
    return null;
  }
}
