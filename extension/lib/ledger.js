// The session ledger: everything checked this session, in the order it was seen.
//
// This is the thing a popover structurally cannot do. A popover is per-token and dies with
// the DOM node that opened it, so the only question it can ever answer is "is this one real".
// Scroll a timeline for ten minutes and the question you actually have is "what did I just
// scroll past" - which needs a record that outlives the badge, the navigation and the worker.
//
// So it lives in chrome.storage.session: it survives the ~30 s MV3 worker death, never
// touches disk, and is gone when the browser closes.
//
// ONE list, not one per tab (changed 2026-09-24). It was keyed by tab on the theory that two
// tabs are two reading sessions, which read well and was wrong in use: you check things on X,
// open the contract on the explorer to look closer, and the panel empties - the list is gone
// exactly when you went looking for it. The tab was never the unit anybody thought in. The
// source page is still kept per row, so "where did I see this" survives the merge, which is
// the only thing the split was actually buying.
//
// Session storage is TRUSTED_CONTEXTS only by default, which is exactly the boundary we
// want: the worker writes, the side panel reads, and a content script on x.com can do
// neither.

const CAP = 200; // a long reading session, bounded - the tail is never what you want anyway

export const LEDGER_KEY = "ledger";
export const focusKey = (tabId) => `focus:${tabId}`;

/**
 * The one line that has to explain a verdict in a list row.
 *
 * A failing check always wins: if something is wrong, that is the only thing worth saying
 * in a row the eye spends half a second on.
 */
function summarize(r) {
  const checks = r.checks || [];
  const decisive = checks.find((c) => c.status === "fail") || checks.find((c) => c.status === "warn");
  if (decisive) return decisive.detail;
  if (r.verdict === "OFFICIAL") return "in Robinhood's published registry";
  if (r.verdict === "PASS") return "full check ran, found nothing against it";
  if (r.verdict === "UNRESOLVED") return "identity only - the contract itself is unchecked";
  return "checked";
}

/**
 * One sighting, shaped for a list row. Shared by both record paths - they had drifted into
 * near-copies of each other, which meant every new field had to be added twice and would
 * eventually be added once.
 */
// Hex is case-insensitive and gets folded so one contract is one row. A Solana mint is
// base58 and folding it produces a string that is not the address - the same trap that bit
// lists.js. Fold only what is safe to fold.
const fold = (a) => (/^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : a);

function entryFor(result, url, prev, at) {
  const address = fold(result.address);
  return {
    address,
    symbol: result.symbol || null,
    chainName: result.chainName || null,
    verdict: result.verdict,
    level: result.level,
    say: summarize(result),
    // trimmed to what a row and its expansion need - the full result stays in the verdict cache
    checks: (result.checks || []).map(({ id, label, detail, status }) => ({ id, label, detail, status })),
    // what it claimed to be, when that claim is why it failed: the claim/reality view needs
    // both sides and the checks only carry the prose version
    impersonates: result.impersonates || null,
    explorerUrl: result.explorerUrl || null,
    url: url || prev?.url || null,
    first: prev?.first ?? at,
    at,
    seen: (prev?.seen || 0) + 1,
  };
}

/**
 * Record a sighting. Re-seeing an address moves it to the top and bumps its count rather
 * than adding a second row - a timeline that re-renders the same post four times is still
 * one token you looked at.
 */
export async function record(url, result) {
  if (!result?.address) return;
  const k = LEDGER_KEY;
  try {
    const got = await chrome.storage.session.get(k);
    const rows = got[k] || [];
    const address = fold(result.address);
    const prev = rows.find((e) => e.address === address);
    const entry = entryFor(result, url, prev, Date.now());
    await chrome.storage.session.set({ [k]: [entry, ...rows.filter((e) => e.address !== address)].slice(0, CAP) });
  } catch {
    // The ledger is a convenience and never a dependency: if session storage is unavailable
    // the check itself still works, the sidebar just has nothing to show.
  }
}

/**
 * A whole batch in one read-modify-write.
 *
 * Calling record() in a loop would be a race against itself - every call reads the same key
 * and writes it back, so concurrent ones silently drop each other's rows. A timeline resolves
 * twelve addresses at a time, so this is the common path, not the exotic one.
 */
export async function recordMany(url, results) {
  const list = (results || []).filter((r) => r?.address);
  if (!list.length) return;
  const k = LEDGER_KEY;
  try {
    const got = await chrome.storage.session.get(k);
    let rows = got[k] || [];
    const at = Date.now();
    for (const result of list) {
      const address = fold(result.address);
      const prev = rows.find((e) => e.address === address);
      const entry = entryFor(result, url, prev, at);
      rows = [entry, ...rows.filter((e) => e.address !== address)];
    }
    await chrome.storage.session.set({ [k]: rows.slice(0, CAP) });
  } catch {}
}

export async function read() {
  try {
    const got = await chrome.storage.session.get(LEDGER_KEY);
    return got[LEDGER_KEY] || [];
  } catch {
    return [];
  }
}

export async function clear() {
  try {
    await chrome.storage.session.remove(LEDGER_KEY);
  } catch {}
}

/** Which row the sidebar should open on, set when a badge is what asked it to open. */
export async function setFocus(tabId, address) {
  if (!tabId) return;
  try {
    await chrome.storage.session.set({ [focusKey(tabId)]: { address: String(address || "").toLowerCase(), at: Date.now() } });
  } catch {}
}

/**
 * A closed tab takes its focus hint with it and nothing else. The ledger is shared now, so
 * closing the tab you happened to check something in must not delete the record of it.
 */
export async function drop(tabId) {
  try {
    await chrome.storage.session.remove(focusKey(tabId));
  } catch {}
}
