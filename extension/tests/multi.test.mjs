// Posts that name more than one token.
//
// Reported 2026-09-24: "not rare when there is 2+ tickers, so it must show all". The old
// decideBadge picked the worst one and printed "showing the one that matters most", which is
// an answer to a question nobody asked - somebody who pastes three contracts is talking about
// three things.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ctx = { globalThis: {}, console, window: {}, document: { documentElement: {} }, MutationObserver: class {}, IntersectionObserver: class {}, setTimeout, clearTimeout };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../shared/detect.js", import.meta.url), "utf8"), ctx);
const { decideBadges, findTokens } = ctx.EDGERUN;

const tok = (address, symbol, verdict = "UNRESOLVED") => ({ address, symbol, verdict, checks: [] });
const A = "0xaaa0000000000000000000000000000000000001";
const B = "0xbbb0000000000000000000000000000000000002";
const C = "0xccc0000000000000000000000000000000000003";
const TSLA = { ticker: "TSLA", address: "0x322f0929000000000000000000000000000000ab", name: "Tesla" };

// ---- three contracts, three badges ----
let out = decideBadges({ results: [tok(A, "ONE"), tok(B, "TWO"), tok(C, "THREE")], namedTickers: [] });
assert.equal(out.length, 3, "three tokens named, three answers");
assert.equal(out.map((r) => r.symbol).join(","), "ONE,TWO,THREE", "in the order they were named");

// ---- the decisive finding leads, and the others still appear ----
out = decideBadges({
  results: [tok(A, "CLEAN"), tok(B, "TSLA")],
  official: [TSLA],
  namedTickers: ["TSLA"],
});
assert.equal(out[0].address, B, "the impersonator leads");
assert.equal(out[0].verdict, "FAIL");
assert.match(out[0].lead, /its issuer publishes/);
assert.equal(out.length, 2, "the clean one is still shown, not swallowed");
assert.equal(out[1].symbol, "CLEAN");
assert.equal(out.filter((r) => r.address === B).length, 1, "the impersonator appears once, not twice");

// ---- worst-first when nothing is decisive ----
out = decideBadges({ results: [tok(A, "OK", "PASS"), tok(B, "BAD", "FAIL"), tok(C, "MEH", "CAUTION")], namedTickers: [] });
assert.equal(out[0].symbol, "BAD", "the worst leads even with no ticker claim");
assert.equal(out.length, 3);

// ---- Solana mints join the same answer ----
const MINT = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
out = decideBadges({
  results: [tok(A, "EVMTOKEN")],
  namedTickers: [],
  solana: [{ address: MINT, symbol: "PUMP", verdict: "PASS", chainName: "Solana", checks: [] }],
});
assert.equal(out.length, 2, "a post naming an EVM contract and a Solana mint answers about both");
assert.equal(out[1].chainName, "Solana");

// ---- bounded ----
out = decideBadges({
  results: Array.from({ length: 9 }, (_, i) => tok(`0x${String(i).padStart(40, "0")}`, `T${i}`)),
  namedTickers: [],
});
assert.equal(out.length, 4, "a post with nine contracts does not paper the timeline");

// ---- silence is still the default ----
assert.equal(decideBadges({ results: [], namedTickers: ["TSLA"] }).length, 0,
  "a bare ticker with no contract still says nothing");
assert.equal(decideBadges({}).length, 0);

// ---- two contested tickers, two answers ----
// From the field 2026-09-24: a post whose subject was $PONS (15 contracts share it on one
// chain) got a single badge about $PUMP, because $PUMP was named first and decideBadge only
// ever returns the first collision it finds.
const C_PONS = "0xccc0000000000000000000000000000000000003";
const contested = [
  { ticker: "PUMP", count: 6, capped: false, chainName: "Test Chain", explorer: "https://scan.test", candidates: [{ address: A, name: "Pump", verified: true }] },
  { ticker: "PONS", count: 15, capped: false, chainName: "Test Chain", explorer: "https://scan.test", candidates: [{ address: B, name: "Pons", verified: false }] },
];
out = decideBadges({
  results: [{ address: C_PONS, symbol: "PONS", verdict: "UNRESOLVED", checks: [] }],
  onchain: contested,
  namedTickers: ["PUMP", "PONS"],
});
assert.equal(out.map((r) => r.symbol).join(","), "PONS,$PUMP,$PONS", "the contract, then both contested tickers in the order named");
assert.match(out[2].lead, /at least 15 different contracts/);
assert.match(out[2].lead, /on Test Chain/, "a count names the chain it is a count of");
assert.equal(out[2].explorerUrl, `https://scan.test/address/${B}`, "and links to that chain's explorer, not a hard-coded one");
assert.equal(out.filter((r) => r.symbol === "$PUMP").length, 1, "and neither is answered twice");

