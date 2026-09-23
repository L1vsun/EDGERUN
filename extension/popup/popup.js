// The popup: paste an address, get the full check. Plus the local watchlist.

const ask = (message) =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (reply) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (!reply?.ok) return reject(new Error(reply?.error || "no reply"));
      resolve(reply.data);
    });
  });

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const LEAD = {
  OFFICIAL: "This address is in Robinhood's published registry of tokenised stocks.",
  PASS: "The full check ran and found nothing against it. Not advice, and not a price call.",
  UNRESOLVED: "No claim on an official asset. Nothing else could be established.",
};
const leadFor = (r) =>
  LEAD[r.verdict] || (r.checks || []).find((c) => c.status === "fail")?.detail || "";

const out = document.getElementById("out");
const form = document.getElementById("f");
const input = document.getElementById("q");
const go = document.getElementById("go");

ask({ type: "registry" })
  .then((r) => {
    document.getElementById("reg").textContent = r.loaded
      ? `${r.count} official tokens`
      : `registry unavailable`;
  })
  .catch(() => { document.getElementById("reg").textContent = "registry unavailable"; });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const address = input.value.trim();
  if (!address) return;
  go.disabled = true;
  go.textContent = "checking…";
  out.innerHTML = `<p class="lead" style="padding-top:16px">checking the chain…</p>`;
  try {
    const r = await ask({ type: "verdict", address, level: "full" });
    render(r);
  } catch (err) {
    out.innerHTML = `<p class="err">${esc(err.message)}</p>`;
  } finally {
    go.disabled = false;
    go.textContent = "check";
  }
});

function render(r) {
  const rows = (r.checks || []).map((c) => `
    <div class="row"><i class="${esc(c.status)}"></i>
      <span><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></span></div>`).join("");
  out.innerHTML = `
    <div class="top"><b>${esc(r.symbol || "unknown token")}</b><span class="v ${esc(r.verdict)}">${esc(r.verdict)}</span></div>
    <p class="lead">${esc(leadFor(r))}</p>
    ${rows}
    <div class="acts">
      <button id="w">watch</button>
      <a href="${esc(r.explorerUrl)}" target="_blank" rel="noreferrer">explorer ↗</a>
    </div>`;
  document.getElementById("w")?.addEventListener("click", async (e) => {
    await ask({ type: "watch:toggle", address: r.address });
    e.target.textContent = "watching ✓";
    loadWatch();
  });
}

async function loadWatch() {
  const list = document.getElementById("watch");
  let items = [];
  try { items = await ask({ type: "watch:list" }); } catch {}
  if (!items.length) {
    list.innerHTML = `<li class="quiet">nothing yet - check a token and hit watch</li>`;
    return;
  }
  list.innerHTML = items.map((w) => `
    <li><a href="https://robinhoodchain.blockscout.com/address/${esc(w.address)}" target="_blank">${esc(w.address)}</a>
      <button data-a="${esc(w.address)}">remove</button></li>`).join("");
  list.querySelectorAll("button[data-a]").forEach((b) =>
    b.addEventListener("click", async () => {
      await ask({ type: "watch:toggle", address: b.dataset.a });
      loadWatch();
    }));
}

loadWatch();

// Opening the sidebar from here is the reliable path: a click in an extension page is
// unambiguously a user gesture, where a click on an in-page badge has to survive a hop
// through the worker first.
document.getElementById("side")?.addEventListener("click", async () => {
  const btn = document.getElementById("side");
  if (!chrome.sidePanel?.open) {
    btn.textContent = "unsupported";
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  } catch (err) {
    btn.textContent = "blocked";
    btn.title = String(err?.message || err);
  }
});
