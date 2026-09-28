// The account line under a post.
//
// This is the half a scanner cannot produce: not "is this contract real" but "who handed it
// to you, and did several people hand it to you at once". The record was always being kept -
// it was shown on a tab in the side panel, which is not where the decision happens.
//
// The tests that matter most here are the ones asserting SILENCE. An account line under every
// post is the noise that teaches people to stop reading badges, and this codebase has shipped
// that mistake before (a bare ticker badging every finance post).
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ctx = { globalThis: {}, console, window: {}, document: { documentElement: {} }, MutationObserver: class {}, IntersectionObserver: class {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../shared/detect.js", import.meta.url), "utf8"), ctx);
const { decideAccount, spanText } = ctx.EDGERUN;

const A = "0xaaa0000000000000000000000000000000000001";
const caller = (over = {}) => ({ handle: "someone", display: "Some One", tokens: 12, flagged: 0, days: 9, ...over });

// ---- silence is the default ----
assert.equal(decideAccount({}), null, "no caller, no cluster, nothing to say");
assert.equal(decideAccount({ caller: caller({ tokens: 0, flagged: 0 }) }), null,
  "an account we have never seen post a contract has no record");
assert.equal(decideAccount({ caller: caller({ tokens: 4, flagged: 0 }) }), null,
  "four clean contracts is not yet a record worth a line under every post");

// ---- a long clean record is worth stating, precisely because most are not ----
let out = decideAccount({ caller: caller({ tokens: 12, flagged: 0, days: 9 }) });
assert.equal(out.tone, "ok");
assert.match(out.lead, /12 contracts over 9 days, none flagged\./);
assert.equal(out.cluster, null);

// ---- one flag speaks, however short the record ----
out = decideAccount({ caller: caller({ tokens: 3, flagged: 1, days: 2 }) });
assert.equal(out.tone, "bad", "one in three is already the bad tier");
assert.match(out.lead, /3 contracts over 2 days, 1 flagged\./);

out = decideAccount({ caller: caller({ tokens: 47, flagged: 9, days: 21 }) });
assert.equal(out.tone, "warn", "9 of 47 is under a third - a warning, not a verdict");
assert.match(out.lead, /47 contracts over 21 days, 9 flagged\./);

// ---- the cluster: the finding no scanner can make ----
const clusters = { [A]: { cluster: { count: 6, spanMs: 11 * 60000, handles: ["a", "b", "c"] } } };
out = decideAccount({ caller: null, clusters, addresses: [A] });
assert.equal(out.tone, "warn", "arriving together is never 'ok'");
assert.match(out.lead, /6 accounts put this contract in your feed inside 11 minutes\./);
assert.equal(out.cluster.count, 6);

// it speaks even when the account itself has no record at all
assert.ok(decideAccount({ clusters, addresses: [A] }), "a cluster does not need the author to be known");

// and a clean author does not soften it
out = decideAccount({ caller: caller({ tokens: 30, flagged: 0 }), clusters, addresses: [A] });
assert.equal(out.tone, "warn");
assert.match(out.lead, /^6 accounts put this contract/, "the time-sensitive finding leads");
assert.match(out.lead, /30 contracts over 9 days, none flagged\.$/, "and the record still follows");

// ---- addresses are matched case-insensitively, because hex is ----
assert.ok(decideAccount({ clusters, addresses: [A.toUpperCase()] }), "0xAAA… and 0xaaa… are one address");

// a cluster on some other contract is not this post's problem
assert.equal(decideAccount({ clusters, addresses: ["0xbbb0000000000000000000000000000000000002"] }), null);

// ---- the loudest cluster leads when a post carries several ----
out = decideAccount({
  clusters: {
    [A]: { cluster: { count: 3, spanMs: 60000 } },
    "0xbbb0000000000000000000000000000000000002": { cluster: { count: 9, spanMs: 120000 } },
  },
  addresses: [A, "0xbbb0000000000000000000000000000000000002"],
});
assert.equal(out.cluster.count, 9);

// ---- spans read as English ----
assert.equal(spanText(0), "under a minute");
assert.equal(spanText(60000), "1 minute");
assert.equal(spanText(11 * 60000), "11 minutes");
assert.equal(spanText(3 * 3600000), "3 hours");

// ---- whose profile is this ----
//
// The profile page is the one surface where an account's whole record is obviously wanted:
// the reader went there to size somebody up. Getting this wrong in the permissive direction
// puts a person-shaped panel on /home and /explore.
const { profileHandleFrom } = ctx.EDGERUN;

assert.equal(profileHandleFrom("/elonmusk"), "elonmusk");
assert.equal(profileHandleFrom("/ElonMusk"), "elonmusk", "handles fold to lowercase, as the graph stores them");
assert.equal(profileHandleFrom("/someone/with_replies"), "someone");
assert.equal(profileHandleFrom("/someone/media"), "someone");
assert.equal(profileHandleFrom("/someone/likes"), "someone");

// a post is not a profile - the feed code owns that page
assert.equal(profileHandleFrom("/someone/status/1234567890"), null);
assert.equal(profileHandleFrom("/someone/followers"), null, "an unknown second segment is not a profile tab");

// reserved paths are not people
for (const p of ["/home", "/explore", "/notifications", "/messages", "/search", "/settings", "/i/bookmarks", "/compose/tweet"]) {
  assert.equal(profileHandleFrom(p), null, `${p} is not an account`);
}

// junk
assert.equal(profileHandleFrom("/"), null);
assert.equal(profileHandleFrom(""), null);
assert.equal(profileHandleFrom(null), null);
assert.equal(profileHandleFrom("/a".repeat(20)), null);
assert.equal(profileHandleFrom("/toolongahandleforx99"), null, "handles are at most 15 characters");
assert.equal(profileHandleFrom("/bad-handle"), null, "a hyphen is not a legal handle character");

// ---- where the profile card can be mounted ----
//
// Two field reports, two different wrong answers, and the second one is the instructive one.
//
// First it was anchored off the UserName element's own parent - inside a component X
// re-renders as the profile hydrates - so it appeared and vanished.
//
// Then it walked UP from the timeline to whichever node was a direct child of the column, on
// the theory that a node between two of the column's own children survives a re-render of
// either. A real profile column has ONE wrapper holding the header, the tab bar and the feed,
// so the walk reached that wrapper and `afterend` put the card BELOW THE ENTIRE PAGE, after
// every post. The theory was about stability and it cost correctness, which is the worse
// trade: removal is already handled by re-mounting, position is not recoverable.
//
// So: no walking. The tab bar is one element, unambiguous, and where a reader looks.
const { profileAnchorIn } = ctx.EDGERUN;

const el = (tag, attrs = {}, kids = []) => {
  const node = {
    tag, attrs, children: kids, parentElement: null,
    matches(sel) {
      if (sel === 'nav[role="navigation"]') return this.tag === "nav" && this.attrs.role === "navigation";
      if (sel === "nav") return this.tag === "nav";
      if (sel === 'section[role="region"]') return this.tag === "section" && this.attrs.role === "region";
      return false;
    },
    querySelector(sel) {
      for (const k of this.children) {
        if (k.matches(sel)) return k;
        const deep = k.querySelector(sel);
        if (deep) return deep;
      }
      return null;
    },
  };
  for (const k of kids) k.parentElement = node;
  return node;
};

// The shape that caused the bug: ONE wrapper holding everything.
const nav = el("nav", { role: "navigation" });
const section = el("section", { role: "region" });
const wrapper = el("div", {}, [el("div", { "data-testid": "UserName" }), nav, section]);
const column = el("div", { "data-testid": "primaryColumn" }, [wrapper]);

let spot = profileAnchorIn(column);
assert.equal(spot.el, nav, "anchored on the tab bar itself");
assert.equal(spot.where, "afterend", "directly under it, where the reader is looking");
assert.notEqual(spot.el, wrapper, "NEVER the wrapper - that is how it ended up below every post");
assert.notEqual(spot.el, column);

// hydrating: feed present, tab bar not yet
spot = profileAnchorIn(el("div", { "data-testid": "primaryColumn" }, [el("div", {}, [section])]));
assert.equal(spot.el, section);
assert.equal(spot.where, "beforebegin", "above the feed, not below it");

// a nav without the role attribute is still the tab bar
spot = profileAnchorIn(el("div", {}, [el("div", {}, [el("nav")])]));
assert.equal(spot.el.tag, "nav");

// nothing recognisable yet is an ANSWER, not a failure: the next mutation tries again, and
// guessing is what put the card at the bottom of the page in the first place
assert.equal(profileAnchorIn(el("div", { "data-testid": "primaryColumn" }, [el("div", { "data-testid": "UserName" })])), null,
  "a profile header alone is not enough to place it");
assert.equal(profileAnchorIn(el("div", {})), null);
assert.equal(profileAnchorIn(null), null);

console.log("account: ok");
