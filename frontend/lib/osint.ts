// Who is behind a token - from one public index, and worded as that.
//
// A Solana mint does not record who created it, when it launched, or how widely it is held;
// an index does. Jupiter's token search answers all of it keyless and sends CORS headers, so
// the browser asks it directly. No key, no backend, nothing scraped.
//
// Everything here is an INDEX'S RECORD, and every line says so. The one field to be most
// careful with is the creator wallet: for the same fresh mint, two indexes named two
// different creators on the same day, and a wallet with thousands of launches turned out to
// be a launch tool signing for its users. So it is "attributed to", never "the dev is".
//
// What it does NOT do: read social networks. A token's X link is whatever its creator typed
// into the metadata, and this only reports what kind of link it is.

const HOSTS = ["https://lite-api.jup.ag", "https://api.jup.ag"];
const SEARCH = "/tokens/v2/search?query=";

export interface XLink {
  kind: "account" | "post" | "community" | "other";
  handle: string | null;
}

export interface Dossier {
  address: string;
  known: boolean;            // the index has a record of this mint at all
  verified: boolean;         // on the index's verified list
  launchpad: string | null;
  launchedAt: number | null; // first trade, ms
  graduatedAt: number | null;
  // who put it there, as attributed
  deployer: string | null;
  deployCount: number | null;     // launches the index counts for that wallet
  deployMigrated: number | null;  // how many of those reached an open pool
  deployerHolds: number | null;   // percent of supply that wallet still holds
  holders: number | null;
  top10: number | null;           // percent held by the ten largest wallets
  mintOpen: boolean;
  freezeOpen: boolean;
  x: XLink | null;
  notes: string[];
  partial?: boolean;
}

const cache = new Map<string, Dossier>();

const NOT_HANDLES = new Set(["i", "home", "search", "hashtag", "intent", "share", "explore", "settings"]);

/** What a token's "twitter" field actually points at: an account, one post, or a community. */
export function parseXLink(url: unknown): XLink | null {
  let u: URL;
  try {
    u = new URL(String(url || "").trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|mobile)\./, "");
  if (host !== "x.com" && host !== "twitter.com") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (!parts.length) return null;
  if (parts[0] === "i" && parts[1] === "communities") return { kind: "community", handle: null };
  const handle = parts[0].replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle) || NOT_HANDLES.has(handle.toLowerCase())) return { kind: "other", handle: null };
  if (parts[1] === "status") return { kind: "post", handle: handle.toLowerCase() };
  return parts.length === 1 ? { kind: "account", handle: handle.toLowerCase() } : { kind: "other", handle: null };
}

async function search(query: string, ms = 9000): Promise<any[] | null> {
  for (const host of HOSTS) {
    try {
      const stop = AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
      const r = await fetch(`${host}${SEARCH}${encodeURIComponent(query)}`, { signal: stop, headers: { Accept: "application/json" } });
      if (!r.ok) continue;
      const body = await r.json();
      if (Array.isArray(body)) return body;
    } catch {
      /* try the other host */
    }
  }
  return null;
}

