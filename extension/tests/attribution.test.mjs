// sites/twitter.js end to end: who gets charged with a contract that crossed the timeline.
//
// The content script is an IIFE against a live DOM, so it runs here in a vm with a fake one
// small enough to read. Only the selectors twitter.js actually uses are supported - this is
// a harness for the attribution rule, not a browser.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// ---- the smallest DOM that can hold a post ----

class El {
  constructor(tags, text = "", kids = [], attrs = {}) {
    this.tags = new Set([].concat(tags));
    this.text = text;
    this.kids = kids;
    this.attrs = attrs;
    this.isConnected = true;
  }
  get innerText() {
    return [this.text, ...this.kids.map((k) => k.innerText)].filter(Boolean).join("\n");
  }
  descendants() {
    return this.kids.flatMap((k) => [k, ...k.descendants()]);
  }
  querySelector(sel) {
    return this.descendants().find((n) => n.tags.has(sel)) || null;
  }
  querySelectorAll(sel) {
    return this.descendants().filter((n) => n.tags.has(sel));
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...kids) { this.kids.push(...kids); }
  insertAdjacentElement() {}
}

const TWEET = 'article[data-testid="tweet"]:not([data-edgerun-seen])';
const NAME = '[data-testid="User-Name"]';
const TEXT = '[data-testid="tweetText"]';

const userName = (handle, display) =>
  new El(NAME, `${display}\n@${handle}\n·\n2h`, [new El("a[href]", "", [], { href: `/${handle}` })]);

/** A post, optionally quoting another one. */
const post = ({ handle, display = "Someone", text, quoting = null }) =>
  new El(TWEET, "", [
    userName(handle, display),
    new El(TEXT, text),
    ...(quoting ? [new El("quoted", "", [userName(quoting.handle, "Quoted"), new El(TEXT, quoting.text)])] : []),
  ]);

// ---- the vm ----

const MINT_HOISTED = 1;
const sent = [];
const ctx = {
  globalThis: {},
  console,
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  // no IntersectionObserver: E.whenNear then runs its callback immediately.
  // addEventListener is here because twitter.js now registers for SPA route changes,
  // which is what stops a profile card outliving the profile it describes.
  window: { addEventListener() {} },
  MutationObserver: class { observe() {} disconnect() {} },
  history: { pushState() {}, replaceState() {} },
  location: { href: "https://x.com/home" },
  chrome: {
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => {
        sent.push(msg);
        const data =
          msg.type === "verdicts"
            ? Object.fromEntries(msg.addresses.map((a) => [a, { address: a, symbol: "FAKE", verdict: "FAIL" }]))
            : msg.type === "mints"
              ? msg.candidates
                  .filter((c) => c === MINT)
                  .map((c) => ({ address: c, symbol: "PUMP", verdict: "PASS", chainName: "Solana" }))
              : msg.type === "stake"
                ? null // no wallet is filed under these accounts
                : {};
        cb({ ok: true, data });
      },
    },
  },
};
ctx.globalThis = ctx;
ctx.document = new El("document");
ctx.document.createElement = (tag) => new El(tag);
ctx.document.body = ctx.document;
ctx.document.documentElement = ctx.document;
vm.createContext(ctx);

const load = (p) => vm.runInContext(fs.readFileSync(new URL(p, import.meta.url), "utf8"), ctx);
load("../shared/detect.js");
// badge.js needs a real DOM. Rendering is not what this tests, but render() runs before
// record() in the same flush, so the stub has to satisfy it or nothing downstream happens.
ctx.EDGERUN.makeBadge = () => Object.assign(new El("badge", "", []), { update() {}, fail() {} });
ctx.EDGERUN.makeStakeStrip = () => null;
ctx.EDGERUN.log = () => {};

const MINT = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
const CA = "0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715";
const OTHER = "0xa9eFe2Fc94dE79734C03051515F48f254Ce61e18";

ctx.document.kids = [
  // 1. a plain call: the author wrote the address themselves
  post({ handle: "caller1", text: `new one just deployed ${CA}` }),
  // 2. a quote of someone else's call - the contract is in the QUOTED text, not theirs
  post({ handle: "quoter", text: "lol look at this", quoting: { handle: "scammer", text: `buy ${OTHER} now` } }),
  // 3. a ticker with no contract: named something, called nothing
  post({ handle: "newsaccount", text: "$TSLA earnings tomorrow" }),
  // 4. a Solana mint the author wrote. Missed entirely until 2026-09-24: record() bailed on
  //    "no 0x addresses" and never looked at mints, so a Solana-heavy feed left the graph empty.
  post({ handle: "solcaller", text: `aping ${MINT} right now` }),
  // 5. a quote of that mint: on the page, so it is badged, but not this author's call
  post({ handle: "solquoter", text: "is this real", quoting: { handle: "solcaller", text: `aping ${MINT} right now` } }),
];

load("../sites/twitter.js");
await new Promise((r) => setTimeout(r, 1200)); // watch debounces 300ms, then the batch 220ms

// ---- what was recorded ----

const records = sent.filter((m) => m.type === "graph:record").flatMap((m) => m.sightings);
const by = (h) => records.filter((s) => s.handle === h);

// every sighting carrying an address: the numbers that can mark an account read only these
const calls = records.filter((s) => s.address);

assert.equal(by("caller1").length, 1, "an address the author wrote is a call");
assert.equal(by("caller1")[0].address, CA.toLowerCase());
assert.equal(by("caller1")[0].verdict, "FAIL", "the verdict reached for it is stored with it");

assert.equal(
  by("quoter").length,
  0,
  "quoting someone else's contract is not posting it - charging the quoter is the $DOGGIE bug again",
);
assert.equal(by("scammer").length, 0, "and the quoted account is not credited either: they are not in this feed");

// A bare ticker is recorded, and it is NEVER a call. The distinction is the whole point: a
// page of real timeline is mostly tickers, so dropping them made the graph stay empty and a
// profile scan report reading eighty-seven posts and finding nothing - but letting one reach
// `calls` would put a mark on every finance account on the timeline.
const news = by("newsaccount");
assert.equal(news.length, 1, "a bare ticker is now recorded...");
assert.equal(news[0].ticker, "TSLA", "...as a mention of that ticker");
assert.equal(news[0].address, undefined, "...with no address, so nothing downstream reads it as a call");
assert.ok(calls.every((s) => !s.ticker), "and nothing with an address is ever filed as a mention");

assert.equal(by("solcaller").filter((s) => s.address).length, 1, "a Solana mint the author wrote is a call");
assert.equal(by("solcaller").find((s) => s.address).address, MINT, "and it keeps its base58 casing");
assert.equal(by("solcaller").find((s) => s.address).symbol, "PUMP", "carrying the verdict the worker reached for it");

assert.equal(by("solquoter").length, 0, "quoting a mint is not calling it either");
assert.equal(calls.length, 2, "exactly two CALLS from five posts, which is what can accuse anyone");

// ---- the wallet question follows the same rule ----
// "Did this account's wallet buy before the post" is asked about the author of the mint and
// nobody else: asking it of an account that only quoted the contract would set their wallet
// against a call they never made.
const stakes = sent.filter((m) => m.type === "stake");
assert.equal(stakes.length, 1, "one mint written by its author, one question");
assert.equal(stakes[0].handle, "solcaller");
assert.equal(stakes[0].mint, MINT);
assert.ok(Number.isFinite(stakes[0].postedAt) || stakes[0].postedAt === null, "carrying the post's own time, or saying there is none");

console.log("attribution: ok");
