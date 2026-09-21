// Transaction-time interception — the structure, not the feature.
//
// This file exists now so the wiring decision is already made: it is the only script that
// would ever run in the page's own JS context (`world: "MAIN"`), and nothing else in the
// extension depends on being in that world. Registering it later is a manifest change, not
// a rewrite.
//
// It is deliberately inert. Two things have to be settled before it does anything:
//
//   1. EIP-6963. Patching `window.ethereum` is not enough any more — wallets announce
//      themselves through `eip6963:announceProvider` events and a page may use a provider
//      that never touches `window.ethereum` at all. Any real implementation has to listen
//      for the announcement and wrap each provider it names.
//   2. Trust. Wrapping a wallet provider is, mechanically, what a drainer does. So the rules
//      here are absolute: observe only, never modify `params`, never delay or block a call,
//      never touch a signature payload, and keep this file small enough that a reviewer can
//      read it in one sitting. Anything that cannot be done under those rules does not get
//      done.
//
// What it would watch for, once enabled: `eth_sendTransaction` carrying an `approve()` with
// an unlimited allowance, and a swap whose destination token is not the token the page says
// it is — both cross-checked against the verdict the badge already has for that address.

(() => {
  const TAG = "[edgerun:injected]";

  // The shape the rest of the extension would receive. Nothing calls this yet.
  function report(event) {
    window.postMessage({ source: "edgerun-injected", event }, window.location.origin);
  }

  function providers() {
    const found = [];
    if (window.ethereum) found.push({ info: { name: "window.ethereum" }, provider: window.ethereum });
    window.addEventListener("eip6963:announceProvider", (e) => found.push(e.detail));
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return found;
  }

  // Intentionally unused until the feature is turned on — kept referenced so it cannot rot
  // silently, and so the shape above is the one that ships.
  void report;
  void providers;
  console.debug(TAG, "loaded inert — interception is not enabled in this build");
})();
