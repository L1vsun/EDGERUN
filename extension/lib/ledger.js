// The session ledger: everything a tab has checked, in the order it was seen.
//
// This is the thing a popover structurally cannot do. A popover is per-token and dies with
// the DOM node that opened it, so the only question it can ever answer is "is this one real".
// Scroll a timeline for ten minutes and the question you actually have is "what did I just
// scroll past" - which needs a record that outlives the badge, the navigation and the worker.
//
// So it lives in chrome.storage.session: it survives the ~30 s MV3 worker death, never
// touches disk, and is gone when the browser closes. Keyed by tab, because two tabs are two
// separate reading sessions and merging them would make the list meaningless.
//
// Session storage is TRUSTED_CONTEXTS only by default, which is exactly the boundary we
// want: the worker writes, the side panel reads, and a content script on x.com can do
// neither.

const CAP = 200; // a long reading session, bounded - the tail is never what you want anyway

export const ledgerKey = (tabId) => `ledger:${tabId}`;
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
 * Record a sighting. Re-seeing an address moves it to the top and bumps its count rather
 * than adding a second row - a timeline that re-renders the same post four times is still
 * one token you looked at.
 */
export async function record(tabId, url, result) {
  if (!tabId || !result?.address) return;
  const k = ledgerKey(tabId);
  try {
    const got = await chrome.storage.session.get(k);
    const rows = got[k] || [];
    const address = result.address.toLowerCase();
    const prev = rows.find((e) => e.address === address);
    const at = Date.now();
    const entry = {
      address,
      symbol: result.symbol || null,
      verdict: result.verdict,
      level: result.level,
      say: summarize(result),
      // trimmed to what a row and its expansion need - the full result stays in the verdict cache
      checks: (result.checks || []).map(({ id, label, detail, status }) => ({ id, label, detail, status })),
      explorerUrl: result.explorerUrl || null,
      url: url || prev?.url || null,
      first: prev?.first ?? at,
      at,
      seen: (prev?.seen || 0) + 1,
    };
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
export async function recordMany(tabId, url, results) {
  const list = (results || []).filter((r) => r?.address);
  if (!tabId || !list.length) return;
  const k = ledgerKey(tabId);
  try {
    const got = await chrome.storage.session.get(k);
    let rows = got[k] || [];
    const at = Date.now();
    for (const result of list) {
      const address = result.address.toLowerCase();
      const prev = rows.find((e) => e.address === address);
      const entry = {
        address,
        symbol: result.symbol || null,
        verdict: result.verdict,
        level: result.level,
        say: summarize(result),
        checks: (result.checks || []).map(({ id, label, detail, status }) => ({ id, label, detail, status })),
        explorerUrl: result.explorerUrl || null,
        url: url || prev?.url || null,
        first: prev?.first ?? at,
        at,
        seen: (prev?.seen || 0) + 1,
      };
      rows = [entry, ...rows.filter((e) => e.address !== address)];
    }
    await chrome.storage.session.set({ [k]: rows.slice(0, CAP) });
  } catch {}
}

export async function read(tabId) {
  try {
    const k = ledgerKey(tabId);
    const got = await chrome.storage.session.get(k);
    return got[k] || [];
  } catch {
    return [];
  }
}

export async function clear(tabId) {
  try {
    await chrome.storage.session.remove(ledgerKey(tabId));
  } catch {}
}

/** Which row the sidebar should open on, set when a badge is what asked it to open. */
export async function setFocus(tabId, address) {
  if (!tabId) return;
  try {
    await chrome.storage.session.set({ [focusKey(tabId)]: { address: String(address || "").toLowerCase(), at: Date.now() } });
  } catch {}
}

/** A closed tab's reading session is over - drop it rather than waiting for the browser. */
export async function drop(tabId) {
  try {
    await chrome.storage.session.remove([ledgerKey(tabId), focusKey(tabId)]);
  } catch {}
}
