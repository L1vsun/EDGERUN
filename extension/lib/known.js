// The maintained reference list, carried with the extension.
//
// Mirrors edgerun/data/known_tokens.json. These are not official Robinhood assets — the
// registry handles those. They are the established hood-themed tokens on this chain, kept
// so a new contract that lands two edits from one of them gets named.
//
// There is deliberately no single "official $HOOD": GreenHood, Hoodrat, Good In The Hood
// and others all independently claim hood-the-word, which is exactly why this list says
// "established", never "the real one".

export const REFERENCE_TOKENS = [
  { ticker: "HOOD", name: "GreenHood", contract: "0xDAA8f3f54c66E9BE2c44C1B6b566cBD07229CED3" },
  { ticker: "GOOD", name: "Good In The Hood", contract: "0x5f62C57e5C537887117EeF828b7E3Ad41C009FEb" },
  { ticker: "HOODRAT", name: "Hoodrat", contract: "0x8e62F281f282686fCa6dCB39288069a93fC23F1c" },
];

export const EDIT_DISTANCE_THRESHOLD = 2;

export function levenshtein(a, b) {
  a = String(a || "").toLowerCase();
  b = String(b || "").toLowerCase();
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * How many edits may separate two strings before we stop calling it a near-miss, scaled to
 * the shorter one. A flat threshold is wrong for short tickers: "AI" and "HD" are 2 edits
 * apart and share nothing, and flagging that cost the tool its credibility once already.
 */
export function allowedDistance(a, b, threshold = EDIT_DISTANCE_THRESHOLD) {
  return Math.min(threshold, Math.floor(Math.min(a.length, b.length) / 2));
}
