// Which page is about which mint. The Solana token pages put the mint in the path, so the
// whole surface comes down to this one function being right about a URL.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ctx = {
  console, window: {}, location: { hostname: "example.com", pathname: "/" },
  document: { documentElement: {}, body: {}, querySelectorAll: () => [], querySelector: () => null },
  MutationObserver: class { observe() {} }, IntersectionObserver: class {},
  history: { pushState() {}, replaceState() {} }, setInterval: () => 0, setTimeout: () => 0, clearTimeout() {},
};
ctx.window.addEventListener = () => {};
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["../shared/detect.js", "../sites/solana-pages.js"]) {
  vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), "utf8"), ctx);
}
const { mintFromPage } = ctx.EDGERUN;

const MINT = "8xu4aFUUJ1Uq7Vye2Pr5eNyetPm9egNMaEeT4WbApump";

// the explorer
assert.equal(mintFromPage("solscan.io", `/token/${MINT}`), MINT);
assert.equal(mintFromPage("www.solscan.io", `/token/${MINT}`), MINT);
assert.equal(mintFromPage("solscan.io", `/token/${MINT}/holders`), MINT, "a tab of the token page is still the token");
assert.equal(mintFromPage("solscan.io", `/account/${MINT}`), null, "a wallet page is not a token page");
assert.equal(mintFromPage("solscan.io", `/tx/5${"1".repeat(87)}`), null, "nor is a transaction");
assert.equal(mintFromPage("solscan.io", "/"), null);

// the launchpad
assert.equal(mintFromPage("pump.fun", `/coin/${MINT}`), MINT);
assert.equal(mintFromPage("pump.fun", `/${MINT}`), MINT, "the older path with no /coin/");
assert.equal(mintFromPage("pump.fun", "/board"), null);
assert.equal(mintFromPage("pump.fun", `/profile/${MINT}`), null, "a profile is a person, not a token");

// the mint keeps its casing: base58 folded to lowercase is a different address
assert.equal(mintFromPage("solscan.io", `/token/${MINT}`).includes("FUUJ"), true);

// a lookalike host is not the site
assert.equal(mintFromPage("solscan.io.evil.example", `/token/${MINT}`), null);
assert.equal(mintFromPage("notpump.fun", `/coin/${MINT}`), null);
assert.equal(mintFromPage("x.com", `/token/${MINT}`), null, "a site not in the table gets nothing");

// not base58: 0, O, I and l are not in the alphabet, and hex is not a mint
assert.equal(mintFromPage("solscan.io", "/token/0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715"), null);
assert.equal(mintFromPage("solscan.io", "/token/tooshort"), null);

console.log("pages: ok");
