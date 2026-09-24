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

const sent = [];
const ctx = {
  globalThis: {},
  console,
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  window: {}, // no IntersectionObserver: E.whenNear then runs its callback immediately
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
              ? []
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
ctx.EDGERUN.log = () => {};

const CA = "0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715";
const OTHER = "0xa9eFe2Fc94dE79734C03051515F48f254Ce61e18";

ctx.document.kids = [
  // 1. a plain call: the author wrote the address themselves
  post({ handle: "caller1", text: `new one just deployed ${CA}` }),
  // 2. a quote of someone else's call - the contract is in the QUOTED text, not theirs
  post({ handle: "quoter", text: "lol look at this", quoting: { handle: "scammer", text: `buy ${OTHER} now` } }),
  // 3. a ticker with no contract: named something, called nothing
  post({ handle: "newsaccount", text: "$TSLA earnings tomorrow" }),
];

load("../sites/twitter.js");
await new Promise((r) => setTimeout(r, 1200)); // watch debounces 300ms, then the batch 220ms

// ---- what was recorded ----

const records = sent.filter((m) => m.type === "graph:record").flatMap((m) => m.sightings);
const by = (h) => records.filter((s) => s.handle === h);

assert.equal(by("caller1").length, 1, "an address the author wrote is a call");
assert.equal(by("caller1")[0].address, CA.toLowerCase());
assert.equal(by("caller1")[0].verdict, "FAIL", "the verdict reached for it is stored with it");

assert.equal(
  by("quoter").length,
  0,
  "quoting someone else's contract is not posting it - charging the quoter is the $DOGGIE bug again",
);
assert.equal(by("scammer").length, 0, "and the quoted account is not credited either: they are not in this feed");

assert.equal(by("newsaccount").length, 0, "a bare ticker is not a call");
assert.equal(records.length, 1, "exactly one sighting from three posts");

console.log("attribution: ok");
