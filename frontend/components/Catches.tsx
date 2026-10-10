import { asset } from "@/lib/config";

// What it catches, as four pictures and four sentences.
//
// Each card is one finding the extension can put under a post or beside a token, and each
// says in plain words where the fact comes from - because two of them are an index's record
// rather than something read off the chain, and a page that hid that would be selling more
// than the product does.

const CARDS = [
  {
    art: "receipt",
    ground: "pink",
    where: "Under the post, on X",
    title: "He posted it. His wallet sold it.",
    text: "When a public index knows which wallet belongs to the account, EDGERUN puts that wallet's trades under the post: how long before the post it bought, and how much it has sold since.",
    source: "The wallet-to-account link and the trades are the index's record. Most accounts have no wallet on file, and then nothing is drawn.",
  },
  {
    art: "strings",
    ground: "ink",
    where: "The largest holders",
    title: "Five wallets. One paid for all of them.",
    text: "It reads who first funded each of the largest holders. Wallets paid for by one address inside one hour are usually one holder wearing several - unless that address is an exchange, which it checks on the chain before saying anything.",
    source: "Funding records from the index; the exchange test is read from the chain.",
  },
  {
    art: "graves",
    ground: "deep",
    where: "The creator",
    title: "Meet the creator's other tokens.",
    text: "How many tokens the creating wallet has launched, how many made it off the launchpad, whether its best ones still trade - and whether it has already sold its own.",
    source: "The index's count. A launch service that signs for thousands of users is named as one, not blamed as one.",
  },
  {
    art: "coins",
    ground: "bone",
    where: "Which mint",
    title: "Thirteen mints. One ticker.",
    text: "Anyone can mint a second $TICKER in a minute. EDGERUN reads the mint in the post from the chain, says when a listed token already owns that symbol, and when a post names a ticker with no contract, how many mints are wearing it.",
    source: "Read from the chain and two public lists, in your browser.",
  },
];

const ALSO = [
  ["Can it be frozen", "Mint and freeze authority, and every Token-2022 extension that can block, tax or take a transfer."],
  ["Who else pushed it", "Six accounts posting one contract inside eleven minutes is one push, not six finds. It keeps the feed, so it can count."],
  ["What happened after", "An account's past calls, priced from the bar the post landed in. Median, not the best one."],
  ["Five EVM chains too", "The full contract lane on Robinhood Chain, identity on Ethereum, Base, Arbitrum and BNB Chain."],
];

export default function Catches() {
  return (
    <section className="catches" id="catches">
      <div className="sec-head">
        <h2>Four things a scanner cannot tell you.</h2>
        <p>
          A launchpad mint is almost always clean. Supply is fixed, nothing can freeze, the
          scanner says pass. The trick was never in the code - it is in who holds the token
          and who is telling you to buy it.
        </p>
      </div>

      <div className="catch-grid">
        {CARDS.map((c) => (
          <article className={`catch g-${c.ground}`} key={c.art}>
            <div className="catch-art">
              <img src={asset(`/art/${c.art}.webp`)} alt="" width={800} height={800} loading="lazy" />
            </div>
            <div className="catch-copy">
              <span className="tagline">{c.where}</span>
              <h3>{c.title}</h3>
              <p>{c.text}</p>
              <small>{c.source}</small>
            </div>
          </article>
        ))}
      </div>

      <div className="also">
        {ALSO.map(([title, text]) => (
          <div key={title}>
            <b>{title}</b>
            <p>{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
