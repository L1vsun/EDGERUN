// Who gets charged with a contract. Attributing a call to the wrong account is the worst
// thing this feature can do, so the parse is pure and tested away from the DOM.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ctx = { globalThis: {}, console, window: {}, document: { documentElement: {} }, MutationObserver: class {}, IntersectionObserver: class {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../shared/detect.js", import.meta.url), "utf8"), ctx);
const { authorFrom } = ctx.EDGERUN;

// ---- the ordinary case: a User-Name block as X renders it ----
const plain = authorFrom({
  hrefs: ["/someaccount", "/someaccount", "/someaccount/status/1234567890"],
  text: "Some Account\n@someaccount\n·\n2h",
});
assert.equal(plain.handle, "someaccount");
assert.equal(plain.display, "Some Account");

// ---- the href wins, because a display name is whatever someone typed ----
// Someone whose display name is "@elonmusk" must not be recorded as Elon Musk.
const spoofed = authorFrom({
  hrefs: ["/realaccount"],
  text: "@elonmusk\n@realaccount\n·\n1m",
});
assert.equal(spoofed.handle, "realaccount", "the profile link is the identity, not the text");

// ---- no href: the LAST @ in the block is the handle, the display name comes first ----
const textOnly = authorFrom({ text: "@elonmusk parody\n@notelon\n·\n5m" });
assert.equal(textOnly.handle, "notelon", "the display name's @ is not the handle");
assert.equal(textOnly.display, null, "a display name that starts with @ is not kept");

// ---- absolute URLs, both domains ----
for (const href of ["https://x.com/someone", "https://twitter.com/someone", "https://www.x.com/someone/"]) {
  assert.equal(authorFrom({ hrefs: [href], text: "" }).handle, "someone", href);
}

// ---- X's own routes sit at profile depth and are not people ----
assert.equal(
  authorFrom({ hrefs: ["/i/status/1", "/home", "/realone"], text: "Real One\n@realone" }).handle,
  "realone",
  "/i and /home are skipped, not taken as accounts",
);
assert.equal(authorFrom({ hrefs: ["/settings"], text: "" }), null);

// ---- status links are not profiles ----
assert.equal(authorFrom({ hrefs: ["/someone/status/1890"], text: "" }), null,
  "a link two segments deep is a post, not an account");

// ---- junk ----
assert.equal(authorFrom({}), null);
assert.equal(authorFrom({ hrefs: [], text: "" }), null);
assert.equal(authorFrom({ hrefs: [null, undefined], text: "no handle here" }), null);
assert.equal(authorFrom({ hrefs: ["/waytoolongahandleforx"], text: "" }), null,
  "16+ characters was never a valid handle");
assert.equal(authorFrom({ text: "email me at name@example.com" })?.handle, "example",
  "a bare text parse is best-effort; this is why the href is preferred");

// ---- case is folded on the way in, so one account is one record ----
assert.equal(authorFrom({ hrefs: ["/SomeAccount"], text: "" }).handle, "someaccount");

console.log("author: ok");
