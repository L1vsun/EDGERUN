// Runs before first paint, from <head>, so a dark-theme reader never sees a white flash.
// localStorage because it is synchronous - chrome.storage is a promise and would paint first.
// Light is the default when nothing is stored.
try {
  document.documentElement.dataset.theme = localStorage.getItem("edgerun.theme") || "light";
} catch {
  document.documentElement.dataset.theme = "light";
}
