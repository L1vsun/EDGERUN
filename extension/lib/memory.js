// What you have seen before.
//
// This is the one thing no server-side scanner can do: the extension is the only witness to
// your own feed. It remembers every address and ticker it has shown you, and says something
// when the story changes —
//
//   "you saw $PEPE four days ago, pointing at a different contract"
//   "this token passed when you looked on Tuesday; it does not now"
//
// A rug is usually not a single bad contract, it is a sequence: a ticker that moves between
// contracts, a token whose ownership comes back, a verdict that flips. None of that is
// visible in a single scan, and all of it is visible in a log of your own scans.
//
// Local only. It is never uploaded anywhere, and there is nowhere for it to go.

const CAP_PER_SYMBOL = 8;
const MAX_ADDRESSES = 4000;

const addrKey = (a) => `mem:${a.toLowerCase()}`;
const symKey = (s) => `sym:${String(s).toUpperCase().replace(/^\$/, "")}`;

const days = (ms) => Math.floor(ms / 86_400_000);

function when(ts) {
  const d = days(Date.now() - ts);
  if (d <= 0) return "earlier today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  const w = Math.floor(d / 7);
  return w < 9 ? `${w} weeks ago` : `${Math.floor(d / 30)} months ago`;
}

/**
 * Records a result and returns what is worth saying about having seen it before. Runs after
 * every scan, so the notes are always about the result the badge is showing.
 */
export async function rememberAndRecall(result) {
  if (!result?.address) return [];
  const notes = [];
  const key = addrKey(result.address);
  const now = Date.now();

  let prior = null;
  try {
    const got = await chrome.storage.local.get(key);
    prior = got[key] || null;
  } catch {
    return []; // storage blocked: the feature simply does not exist for this user
  }

  // 1. the verdict moved since you last looked
  if (prior && prior.verdict && prior.verdict !== result.verdict && result.verdict !== "UNRESOLVED" && prior.verdict !== "UNRESOLVED") {
    notes.push({
      id: "mem:verdict", label: "since you last looked",
      status: result.verdict === "FAIL" || result.verdict === "CAUTION" ? "fail" : "warn",
      detail: `this was ${prior.verdict} when you checked it ${when(prior.lastSeen)} — it is ${result.verdict} now`,
    });
  } else if (prior && prior.firstSeen && days(now - prior.firstSeen) >= 1) {
    notes.push({
      id: "mem:seen", label: "you have seen this",
      status: "unresolved",
      detail: `first shown to you ${when(prior.firstSeen)}${prior.count > 1 ? `, ${prior.count} times in total` : ""}`,
    });
  }

  // 2. the ticker has pointed somewhere else before
  const symbol = result.symbol && !result.symbol.startsWith("0x") ? result.symbol : null;
  if (symbol) {
    const sk = symKey(symbol);
    let seen = [];
    try {
      const got = await chrome.storage.local.get(sk);
      seen = got[sk] || [];
    } catch {}
    const others = seen.filter((s) => s.address !== result.address.toLowerCase());
    if (others.length) {
      const last = others[others.length - 1];
      notes.push({
        id: "mem:ticker", label: "this ticker has moved",
        status: "warn",
        detail: `you saw ${symbol} ${when(last.at)} pointing at ${last.address.slice(0, 10)}… — ${others.length === 1 ? "a different contract" : `${others.length} other contracts in total`}`,
      });
    }
    if (!seen.some((s) => s.address === result.address.toLowerCase())) {
      seen.push({ address: result.address.toLowerCase(), at: now });
      chrome.storage.local.set({ [sk]: seen.slice(-CAP_PER_SYMBOL) }).catch(() => {});
    }
  }

  const next = {
    address: result.address.toLowerCase(),
    symbol: symbol || prior?.symbol || null,
    verdict: result.verdict,
    firstSeen: prior?.firstSeen || now,
    lastSeen: now,
    count: (prior?.count || 0) + 1,
  };
  chrome.storage.local.set({ [key]: next }).catch(() => {});
  return notes;
}

/** Rough size check, so a heavy user's log cannot grow without bound. */
export async function pruneMemory() {
  try {
    const all = await chrome.storage.local.get(null);
    const entries = Object.entries(all).filter(([k]) => k.startsWith("mem:"));
    if (entries.length <= MAX_ADDRESSES) return;
    entries.sort((a, b) => (a[1]?.lastSeen || 0) - (b[1]?.lastSeen || 0));
    const drop = entries.slice(0, entries.length - MAX_ADDRESSES).map(([k]) => k);
    await chrome.storage.local.remove(drop);
  } catch {}
}
