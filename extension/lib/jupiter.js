// What an index knows about a Solana mint that the mint account does not say.
//
// lib/solana.js reads the chain and stops there, and for the verdict that is the right place
// to stop. But a mint account does not record when the token launched, where, how many
// wallets hold it, which wallet created it, or which X account it claims as its own - and on
// Solana those are most of what a reader actually wants to know about a token that is forty
// minutes old.
//
// Jupiter's token search answers all of that for a comma-separated list of mints in one
// keyless request. Measured live 2026-10-07 against 68 freshly listed mints: every one came
// back, 67 with a creator wallet, 67 with a launch time, all 68 with a holder count, 15 with
// an X link.
//
// ---- the rule for everything in this file ----
//
// It is CONTEXT, and it is ATTRIBUTED. None of it enters `scanMint`'s verdict except two
// things, both of which are identity and both list-grade: whether Jupiter lists the mint as
// verified (a vouch, the same strength as the curated list) and which verified mints already
// use its symbol. `organicScore`, `audit.isSus` and the rest of Jupiter's own conclusions are
// not read at all - this extension reports what it can show, not what somebody else decided.
//
// The creator wallet is the field to be most careful with. For the same fresh mint, Jupiter
// and a second index named two DIFFERENT creators on 2026-10-07 - the token had been deployed
// through a third-party launch tool, and they disagreed about whose signature counts. So a
// creator is always worded as "Jupiter attributes this mint to", never as "the dev is".
//
// Two hosts, in order, because the keyless one has been announced for retirement and
// postponed with no date (their changelog, 2025-11 and 2026-02). The same reason the
// blocklist has two sources: one endpoint somebody else can switch off is a check that
// silently stops contributing. A failure here is always "the source did not answer" and is
// never evidence about a token.

import { spend } from "./budget.js";

const HOSTS = ["https://lite-api.jup.ag", "https://api.jup.ag"];
const SEARCH = "/tokens/v2/search?query=";
const TTL_MS = 5 * 60 * 1000;
const SYMBOL_TTL_MS = 6 * 60 * 60 * 1000; // which verified mint holds a symbol barely moves

const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const when = (v) => {
  const t = Date.parse(v || "");
  return Number.isFinite(t) ? t : null;
};
const norm = (s) => String(s || "").toUpperCase().replace(/^\$/, "").trim();

// Paths on x.com that sit where a handle would and are not accounts.
const NOT_HANDLES = new Set(["i", "home", "search", "hashtag", "intent", "share", "explore", "settings", "messages", "notifications", "compose"]);

/**
 * What a token's "twitter" field actually points at.
 *
 * The field is free text written by whoever created the token, and three quite different
 * things get pasted into it. Telling them apart is the whole value:
 *
 *   account   - x.com/handle. A claim about an account, which the account may know nothing of.
 *   post      - x.com/handle/status/123. ONE post. Often somebody else's, chosen because it
 *               went viral, so the token appears to have a famous account behind it.
 *   community - x.com/i/communities/123. Anyone can open one in a minute.
 *
 * Returns null for anything that is not an x.com / twitter.com link at all.
 */
export function parseXLink(url) {
  let u;
  try {
    u = new URL(String(url || "").trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|mobile)\./, "");
  if (host !== "x.com" && host !== "twitter.com") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (!parts.length) return null;

  if (parts[0] === "i" && parts[1] === "communities" && /^\d+$/.test(parts[2] || "")) {
    return { kind: "community", handle: null, id: parts[2] };
  }
  const handle = parts[0].replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle) || NOT_HANDLES.has(handle.toLowerCase())) return { kind: "other", handle: null, id: null };
  if (parts[1] === "status" && /^\d+$/.test(parts[2] || "")) return { kind: "post", handle: handle.toLowerCase(), id: parts[2] };
  if (parts.length === 1) return { kind: "account", handle: handle.toLowerCase(), id: null };
  return { kind: "other", handle: null, id: null };
}

/** One Jupiter token, reduced to the facts this extension is willing to repeat. */
export function shape(t, now = Date.now()) {
  if (!t?.id) return null;
  return {
    mint: String(t.id),
    symbol: t.symbol || null,
    name: t.name || null,
    verified: t.isVerified === true,
    x: parseXLink(t.twitter),
    dev: t.dev || null,
    launchpad: t.launchpad || null,
    createdAt: when(t.firstPool?.createdAt) ?? when(t.createdAt),
    graduatedAt: when(t.graduatedAt),
    holders: num(t.holderCount),
    top10Pct: num(t.audit?.topHoldersPercentage),
    devPct: num(t.audit?.devBalancePercentage),
    devMints: num(t.audit?.devMints),
    devMigrations: num(t.audit?.devMigrations),
    liquidityUsd: num(t.liquidity),
    supply: num(t.totalSupply),
    priceUsd: num(t.usdPrice),
    mcapUsd: num(t.mcap),
    at: now,
  };
}

