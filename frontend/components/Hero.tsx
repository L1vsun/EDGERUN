import { asset } from "@/lib/config";
import GetExtension from "./GetExtension";
import Mark from "./Mark";

// The first screen says one thing: the post and the wallet behind it can disagree, and this
// is the tool that shows you both.
//
// The two cards beside the mark are drawn the way the extension draws them, but they are
// EXAMPLES and the caption says so. The accounts and numbers in them are made up on purpose:
// a real account with a made-up trade next to it would be an accusation, and a real trade
// needs the real post it was read under - which is what the screenshots further down are for.

export default function Hero() {
  return (
    <section className="first">
      <div className="first-in">
        <div className="first-copy">
          <span className="pill"><i />Free browser extension · Solana first</span>
          <h1>
            The post says buy.<br />
            The wallet says sold.
          </h1>
          <p>
            EDGERUN checks the token in the post you are reading: which mint it really is,
            who paid for its holders, and what the poster&apos;s own wallet did with it. The
            answer lands right under the post.
          </p>
          <div className="first-cta">
            <GetExtension />
            <a className="cta cta-line" href="#catches">See what it catches</a>
          </div>
          <p className="first-note">
            Works on <b>X</b>, <b>pump.fun</b>, <b>Dexscreener</b> and <b>Solscan</b>. No account,
            no server - it runs in your browser.
          </p>
        </div>

        <div className="first-art" aria-hidden="true">
          <img className="first-brain" src={asset("/art/brain.webp")} alt="" width={900} height={900} />

          <div className="sticker s-wallet">
            <span className="s-tag warn">wallet</span>
            <span className="s-say">@caller&apos;s listed wallet bought 4m 12s before this post, sold 61% of it since.</span>
          </div>

          <div className="sticker s-ticker">
            <span className="s-g">?</span>
            <span className="s-body">
              <span className="s-title"><b>$CAT</b><i>Solana</i><em>13 mints</em></span>
              <span className="s-text">13 mints use this symbol, and the post gives no contract.</span>
            </span>
            <span className="s-stamp"><Mark size={11} />EDGERUN</span>
          </div>
        </div>
      </div>
      <p className="first-foot">
        The two cards are examples of what the extension draws. The wallet line appears only when
        a public index has a wallet on file for the account that posted.
      </p>
    </section>
  );
}
