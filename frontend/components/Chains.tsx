// What it reads, and - the part nobody else says out loud - what each chain is allowed to
// claim.
//
// This section exists because the honest answer is uncomfortable and saying it is the whole
// pitch. On Robinhood Chain the issuer publishes the true address, so "that is not Tesla" is
// a fact. Nowhere else has that. Every other chain is a curated list, and a list is weaker in
// both directions: being on it is a vouch, being off it proves nothing at all.
//
// A tool that renders those two claims identically is lying, and being right about the fakes
// it does catch will not save it once people notice.

const CHAINS = [
  {
    name: "Robinhood Chain",
    id: "4663",
    reads: "Full contract lane plus the issuer's own registry: source, mint selectors, ownership, deployer history, and a simulated transfer out of a real holder's wallet.",
    tier: "registry",
    home: true,
  },
  { name: "Ethereum", id: "1", reads: "Identity, curated lists, and whether it wears the name of a token that lives elsewhere.", tier: "list" },
  { name: "Base", id: "8453", reads: "Identity, curated lists, cross-chain name.", tier: "list" },
  { name: "Arbitrum One", id: "42161", reads: "Identity, curated lists, cross-chain name.", tier: "list" },
  {
    name: "BNB Chain",
    id: "56",
    reads: "Identity and lists. No public Blockscout instance exists for this chain, so source, creator and holders stay unresolved rather than being faked from somewhere else.",
    tier: "list",
  },
  {
    name: "Solana",
    id: "SPL",
    reads: "Mint authority, freeze authority, transfer hooks, transfer fees and Token-2022 metadata - read from the mint account itself.",
    tier: "list",
  },
];

export default function Chains() {
  return (
    <section className="chains" id="chains">
      <div className="fhead">
        <h2>Six chains, and what each one can actually prove</h2>
        <small>every endpoint public, keyless and batched - there is no API key anywhere in this repo</small>
      </div>

      <div className="chain-grid">
        {CHAINS.map((c) => (
          <div className={`chain${c.home ? " chain-home" : ""}`} key={c.name}>
            <div className="chain-head">
              <b>{c.name}</b>
              <code>{c.id}</code>
              <span className={`tier tier-${c.tier}`}>{c.tier}</span>
            </div>
            <p>{c.reads}</p>
          </div>
        ))}
      </div>

      <div className="tiers">
        <div className="tier-card">
          <b>registry</b>
          <p>
            The issuer publishes which address is real. Impersonation is <b>provable</b>, and the
            extension is allowed to say so. Only Robinhood Chain qualifies.
          </p>
        </div>
        <div className="tier-card">
          <b>list</b>
          <p>
            Curated token lists only. A collision is reportable - <i>this calls itself USDC and
            the list says USDC here is a different address</i> - but nothing can be called a fake,
            because no list is authoritative about what the real one is.
          </p>
        </div>
      </div>

      <p className="chain-note">
        <b>Being absent from a list is never a warning.</b> Every token is unlisted on the day it
        launches and most legitimate ones stay unlisted forever. Treating absence as a finding is
        the fastest way to build a tool that cries wolf on every new launch, so it is reported as
        <i> unresolved</i> and nothing more.
      </p>

      <div className="xchain">
        <b>An <code>0x</code> address is not a token. It is a slot number every EVM chain has.</b>
        <p>
          The same forty characters can be a stablecoin on one chain, a honeypot on another and
          empty on a third, and the post that pasted it rarely says which. So the panel asks all
          of them at once. <i>&ldquo;USDT on Ethereum only&rdquo;</i> ends the question.{" "}
          <i>&ldquo;Deployed on 3 chains under different symbols&rdquo;</i> starts a better one.
        </p>
      </div>
    </section>
  );
}