// ---- a shared ticker with NO contract beside it says nothing ----
// The count is a fact about one chain, and a post naming a ticker and no contract has not
// said which chain it means. Under a post about a Solana token this was a warning about
// somewhere else.
out = decideBadges({ results: [], onchain: contested, namedTickers: ["PUMP", "PONS"] });
assert.equal(out.length, 0, "no contract, no count");

// nor beside a Solana mint: the count is about a different chain than the mint is on
out = decideBadges({
  results: [], onchain: contested, namedTickers: ["PUMP"],
  solana: [{ address: MINT, symbol: "PUMP", verdict: "PASS", chainName: "Solana", checks: [] }],
});
assert.equal(out.length, 1);
assert.equal(out[0].address, MINT);

// a ticker only one contract uses is still not a finding
out = decideBadges({
  results: [{ address: C_PONS, symbol: "SOLO", verdict: "UNRESOLVED", checks: [] }],
  onchain: [{ ticker: "SOLO", count: 1, capped: false, candidates: [{ address: A, name: "Solo" }] }],
  namedTickers: ["SOLO"],
});
assert.equal(out.length, 1, "one contract, one meaning: just the contract");

// ---- an 0x address with no contract on the chain that was read gets no badge ----
out = decideBadges({
  results: [{ address: C_PONS, symbol: null, verdict: "UNRESOLVED", absent: true, checks: [] }],
  onchain: contested, namedTickers: ["PUMP"],
});
assert.equal(out.length, 0, "answering 'unresolved' about the wrong chain is not an answer");

// ---- Solana: the post names one ticker, the mint calls itself something else ----
const { mintClaim, launchLine, ownTokens } = ctx.EDGERUN;
const wif2 = { address: MINT, symbol: "WIF2", verdict: "PASS", chainName: "Solana", checks: [] };
let claim = mintClaim({ solana: [wif2], namedTickers: ["WIF"] });
assert.match(claim.lead, /The post says \$WIF, but the mint it gives calls itself WIF2/);
assert.equal(claim.verdict, "PASS", "it supplies a sentence and never changes the verdict");
out = decideBadges({ solana: [wif2], namedTickers: ["WIF"] });
assert.equal(out.length, 1, "one mint, one badge - the claim replaces the raw result, it does not add to it");
assert.match(out[0].lead, /calls itself WIF2/);

// silent whenever the pairing is not unambiguous
assert.equal(mintClaim({ solana: [{ ...wif2, symbol: "$wif" }], namedTickers: ["WIF"] }), null, "same symbol, however it is written");
assert.equal(mintClaim({ solana: [wif2], namedTickers: ["WIF", "BONK"] }), null, "two tickers: which one it was offered as is a guess");
assert.equal(mintClaim({ solana: [wif2], namedTickers: ["SOL"] }), null, "a currency is what you pay with, not a claim");
assert.equal(mintClaim({ solana: [wif2], namedTickers: ["SOL", "WIF2"] }), null);
assert.equal(mintClaim({ solana: [wif2, { ...wif2, address: "x" }], namedTickers: ["WIF"] }), null, "two mints");
assert.equal(mintClaim({ solana: [{ ...wif2, symbol: null }], namedTickers: ["WIF"] }), null, "a mint that names itself nothing claims nothing");
assert.equal(mintClaim({ solana: [wif2], namedTickers: ["WIF"], results: [{ address: A, symbol: "WIF" }] }), null,
  "the ticker belongs to the EVM contract in the same post");

