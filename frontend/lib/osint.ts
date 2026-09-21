// Who is behind a token — from public records only.
//
// Everything here comes from the block explorer's public API, which sends
// `access-control-allow-origin: *`, so the browser can ask it directly. No key, no
// backend, nothing scraped, nothing private. It is the same paper trail anyone can click
// through by hand on the explorer; this just follows it in one go.
//
// What it does NOT do: read social networks. X's API is paid and cannot be called from a
// page, and scraping it breaks their terms. Any social angle has to come from a proper
// search tool running server-side — see the council.

const BS = "https://robinhoodchain.blockscout.com";
const LIMIT = 150; // the explorer's own per-window budget; we spend ~6 per dossier

export interface Funder {
  address: string;
  when: string;
}

export interface Dossier {
  address: string;
  // the contract itself
  verified: boolean;
  contractName: string | null;
  isScam: boolean;
  reputation: string | null;
  sourceUrls: string[];
  // who put it there
  factory: string | null; // the launchpad, when one was used
  deployer: string | null; // the wallet that actually signed
  deployedAt: string | null;
  // what else that wallet has done
  deployCount: number | null; // "at least this many" — one page of history
  deployCountCapped: boolean;
  firstDeploy: string | null;
  lastDeploy: string | null;
  funders: Funder[]; // who paid for the gas, oldest first
  notes: string[];
  partial?: boolean; // still waiting on the slower endpoints
}

const cache = new Map<string, Dossier>();

// The explorer is behind Cloudflare and 403s a request with no Referer at all. Browsers
// attach one automatically (any origin satisfies it), so nothing needs setting here —
// scripts are not allowed to set Referer anyway.
async function api(path: string, ms = 9000): Promise<any> {
  const stop = AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
  const r = await fetch(`${BS}${path}`, { signal: stop });
  if (!r.ok) throw new Error(`explorer ${r.status}`);
  return r.json();
}

// `onPartial` fires as each record lands: the explorer's transaction lists take several
// seconds, and there is no reason to withhold the contract facts while they load.
export async function investigate(address: string, onPartial?: (d: Dossier) => void): Promise<Dossier> {
  const addr = address.toLowerCase();
  const hit = cache.get(addr);
  if (hit) return hit;

  const d: Dossier = {
    address: addr, verified: false, contractName: null, isScam: false, reputation: null,
    sourceUrls: [], factory: null, deployer: null, deployedAt: null,
    deployCount: null, deployCountCapped: false, firstDeploy: null, lastDeploy: null,
    funders: [], notes: [],
  };

  const info = await api(`/api/v2/addresses/${addr}`).catch(() => null);
  if (!info) {
    d.notes.push("the explorer has no record of this address");
    cache.set(addr, d);
    return d;
  }
  d.verified = !!info.is_verified;
  d.contractName = info.name || null;
  d.isScam = !!info.is_scam;
  d.reputation = info.reputation ?? null;
  d.factory = info.creator_address_hash || null;
  d.partial = true;
  onPartial?.({ ...d });

  // The creator is often a launchpad factory. The wallet that signed the creation
  // transaction is the human, and that is the one worth following.
  const txHash = info.creation_transaction_hash;
  if (txHash) {
    const tx = await api(`/api/v2/transactions/${txHash}`).catch(() => null);
    if (tx) {
      d.deployer = tx.from?.hash || null;
      d.deployedAt = tx.timestamp || null;
      if (d.factory && d.deployer && d.factory.toLowerCase() !== d.deployer.toLowerCase()) {
        d.notes.push("launched through a factory, so the contract itself is boilerplate — judge the wallet, not the code");
      }
      onPartial?.({ ...d });
    }
  }

  const [out, inc, sc] = await Promise.all([
    d.deployer ? api(`/api/v2/addresses/${d.deployer}/transactions?filter=from`).catch(() => null) : null,
    d.deployer ? api(`/api/v2/addresses/${d.deployer}/transactions?filter=to`).catch(() => null) : null,
    d.verified ? api(`/api/v2/smart-contracts/${addr}`).catch(() => null) : null,
  ]);

  if (d.deployer) {
    const items: any[] = out?.items || [];
    if (items.length) {
      const deploys = items.filter((t) => t.method === "deploy" || !t.to);
      d.deployCount = deploys.length;
      d.deployCountCapped = !!out?.next_page_params || items.length >= 50;
      d.lastDeploy = items[0]?.timestamp || null;
      d.firstDeploy = items[items.length - 1]?.timestamp || null;
    }
    const fund: any[] = inc?.items || [];
    d.funders = fund
      .slice(-3)
      .reverse()
      .map((t) => ({ address: t.from?.hash || "?", when: t.timestamp || "" }))
      .filter((f) => f.address !== "?");
  }

  if (sc) {
    const src: string = sc.source_code || "";
    const urls = Array.from(new Set(src.match(/https?:\/\/[\w./\-@:]+/g) || []));
    // links a project put in its own source: a site, a channel, a repo
    d.sourceUrls = urls.filter(
      (u) => !/eips\.ethereum\.org|openzeppelin\.com|solidity|spdx|github\.com\/OpenZeppelin/i.test(u),
    ).slice(0, 5);
  }
  d.partial = false;
  cache.set(addr, d);
  return d;
}

