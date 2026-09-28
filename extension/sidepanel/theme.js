// Runs before first paint, from <head>, so a light-theme reader never sees a dark flash.
// localStorage because it is synchronous - chrome.storage is a promise and would paint first.
// Dark is the default when nothing is stored, so the panel opens looking like the mark on
// the toolbar button that opened it.
try {
  document.documentElement.dataset.theme = localStorage.getItem("edgerun.theme") || "dark";
} catch {
  document.documentElement.dataset.theme = "dark";
}
