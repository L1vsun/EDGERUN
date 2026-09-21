// Who launched this, and what they have been doing with it since.
//
// Two questions a contract scanner structurally cannot answer, both answered from public
// transaction history:
//
//   1. What else has this wallet launched? The trap is that `creator_address_hash` is
//      usually a launchpad factory, not a person — the human is whoever signed the creation
//      transaction, which costs one extra request and is the whole point.
//   2. What has that wallet been *calling* on this token? This turned out to be the
//      stronger signal. The deployer of the fake TSLA honeypot at 0xD18F5e73… spent 40
//      `setBlacklistBatch` and 7 `setBlacklist` calls on its own token — 48 of its last 50
//      transactions. The contract reads clean; the wallet's behaviour does not. That is the
//      operator blacklisting buyers in bulk, and no bytecode scan will ever show it.
//
// Runs on demand only — never per row of a feed — because it spends ~4 explorer requests.

import * as bs from "./blockscout.js";

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);

// Methods that only an owner calls, and that change what holders can do. Matched on the
// decoded method name, so a renamed function slips through — a floor on what we can see,
// never a claim that a quiet wallet is safe.
const CONTROL = /blacklist|blocklist|denylist|ban(?!k)|pause|freeze|lock|setfee|settax|setmaxtx|excludefrom|mint|burnfrom|renounce|transferownership|enabletrading|disabletrading|setrouter|setlimit/i;

export async function deployerTrail(address) {
  const token = String(address).toLowerCase();
  const info = await bs.address(token);
  if (!info) return { error: "the explorer has no record of this address" };

  const out = {
    token,
    factory: info.creator_address_hash || null,
    deployer: null,
    deployCount: 0,
    capped: false,
    firstSeen: null,
    lastSeen: null,
    control: [],        // [{ method, count }] — owner actions aimed at this token
    controlTotal: 0,
    sampled: 0,
    isScam: info.is_scam ?? null,
  };

  const txHash = info.creation_transaction_hash || info.creation_tx_hash;
  if (txHash) {
    const tx = await bs.transaction(txHash).catch(() => null);
    out.deployer = tx?.from?.hash || null;
  }
  if (!out.deployer) {
    out.deployer = out.factory;
    out.deployerIsFactoryFallback = true;
  }
  if (!out.deployer) return out;

  const sent = await bs.addressTransactions(out.deployer, "from").catch(() => null);
  const items = sent?.items || [];
  out.sampled = items.length;
  out.capped = !!sent?.next_page_params || items.length >= 50;
  if (!items.length) return out;

  out.lastSeen = day(items[0]?.timestamp);
  out.firstSeen = day(items[items.length - 1]?.timestamp);

  // a launch is a contract creation: the explorer sets created_contract, and a raw deploy
  // has no `to` at all
  out.deployCount = items.filter((t) => t.created_contract || !t.to).length;

  // what the deployer has been calling on this very token
  const byMethod = new Map();
  for (const t of items) {
    const to = (t.to?.hash || "").toLowerCase();
    if (to !== token || !t.method) continue;
    if (!CONTROL.test(t.method)) continue;
    byMethod.set(t.method, (byMethod.get(t.method) || 0) + 1);
    out.controlTotal++;
  }
  out.control = [...byMethod.entries()].map(([method, count]) => ({ method, count })).sort((a, b) => b.count - a.count);
  return out;
}

/** The trail as checks, each one naming the record it came from. */
export function trailChecks(t) {
  if (t.error) return [{ id: "deployer", label: "deployer", status: "unresolved", detail: t.error }];
  const rows = [];

  if (t.deployer) {
    rows.push({
      id: "deployer", label: "deployer",
      status: "unresolved",
      detail: t.deployerIsFactoryFallback
        ? `${short(t.deployer)} — the creator the explorer records. The creation transaction could not be read, so this may be a launchpad factory rather than a person.`
        : `${short(t.deployer)} — the wallet that signed the creation transaction${t.factory && t.factory.toLowerCase() !== t.deployer.toLowerCase() ? `, launched through the factory at ${short(t.factory)}` : ""}`,
    });
  }

  // the strongest thing here: the operator still steering the token
  if (t.controlTotal > 0) {
    const top = t.control.slice(0, 3).map((c) => `${c.method} ×${c.count}`).join(", ");
    const blacklisting = t.control.some((c) => /blacklist|blocklist|denylist|ban/i.test(c.method));
    rows.push({
      id: "owner_activity", label: "what the deployer does",
      status: blacklisting ? "fail" : "warn",
      detail: blacklisting
        ? `the deployer has called ${top} on this token — ${t.controlTotal} of its last ${t.sampled} transactions. Somebody is being blocked from selling, repeatedly and recently.`
        : `the deployer has called ${top} on this token — ${t.controlTotal} of its last ${t.sampled} transactions. It is still being steered after launch.`,
    });
  }

  if (t.deployCount >= 10) {
    rows.push({
      id: "production_line", label: "production line",
      status: "fail",
      detail: `that wallet deployed ${t.deployCount}${t.capped ? "+" : ""} contracts in its last ${t.sampled} transactions${t.firstSeen ? ` (${t.firstSeen} to ${t.lastSeen})` : ""} — an operation, not a project`,
    });
  } else if (t.deployCount > 0) {
    rows.push({
      id: "production_line", label: "other launches",
      status: t.deployCount > 3 ? "warn" : "unresolved",
      detail: `${t.deployCount} contract deployment(s) among that wallet's last ${t.sampled} transactions${t.firstSeen ? ` (${t.firstSeen} to ${t.lastSeen})` : ""}`,
    });
  } else if (t.sampled) {
    rows.push({
      id: "production_line", label: "other launches",
      status: "unresolved",
      detail: `no contract deployments in that wallet's last ${t.sampled} transactions — it may have launched through a factory, which does not show here`,
    });
  }

  if (t.isScam) rows.push({ id: "explorer_scam", label: "explorer flag", status: "fail", detail: "the block explorer itself has flagged this address as a scam" });
  return rows;
}