// Plain-language read of the dossier. Same discipline as the on-chain flags: every line
// names the record behind it, and "we cannot tell" is a real answer.
export function readDossier(d: Dossier): { tone: "bad" | "good" | "flat"; text: string }[] {
  const out: { tone: "bad" | "good" | "flat"; text: string }[] = [];
  if (d.isScam) out.push({ tone: "bad", text: "the explorer has flagged this address as a scam" });

  if (d.deployCount !== null && d.deployCount >= 8) {
    const span = d.firstDeploy && d.lastDeploy
      ? ` between ${d.firstDeploy.slice(0, 10)} and ${d.lastDeploy.slice(0, 10)}`
      : "";
    out.push({
      tone: "bad",
      text: `this wallet has launched ${d.deployCountCapped ? "at least " : ""}${d.deployCount} contracts${span} — a production line, not a project`,
    });
  } else if (d.deployCount !== null && d.deployCount <= 2 && !d.partial) {
    out.push({ tone: "good", text: `the deployer has only ${d.deployCount} launch${d.deployCount === 1 ? "" : "es"} on record` });
  }

  if (d.funders.length) {
    const who = d.funders[d.funders.length - 1];
    out.push({
      tone: "flat",
      text: `gas came from ${who.address.slice(0, 10)}…${who.address.slice(-4)} — follow that wallet to find the operator's other launches`,
    });
  }
  if (!d.verified) {
    out.push({ tone: "bad", text: "the contract source is not verified, so nobody can read what it actually does" });
  } else if (!d.deployer) {
    // the factory question is not settled until the creation transaction is read, and
    // claiming either way before then would be a statement we would have to take back
    out.push({ tone: "flat", text: "source is verified — checking whether it came out of a factory" });
  } else if (d.factory && d.factory.toLowerCase() !== d.deployer.toLowerCase()) {
    out.push({ tone: "flat", text: "verified, but it is factory boilerplate — verification says nothing about intent here" });
  } else {
    out.push({ tone: "good", text: "source is verified and was not stamped out by a factory" });
  }
  if (d.sourceUrls.length) {
    out.push({ tone: "flat", text: `links published in the contract source: ${d.sourceUrls.join(" · ")}` });
  }
  if (d.partial) out.push({ tone: "flat", text: "still following the deployer's history…" });
  if (!out.length) out.push({ tone: "flat", text: "nothing on the public record either way" });
  return out;
}

export const EXPLORER_BUDGET = LIMIT;