// ---- the launch line: describes, has no thresholds, and survives missing fields ----
const NOW = Date.parse("2026-10-07T00:23:00Z");
assert.equal(
  launchLine({ launchpad: "pump.fun", createdAt: Date.parse("2026-10-07T00:00:00Z"), holders: 147, top10Pct: 22.07 }, NOW),
  "pump.fun · 23 min old · 147 holders · top 10 hold 22%",
);
assert.equal(launchLine({ createdAt: NOW - 5 * 3600_000, holders: 1 }, NOW), "5 h old · 1 holder");
assert.equal(launchLine({ createdAt: NOW - 9 * 86400_000 }, NOW), "9 days old");
assert.equal(launchLine({ createdAt: NOW + 60_000, holders: null }, NOW), "", "a launch time in the future is not an age");
assert.equal(launchLine(null, NOW), "");

// ---- which mints name the poster as their own X account ----
const named = (handle, kind = "account") => ({ ...wif2, context: { x: { kind, handle } } });
assert.equal(ownTokens({ handle: "DevAcct" }, [named("devacct")]).length, 1, "handles compare case-insensitively");
assert.equal(ownTokens({ handle: "devacct" }, [named("devacct", "post")]).length, 1, "a post by the account still names the account");
assert.equal(ownTokens({ handle: "someoneelse" }, [named("devacct")]).length, 0);
assert.equal(ownTokens({ handle: "devacct" }, [{ ...wif2, context: { x: { kind: "community", handle: null } } }]).length, 0);
assert.equal(ownTokens(null, [named("devacct")]).length, 0);
assert.equal(ownTokens({ handle: "devacct" }, [wif2]).length, 0, "no context, no claim");

// ---- finding the pieces in real post text ----
const post = `$PUMP is rallying on @Pumpfun
mint pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn
also watching $TSLA at 0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715
https://x.com/someone/status/1234567890123456789`;
const f = findTokens(post);
assert.equal(f.tickers.join(","), "PUMP,TSLA");
assert.equal(f.addresses.join(","), "0xd18f5e73ec5e2d0b18ebe97426dc5edc2c887715");
assert.equal(f.mints.join(","), MINT, "the base58 mint is found and the status id is not");

// a hex address must never be offered as a base58 candidate
assert.equal(findTokens("0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715").mints.length, 0);
// nor a 64-hex pool id
assert.equal(findTokens(`0x${"a".repeat(64)}`).mints.length, 0);

// ---- a linked Solana pair page is a contract too ----
const { textWithLinks } = ctx.EDGERUN;
// Dexscreener writes its own links lowercased, so the id is not an address anyone can read
let linked = findTokens("ape https://dexscreener.com/solana/xp1tsabgpunzaawlt1e5xmpfffpg5z6hstfzete1i6b now");
assert.equal(linked.pairs.join(","), "xp1tsabgpunzaawlt1e5xmpfffpg5z6hstfzete1i6b");
assert.equal(linked.mints.length, 0, "a pair id is not offered as a mint - folded to lowercase it is not even an address");
linked = findTokens(`dexscreener.com/solana/${MINT} and again dexscreener.com/solana/${MINT}`);
assert.equal(linked.pairs.length, 1, "the same link twice is one link");
assert.equal(linked.mints.length, 0);
// a mint written out beside a link is still found as a mint
linked = findTokens(`${MINT} chart: dexscreener.com/solana/xp1tsabgpunzaawlt1e5xmpfffpg5z6hstfzete1i6b`);
assert.equal(linked.mints.join(","), MINT);
assert.equal(linked.pairs.length, 1);
assert.equal(findTokens("dexscreener.com/ethereum/0xabc").pairs.length, 0, "only the chain whose pairs resolve to a mint");
assert.deepEqual(JSON.parse(JSON.stringify(findTokens(""))), { addresses: [], tickers: [], mints: [], pairs: [] });