const when = (v: unknown): number | null => {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : null;
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// `onPartial` is kept for the caller's sake: this is one request now, so it fires once.
export async function investigate(address: string, onPartial?: (d: Dossier) => void): Promise<Dossier> {
  const mint = address.trim();
  const hit = cache.get(mint);
  if (hit) return hit;

  const d: Dossier = {
    address: mint, known: false, verified: false, launchpad: null, launchedAt: null, graduatedAt: null,
    deployer: null, deployCount: null, deployMigrated: null, deployerHolds: null,
    holders: null, top10: null, mintOpen: false, freezeOpen: false, x: null, notes: [],
  };

  const rows = await search(mint);
  if (rows === null) {
    // not cached: the index being unreachable is about the index, and the next ask may land
    d.notes.push("the index did not answer - nothing follows from that about the token");
    return d;
  }
  const t = rows.find((r) => r?.id === mint);
  if (!t) {
    d.notes.push("the index has no record of this mint - it may have no pool yet");
    cache.set(mint, d);
    return d;
  }

  d.known = true;
  d.verified = t.isVerified === true;
  d.launchpad = t.launchpad || null;
  d.launchedAt = when(t.firstPool?.createdAt) ?? when(t.createdAt);
  d.graduatedAt = when(t.graduatedAt);
  d.deployer = t.dev || null;
  d.deployCount = num(t.audit?.devMints);
  d.deployMigrated = num(t.audit?.devMigrations);
  d.deployerHolds = num(t.audit?.devBalancePercentage);
  d.holders = num(t.holderCount);
  d.top10 = num(t.audit?.topHoldersPercentage);
  d.mintOpen = t.audit?.mintAuthorityDisabled === false;
  d.freezeOpen = t.audit?.freezeAuthorityDisabled === false;
  d.x = parseXLink(t.twitter);
  onPartial?.({ ...d });
  cache.set(mint, d);
  return d;
}

const span = (ms: number): string => {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 90) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hours`;
  return `${Math.round(h / 24)} days`;
};

// Plain-language read of the dossier. Same discipline as the flags: every line names whose
// record it is, and "we cannot tell" is a real answer.
export function readDossier(d: Dossier, now = Date.now()): { tone: "bad" | "good" | "flat"; text: string }[] {
  const out: { tone: "bad" | "good" | "flat"; text: string }[] = [];
  for (const note of d.notes) out.push({ tone: "flat", text: note });
  if (!d.known) return out.length ? out : [{ tone: "flat", text: "nothing on the public record either way" }];

  if (d.verified) out.push({ tone: "good", text: "on the index's verified token list" });

  if (d.mintOpen && !d.verified) out.push({ tone: "bad", text: "the mint authority is still live - new supply can be created at any time" });
  if (d.freezeOpen && !d.verified) out.push({ tone: "bad", text: "a freeze authority exists - any holder's account can be frozen, which is how a Solana token stops you selling" });
  if (!d.mintOpen && !d.freezeOpen) out.push({ tone: "good", text: "mint and freeze authority are both revoked: supply is fixed and no account can be frozen" });

  if (d.launchedAt) {
    const where = d.launchpad ? ` on ${d.launchpad}` : "";
    const grad = d.graduatedAt
      ? `, and reached an open pool ${d.graduatedAt - d.launchedAt < 60_000 ? "inside the first minute" : `${span(d.graduatedAt - d.launchedAt)} later`}`
      : d.launchpad ? " and has not graduated from the launchpad's own curve" : "";
    out.push({ tone: "flat", text: `first traded ${span(now - d.launchedAt)} ago${where}${grad}` });
  }

  if (d.top10 !== null && d.holders !== null) {
    out.push({
      tone: d.top10 > 50 && !d.verified ? "bad" : "flat",
      text: `${d.holders.toLocaleString()} wallets hold it and the ten largest hold ${d.top10.toFixed(1)}% of supply - the index's count`,
    });
  }

  if (d.deployer && d.deployCount !== null) {
    const migrated = d.deployMigrated !== null ? `, ${d.deployMigrated.toLocaleString()} of which reached an open pool` : "";
    const many = d.deployCount >= 10 && !d.verified;
    out.push({
      tone: many ? "bad" : "flat",
      text: `the index attributes this mint to a wallet it counts ${d.deployCount.toLocaleString()} launch${d.deployCount === 1 ? "" : "es"} for${migrated}${many ? " - one operator or a shared launch tool, and either way this is one of many" : ""}`,
    });
    if (d.deployerHolds !== null && d.deployerHolds >= 0.01) {
      out.push({ tone: "flat", text: `that wallet still holds ${d.deployerHolds.toFixed(2)}% of supply` });
    }
  }

  if (d.x) {
    out.push({
      tone: "flat",
      text: d.x.kind === "community"
        ? "its X link is a community, which anyone can open in a minute - it names nobody"
        : d.x.kind === "post"
          ? `its X link is one post by @${d.x.handle}, not an account - anyone can paste any post there`
          : d.x.kind === "account"
            ? `it names @${d.x.handle} as its X account - written by whoever created the token, and proof of nothing about that account`
            : "its X link does not point at an account",
    });
  }

  if (!out.length) out.push({ tone: "flat", text: "nothing on the public record either way" });
  return out;
}
