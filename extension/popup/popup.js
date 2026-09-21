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
const DOT = { ok: "#cfff04", warn: "#ffd682", fail: "#ff6b6b", unresolved: "#7e8a6d" };
const VCOLOR = { FAIL: "#ff6b6b", CAUTION: "#ffd682", UNRESOLVED: "#7e8a6d", PASS: "#cfff04", OFFICIAL: "#cfff04" };

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
  out.innerHTML = `<p class="lead">checking…</p>`;
  try {
    const r = await ask({ type: "verdict", address, level: "full" });
    render(r);
  } catch (err) {
    out.innerHTML = `<p class="err">${esc(err.message)}</p>`;
  } finally {
    go.disabled = false;
  }
});

function render(r) {
  const rows = (r.checks || []).map((c) => `
    <div class="row"><i style="background:${DOT[c.status] || "#7e8a6d"}"></i>
      <span><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></span></div>`).join("");
  out.innerHTML = `
    <p class="lead"><span class="v" style="color:${VCOLOR[r.verdict]}">${esc(r.verdict)}</span>
      &nbsp;${esc(r.symbol || "unknown")}</p>
    ${rows}
    <div class="row" style="border:0"><i style="background:transparent"></i>
      <span><button id="w" style="background:none;border:1px solid #2b3529;color:#cbd2ba;">watch</button>
      <a href="${esc(r.explorerUrl)}" target="_blank" style="color:#cfff04;margin-left:8px;">explorer</a></span></div>`;
  document.getElementById("w")?.addEventListener("click", async () => {
    await ask({ type: "watch:toggle", address: r.address });
    loadWatch();
  });
}

async function loadWatch() {
  const list = document.getElementById("watch");
  let items = [];
  try { items = await ask({ type: "watch:list" }); } catch {}
  if (!items.length) {
    list.innerHTML = `<li class="quiet">nothing yet — check a token and hit watch</li>`;
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