async function search(query, fetchImpl) {
  for (const host of HOSTS) {
    try {
      const res = await fetchImpl(`${host}${SEARCH}${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } });
      if (!res?.ok) continue; // 401 once a key is required, 429 when limited: try the other host
      const body = await res.json();
      if (Array.isArray(body)) return body;
    } catch {
      /* unreachable: try the next host */
    }
  }
  return null;
}

const mem = new Map(); // mint -> context

/**
 * Context for a batch of mints, in one request.
 *
 * Returns `{ [mint]: context }` holding only the mints the index knows. Never throws and
 * never blocks a verdict: an empty object is a complete answer, and it means "nothing extra
 * is known", which is where every mint stood before this file existed.
 */
export async function readContext(mints, { fetchImpl = fetch, now = Date.now(), fresh = false } = {}) {
  const wanted = [...new Set((mints || []).filter(Boolean))];
  const out = {};
  const missing = [];
  for (const mint of wanted) {
    const hit = mem.get(mint);
    if (!fresh && hit && now - hit.at < TTL_MS) out[mint] = hit;
    else missing.push(mint);
  }
  for (let i = 0; i < missing.length; i += 50) {
    if (!(await spend("jupiter"))) break;
    const rows = await search(missing.slice(i, i + 50).join(","), fetchImpl);
    for (const row of rows || []) {
      const ctx = shape(row, now);
      // only what was asked for: a search by address can in principle return a neighbour
      if (!ctx || !missing.includes(ctx.mint)) continue;
      mem.set(ctx.mint, ctx);
      out[ctx.mint] = ctx;
    }
  }
  return out;
}

/**
 * Every mint the index returns under exactly this symbol, most credible first.
 *
 * `null` means the source did not answer; `[]` means it answered and nothing uses the symbol.
 * Those must stay apart, for the reason they do everywhere else in this codebase: an outage
 * is not a finding. The search is fuzzy and capped, so the list is a FLOOR - "at least this
 * many" - and is only ever worded that way.
 */
export async function symbolMints(symbol, { fetchImpl = fetch, now = Date.now() } = {}) {
  const want = norm(symbol);
  if (!/^[A-Z0-9]{2,12}$/.test(want)) return [];
  const key = `jsym2:${want}`;
  try {
    const got = await chrome.storage.local.get(key);
    if (got[key] && now - got[key].at < SYMBOL_TTL_MS) return got[key].mints;
  } catch {
    /* storage blocked: ask live */
  }
  if (!(await spend("jupiter"))) return null;
  const rows = await search(want, fetchImpl);
  if (!rows) return null;
  const mints = rows
    .filter((t) => t?.id && norm(t.symbol) === want)
    .map((t) => ({ mint: String(t.id), symbol: t.symbol, name: t.name || null, verified: t.isVerified === true, holders: num(t.holderCount) }))
    // a verified mint leads; after that, whichever most wallets hold
    .sort((x, y) => Number(y.verified) - Number(x.verified) || (y.holders || 0) - (x.holders || 0));
  chrome.storage.local.set({ [key]: { at: now, mints } }).catch(() => {});
  return mints;
}

/** Verified mints that already use this symbol - what a clean mint wearing it is checked against. */
export async function sameSymbol(symbol, opts) {
  const mints = await symbolMints(symbol, opts);
  return mints === null ? null : mints.filter((m) => m.verified);
}

// What a trade is paid in. A post saying "ape with $SOL" has named a currency, not a token it
// might be mistaken about - and each of these has hundreds of copies, so a line under every
// mention would be exactly the noise that teaches people to stop reading badges.
const CURRENCIES = new Set(["SOL", "WSOL", "USDC", "USDT", "USD", "ETH", "WETH", "BTC", "WBTC", "BNB"]);

/**
 * What a bare $TICKER on Solana can honestly be answered with.
 *
 * The same rule the EVM side has always had: a ticker one mint uses is not a finding, and a
 * ticker several mints use IS one - it holds with no contract in the post at all, because
 * the post has not said which it means. Returns null when there is nothing worth a line.
 */
export async function lookupSymbol(ticker, opts) {
  const t = norm(ticker);
  if (!/^[A-Z]{2,10}$/.test(t) || CURRENCIES.has(t)) return null;
  const mints = await symbolMints(t, opts);
  if (!mints || mints.length < 2) return null;
  return { ticker: t, count: mints.length, verified: mints[0].verified, mints: mints.slice(0, 5) };
}

const SPAN = [
  [60_000, "minute"],
  [3_600_000, "hour"],
  [86_400_000, "day"],
];

/** "23 minutes", "5 hours", "12 days" - a span, worded for a sentence. */
export function spanWords(ms) {
  const v = Math.max(0, Number(ms) || 0);
  if (v < 60_000) return "under a minute";
  let [unit, label] = SPAN[0];
  for (const [u, l] of SPAN) if (v >= u) [unit, label] = [u, l];
  const n = Math.round(v / unit);
  return `${n} ${label}${n === 1 ? "" : "s"}`;
}

const people = (n) => Number(n).toLocaleString("en-US");

/**
 * The launch, as rows for the panel's "who launched it" block.
 *
 * Every row says what the index reports and says that it is the index reporting it. Exactly
 * one of them can be a warning - a creator wallet with many launches behind it - and that
 * floor is ten, the same number the EVM deployer trail uses, with one difference that
 * matters: there the wallet's own transactions were read, here the count is somebody else's,
 * so it stops at `warn` and never reaches `fail`.
 */
export function launchChecks(ctx, now = Date.now()) {
  if (!ctx) return [];
  const rows = [];
  const row = (id, label, status, detail) => rows.push({ id, label, status, detail });

  if (ctx.createdAt) {
    const age = spanWords(now - ctx.createdAt);
    const where = ctx.launchpad ? ` on ${ctx.launchpad}` : "";
    const grad = ctx.graduatedAt
      ? ctx.graduatedAt - ctx.createdAt < 60_000
        ? ", and reached an open pool inside the first minute"
        : `, and reached an open pool ${spanWords(ctx.graduatedAt - ctx.createdAt)} later`
      : ctx.launchpad ? ". It has not graduated from the launchpad's own curve" : "";
    row("launch", "launched", "unresolved", `first traded ${age} ago${where}${grad}`);
  } else if (ctx.launchpad) {
    row("launch", "launched", "unresolved", `launched on ${ctx.launchpad}`);
  }

  if (ctx.holders != null) {
    const top = ctx.top10Pct != null ? `, and the ten largest hold ${ctx.top10Pct.toFixed(1)}% of supply` : "";
    row("holders", "holders", "unresolved", `${people(ctx.holders)} wallets hold it${top} - Jupiter's count, not read from the chain`);
  }

  if (ctx.dev) {
    const launches = ctx.devMints != null
      ? `, which it counts ${people(ctx.devMints)} token launch${ctx.devMints === 1 ? "" : "es"} for${ctx.devMigrations != null ? ` (${people(ctx.devMigrations)} reached an open pool)` : ""}`
      : "";
    const holds = ctx.devPct != null && ctx.devPct >= 0.01 ? `. That wallet still holds ${ctx.devPct.toFixed(2)}% of supply` : "";
    const many = !ctx.verified && (ctx.devMints || 0) >= 10;
    // Seen live 2026-10-07: a fresh mint attributed to a wallet with 3,648 launches. That is
    // not a person, it is a launch tool signing for its users - so the count is reported as
    // what it is, and the sentence says which two things it can mean rather than picking one.
    const which = many ? ". That is one operator or a shared launch tool - either way, this mint is one of many from the same wallet" : "";
    row("creator", many ? "creator, many launches" : "creator", many ? "warn" : "unresolved",
      `Jupiter attributes this mint to ${ctx.dev}${launches}${which}${holds}`);
  }

  return rows;
}

/**
 * The token's own X link, read against what this browser has actually seen.
 *
 * A token names an X account by writing a URL into its metadata, and nothing checks it. The
 * only test of that link is the other direction - has that account ever posted this contract
 * - and the only witness to THAT is the feed. `posted` is the caller entry for the named
 * handle if the graph holds one.
 *
 * Never a warning. An account that has not posted the contract in front of this reader may
 * simply never have crossed their feed; what is worth stating is which of the two states is
 * true, and what the link does and does not prove.
 */
export function bindingCheck(x, posted) {
  if (!x) return null;
  const row = (status, detail) => ({ id: "x_binding", label: "X account", status, detail });
  if (x.kind === "community") {
    return row("unresolved", "its X link is an X community, not an account. Anyone can open a community in a minute, so this names nobody.");
  }
  if (x.kind !== "account" && x.kind !== "post") {
    return row("unresolved", "its X link does not point at an account.");
  }
  // One post is not an account, and the sentence has to say so before it says anything else:
  // linking somebody's viral post is how a token borrows an account it has nothing to do with.
  const names = x.kind === "post" ? `its X link is one post by @${x.handle}, not an account` : `names @${x.handle} as its own X account`;
  if (posted) {
    return row("ok", `${names} - and @${x.handle} has posted this contract in your feed. The link holds in both directions.`);
  }
  return row("unresolved",
    `${names}. That link was written by whoever created the token and proves nothing about @${x.handle}: you have not seen that account post this contract.`);
}

// ---- the deeper read: bundles, bots, the creator wallet's age ----
//
// Jupiter's own token pages are fed by a second endpoint that carries more than the
// documented search does: how many bundled buys it counted at launch and how much of supply
// they ever held, how many holders it classes as bots, when the creator wallet was first
// funded. It is keyless and answers a browser extension (measured 2026-10-07).
//
// It is also UNDOCUMENTED, which decides how it is used: only when a reader asks, never on
// the path to a verdict, and with the expectation that it will one day stop answering - at
// which point these rows simply do not appear.
//
// "Bundled" and "bot" are Jupiter's classifications, not something this extension measured.
// Each row says so, and only one of them can be a warning: bundles that at their peak held a
// quarter of supply, on a token no list vouches for.

const DEEP = "https://datapi.jup.ag/v1/assets/search?query=";

/** Reduce the deep answer to what will be repeated. Null when it has nothing to say. */
export function shapeDeep(t) {
  if (!t?.id) return null;
  const a = t.audit || {};
  const b = a.bundlerStats || null;
  return {
    mint: String(t.id),
    verified: t.isVerified === true,
    createdAt: when(t.firstPool?.createdAt) ?? when(t.createdAt),
    bundles: b ? { count: num(b.totalBundles), sol: num(b.totalNativeVol), peakPct: num(b.holdingPctATH) } : null,
    bots: a.botHoldersCount != null ? { count: num(a.botHoldersCount), pct: num(a.botHoldersPercentage) } : null,
    devFundedAt: when(a.devFundedAt),
    dexPaidAt: when(t.dexPaidAt),
  };
}

export async function readDeep(mint, { fetchImpl = fetch } = {}) {
  if (!(await spend("jupiter"))) return null;
  try {
    const res = await fetchImpl(`${DEEP}${encodeURIComponent(mint)}`, { headers: { Accept: "application/json" } });
    if (!res?.ok) return null;
    const rows = await res.json();
    const row = (Array.isArray(rows) ? rows : []).find((r) => r?.id === mint);
    return shapeDeep(row);
  } catch {
    return null;
  }
}

const day = (ts) => new Date(ts).toISOString().slice(0, 10);

export function deepChecks(d) {
  if (!d) return [];
  const rows = [];
  const row = (id, label, status, detail) => rows.push({ id, label, status, detail });

  if (d.bundles && d.bundles.count != null) {
    if (d.bundles.count > 0) {
      const size = d.bundles.sol != null ? ` worth ${d.bundles.sol.toFixed(1)} SOL` : "";
      const peak = d.bundles.peakPct != null ? `, holding up to ${d.bundles.peakPct.toFixed(1)}% of supply at their peak` : "";
      const heavy = !d.verified && (d.bundles.peakPct || 0) >= 25;
      row("bundles", "bundled buys", heavy ? "warn" : "unresolved",
        `Jupiter counts ${people(d.bundles.count)} bundled buy${d.bundles.count === 1 ? "" : "s"} at launch${size}${peak} - several wallets buying in one transaction, which is how one buyer looks like a crowd`);
    } else {
      row("bundles", "bundled buys", "unresolved", "Jupiter counts no bundled buys at this token's launch");
    }
  }

  if (d.bots && d.bots.count != null && d.bots.count > 0) {
    row("bots", "bot holders", "unresolved",
      `Jupiter classes ${people(d.bots.count)} of the holders as bots${d.bots.pct != null ? `, holding ${d.bots.pct.toFixed(1)}% of supply` : ""} - its classification, not something read here`);
  }

  if (d.devFundedAt && d.createdAt && d.createdAt >= d.devFundedAt) {
    row("dev_age", "creator wallet", "unresolved",
      `the creator wallet was first funded ${spanWords(d.createdAt - d.devFundedAt)} before this token launched`);
  }

  if (d.dexPaidAt) {
    row("dex_paid", "chart profile", "unresolved", `a Dexscreener profile was paid for on ${day(d.dexPaidAt)}, by Jupiter's record. Somebody spent money; it does not say who`);
  }
  return rows;
}