// ---- the part of a link the page displays cut short ----
// innerText is what a reader sees; the link's own text can carry the rest of the URL.
const el = (inner, links) => ({ innerText: inner, querySelectorAll: () => links.map((t) => ({ textContent: t })) });
const shown = "$TTK is live pump.fun/coin/8xu4aFUU…";
const full = `https://pump.fun/coin/${MINT}…`;
assert.equal(findTokens(shown).mints.length, 0, "the displayed text alone has no contract in it");
assert.equal(findTokens(textWithLinks(el(shown, [full]))).mints.join(","), MINT, "the link's full text does");
assert.equal(textWithLinks(el("gm", [])), "gm");
assert.equal(textWithLinks(el("hi @someone", ["@someone"])), "hi @someone", "a mention is a link too, and adds nothing");
assert.equal(textWithLinks(null), "");

// ---- a bare ticker several Solana mints share ----
const { symbolResult, settle, isCurrency } = ctx.EDGERUN;
const listed = { ticker: "PUMP", count: 2, verified: true, mints: [
  { mint: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", symbol: "PUMP", name: "Pump", verified: true, holders: 311143 },
  { mint: "GTiqdugptGkYwoF2xsY9vGNLUrXg3x9JGJGTk77ypump", symbol: "PUMP", name: "PUMP ME PLS", verified: false, holders: 4 },
] };
const shared = { ticker: "HASHERS", count: 16, verified: false, mints: [
  { mint: "85WdpEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAuxML", symbol: "HASHERS", name: "Hashers", verified: false, holders: 2074 },
  { mint: "CopyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1", symbol: "HASHERS", name: null, verified: false, holders: null },
] };

// a list vouches for one of them: a quiet line that names it
let line = symbolResult(listed);
assert.equal(line.verdict, "UNRESOLVED", "not a caution - most readers mean the listed one");
assert.equal(line.address, "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", "it points at the listed mint, in its real casing");
assert.match(line.lead, /The listed \$PUMP is pumpCm…9Dfn, held by 311,143 wallets\. At least 1 other mint uses the same symbol/);
assert.equal(line.chainName, "Solana");
assert.equal(line.ticker, true);
// none is vouched for: there is no right answer to point at, and that IS the finding
line = symbolResult(shared);
assert.equal(line.verdict, "CAUTION");
assert.match(line.lead, /At least 16 mints use \$HASHERS and no list vouches for any of them\. The most-held is 85WdpE…uxML, with 2,074 wallets/);
assert.match(line.checks[2].detail, /an unknown number of wallets/, "a holder count that is missing is not printed as zero");

// only where the post hands over no contract at all
out = decideBadges({ namedTickers: ["PUMP"], symbols: [listed] });
assert.equal(out.length, 1);
assert.equal(out[0].symbol, "$PUMP");
out = decideBadges({ namedTickers: ["PUMP"], symbols: [listed], solana: [wif2] });
assert.equal(out.length, 1, "with a contract in the post the contract is the answer to 'which one'");
assert.equal(out[0].address, MINT);
out = decideBadges({ namedTickers: ["PUMP"], symbols: [listed], results: [{ address: C_PONS, symbol: "PUMP", verdict: "UNRESOLVED", checks: [] }] });
assert.equal(out.some((r) => r.ticker), false, "an EVM contract counts as a contract too");
// but an 0x address that is not a contract on the chain read is not an answer to anything
out = decideBadges({ namedTickers: ["PUMP"], symbols: [listed], results: [{ address: C_PONS, symbol: null, verdict: "UNRESOLVED", absent: true, checks: [] }] });
assert.equal(out.length, 1);
assert.equal(out[0].ticker, true);
// a post that lists five tickers does not get five lines
out = decideBadges({ namedTickers: ["A", "B", "C"], symbols: [listed, shared, { ...shared, ticker: "THIRD" }] });
assert.equal(out.length, 2);
// one mint under a symbol is not a line
assert.equal(decideBadges({ namedTickers: ["SOLO"], symbols: [{ ticker: "SOLO", count: 1, mints: [shared.mints[0]] }] }).length, 0);

assert.equal(isCurrency("$sol"), true);
assert.equal(isCurrency("PUMP"), false);

// ---- a source that is slow or broken must not hold a post's badge hostage ----
assert.equal(await settle(Promise.resolve(7), 0), 7);
assert.equal(await settle(Promise.reject(new Error("worker gone")), "fallback"), "fallback", "never rejects");
assert.equal(await settle(new Promise(() => {}), "late", 20), "late", "and never waits past its bound");

console.log("multi: ok");
