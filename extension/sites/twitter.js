// X / Twitter: a badge on any post that hands over a contract - a Solana mint or an 0x
// address - and a record of which account handed it over.
//
// The timeline is virtualised - posts are unmounted as they scroll away and remounted when
// they come back - so every article is tagged the moment it is first seen and never
// processed twice. Nothing is read until a post is near the viewport, and every address
// found in a scroll batch is resolved in one message to the worker, which answers the whole
// batch from the registry plus a single JSON-RPC round trip.
//
// Two checks matter here and neither needs a backend. The cross-check: a post that names one
// token and pastes the contract of another is showing you a different token than the one it
// names. And the account: who posted it, what else they have posted, whether the token's own
// metadata claims this very account, and - once asked - what the price did after each call.
// The second is the half no scanner can produce, because it requires having been in the feed.

(() => {
  const E = globalThis.EDGERUN;
  if (!E || window.__edgerunX) return;
  window.__edgerunX = true;

  const SEEN = "data-edgerun-seen";
  const RANK = { FAIL: 4, CAUTION: 3, OFFICIAL: 2, PASS: 2, UNRESOLVED: 1 };
  const pending = new Map(); // article -> { addresses, tickers }

  const tweets = () => document.querySelectorAll(`article[data-testid="tweet"]:not([${SEEN}])`);

  function textOf(article) {
    // The whole article in one read: the post, any quoted post, link-card text - and the full
    // text of its links, which is where a contract hides when a URL is displayed cut short.
    // Images and video are out of scope for this version by design.
    return E.textWithLinks(article);
  }

  // Dexscreener links already resolved to the token they are about, kept for the page's life:
  // a pair id in a post is not an address, so attribution has to go through this to know that
  // the mint under a post is one its author linked.
  const pairMints = new Map();

  /**
   * The account that posted this, not the one being quoted.
   *
   * A quoted post is a second User-Name block nested inside the same article, so the first
   * one in document order is the author and the rest are other people. That distinction is
   * the whole ball game here: charging someone with a contract that appeared in a post they
   * quoted would be exactly backwards.
   */
  function authorOf(article) {
    const block = article.querySelector('[data-testid="User-Name"]');
    if (!block) return null;
    const hrefs = [...block.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
    return E.authorFrom({ hrefs, text: block.innerText || "" });
  }

  /**
   * When the post was written, and its id.
   *
   * The first <time> in an article is the post's own - a quoted post carries its own, later
   * in document order, for the same reason the first User-Name is the author. It sits inside
   * the permalink, which is where the id comes from.
   *
   * This is what "what happened after" is measured from. The moment a reader scrolled past is
   * not when the call was made: a profile opened today surfaces posts from last month.
   */
  function postOf(article) {
    const time = article.querySelector("time[datetime]");
    if (!time) return {};
    const postedAt = Date.parse(time.getAttribute("datetime") || "");
    const href = time.closest("a[href]")?.getAttribute("href") || "";
    const id = /\/status\/(\d+)/.exec(href)?.[1] || null;
    return { postedAt: Number.isFinite(postedAt) ? postedAt : null, post: id };
  }

  // Throttled, not debounced - the same mistake `E.watch` once made, in the one place it was
  // still being made. A debounce restarts its timer on every call, so while a reader keeps
  // scrolling and posts keep arriving it never fires; and a timeline unmounts a post as it
  // leaves, so by the time the scrolling paused the posts it was holding answers for were
  // gone. Reported from the field as "I scroll and no badge ever appears".
  const flush = E.throttle(async () => {
    if (!pending.size) return;
    const batch = new Map(pending);
    pending.clear();

    // A linked pair page is a contract too. Each is resolved to its token once, and the mint
    // joins the post's own list before anything is scanned.
    const pairIds = [...new Set([...batch.values()].flatMap((v) => v.pairs || []))].filter((id) => !pairMints.has(id)).slice(0, 3);
    await Promise.all(pairIds.map(async (pairId) => {
      try {
        const pair = await E.settle(E.ask({ type: "pair", pairId, chain: "solana" }), null, 5000);
        pairMints.set(pairId, pair?.baseToken || null);
      } catch {
        pairMints.set(pairId, null); // not a pair anybody knows: nothing to say, and not asked again
      }
    }));
    for (const found of batch.values()) {
      for (const id of found.pairs || []) {
        const mint = pairMints.get(id);
        if (mint && !found.mints.includes(mint)) found.mints.push(mint);
      }
    }

    const addresses = [...new Set([...batch.values()].flatMap((v) => v.addresses))];
    const candidates = [...new Set([...batch.values()].flatMap((v) => v.mints || []))];

    // Who wrote each post in this batch. Gathered here rather than in render() so the whole
    // screen's worth of records comes back in one message instead of one per post.
    const authors = new Map();
    for (const [article] of batch) {
      const author = authorOf(article);
      if (author) authors.set(article, author);
    }
    const handles = [...new Set([...authors.values()].map((a) => a.handle))];

    // ---- three kinds of post, because they have very different costs ----
    //
    // A post with no contract can only ever get a line about a ticker: one cached index
    // lookup. A post with a Solana mint needs a chain read. A post with an 0x address needs a
    // different chain and, sometimes, an explorer search per ticker. Awaiting all of that as
    // one all-or-nothing group made the cheapest answer wait for the dearest - one slow
    // explorer held back every badge on the screen, including the ones about another chain.
    // A post that waits does not wait: it scrolls away, and the timeline unmounts it.
    //
    // So every source is asked once, bounded, and each post is drawn the moment the sources
    // IT needs have landed. What has not answered in time is left out of that pass.
    const isBare = (v) => !v.addresses.length && !(v.mints || []).length;
    const groups = { bare: [], solana: [], evm: [] };
    for (const entry of batch) {
      const found = entry[1];
      (isBare(found) ? groups.bare : found.addresses.length ? groups.evm : groups.solana).push(entry);
    }

    // Tickers in posts that hand over no contract. Currencies are left out: "ape with $SOL"
    // names what is being paid.
    const bare = [...new Set(groups.bare.flatMap(([, v]) => v.tickers))].filter((t) => !E.isCurrency(t)).slice(0, 6);
    // The issuer registry and the per-chain ticker count only ever speak beside an EVM
    // contract, so only the tickers in THOSE posts are worth an explorer search.
    const evmTickers = [...new Set(groups.evm.flatMap(([, v]) => v.tickers))];
    const watched = [...addresses, ...candidates];

    const symbolsP = bare.length ? E.settle(E.ask({ type: "symbols", tickers: bare }), {}) : Promise.resolve({});
    const verdictsP = addresses.length ? E.settle(E.ask({ type: "verdicts", addresses }), {}) : Promise.resolve({});
    const resolvedP = evmTickers.length ? E.settle(E.ask({ type: "tickers", tickers: evmTickers }), {}) : Promise.resolve({});
    const mintsP = (candidates.length ? E.settle(E.ask({ type: "mints", candidates }), []) : Promise.resolve([]))
      .then((list) => new Map((list || []).map((r) => [r.address, r])));
    // who wrote what is local storage, not a network call
    const callersP = handles.length ? E.settle(E.ask({ type: "graph:callers", handles }), {}, 4000) : Promise.resolve({});
    // mints too: a Solana contract arriving from six accounts is the same finding
    const clustersP = watched.length ? E.settle(E.ask({ type: "graph:tokens", addresses: watched }), {}, 4000) : Promise.resolve({});

    const draw = async (list, pending) => {
      if (!list.length) return;
      const [verdicts, resolved, byMint, callers, clusters, symbols] = await Promise.all(pending);
      for (const [article, found] of list) {
        if (!article.isConnected) continue; // scrolled away and unmounted while we waited
        render(article, found, verdicts, resolved, byMint, authors.get(article), callers, clusters, symbols);
      }
    };
    const none = Promise.resolve({});
    const noMints = Promise.resolve(new Map());
    await Promise.all([
      draw(groups.bare, [none, none, noMints, callersP, none, symbolsP]),
      draw(groups.solana, [none, none, mintsP, callersP, clustersP, none]),
      draw(groups.evm, [verdictsP, resolvedP, mintsP, callersP, clustersP, none]),
    ]);
    const [verdicts, byMint] = await Promise.all([verdictsP, mintsP]);

    // After render, and that ordering is the point: the record shown under a post is the
    // account's record BEFORE this post was counted. "47 contracts, 9 flagged" describes what
    // they had already done when they handed you this one, which is the only version of the
    // sentence that is useful while deciding what to do about it.
    record(batch, verdicts, byMint);
  }, 220);

  /**
   * Log who posted what, for every contract in the batch - including the ones that got no
   * badge.
   *
   * Recording only the flagged ones would make the caller record meaningless: an account's
   * number is "nine of the forty-seven contracts you posted failed", and the forty-seven is
   * half of that sentence. A clean call is still a call.
   *
   * Only contracts count - an 0x address or a resolved Solana mint. A post that says "$TSLA
   * earnings tomorrow" has named a ticker, not made a call, and counting it would turn every
   * finance account on the timeline into a caller.
   *
   * Mints were missed entirely at first: this bailed on `!found.addresses.length` and looped
   * only over addresses, so on a Solana-heavy feed the graph stayed empty while the badges
   * worked fine. Reported from the field 2026-09-24 as "0 accounts after scrolling a lot".
   *
   * And only addresses in the author's OWN text count. The badge reads the whole article -
   * quoted post, link card and all - because anything on screen can be what the reader acts
   * on. Attribution cannot be that wide: a post quoting a scam carries the scammer's contract
   * in its article text, and charging the quoter with it is the same false-accusation shape
   * as the $DOGGIE bug. The first `tweetText` in an article is the author's own; a quoted
   * post's text is a later one.
   *
   * Known limit: an account warning about a contract has still posted that contract, and
   * nothing here can tell a warning from a shill. The per-contract list in the panel is what
   * a reader checks before believing the headline count.
   */
  function record(batch, verdicts, byMint) {
    const sightings = [];
    for (const [article, found] of batch) {
      // Only mints the worker actually resolved count. `found.mints` are raw base58
      // candidates and most of them are not keys at all.
      const mints = (found.mints || []).filter((m) => byMint.has(m));
      const anything = found.addresses.length || mints.length || found.tickers.length;
      if (!anything || !article.isConnected) continue;

      const author = authorOf(article);
      if (!author) continue;
      const own = article.querySelector('[data-testid="tweetText"]');
      if (!own) continue; // media- or card-only post: nothing the author themselves wrote

      const theirs = E.findTokens(E.textWithLinks(own));
      const written = new Set([...theirs.addresses, ...theirs.mints, ...theirs.pairs.map((id) => pairMints.get(id)).filter(Boolean)]);

      // Tickers the author wrote themselves. Counted, never charged - see the note on
      // `recordSightings`. A page of real timeline is mostly this, and dropping it was why a
      // scan could read eighty-seven posts and report finding nothing at all.
      for (const ticker of theirs.tickers.slice(0, 6)) {
        sightings.push({ handle: author.handle, display: author.display, ticker });
      }

      const { postedAt, post } = postOf(article);
      // mints whose own metadata names this author as their X account
      const owned = new Set(E.ownTokens(author, mints.map((m) => byMint.get(m))).map((r) => r.address));

      for (const token of [...found.addresses, ...mints]) {
        if (!written.has(token)) continue; // it came from a quoted post, not from them
        const v = verdicts[token] || byMint.get(token) || null;
        // An 0x address with no contract on the chain that was read is not a call on that
        // chain. Counting it would put a wallet address, or another chain's token, into
        // somebody's record under the wrong chain's name.
        if (v?.absent) continue;
        sightings.push({
          handle: author.handle,
          display: author.display,
          address: token,
          symbol: v?.symbol || null,
          verdict: v?.verdict || null,
          postedAt,
          post,
          chain: byMint.has(token) ? "solana" : null,
          own: owned.has(token),
        });
      }
    }
    if (sightings.length) E.ask({ type: "graph:record", sightings }).catch(() => {});
  }

  /**
   * The author against their own wallet, for the mints they wrote themselves.
   *
   * Asked after the verdicts are drawn and added when it lands, because it is the slowest
   * thing under a post (an index's holder list, then one wallet's trades) and usually has
   * nothing to say: most accounts have no wallet filed under them. Two mints at most - a post
   * listing ten contracts is not ten questions about its author.
   *
   * Same rule as attribution: only a mint in the author's OWN text. A post quoting somebody
   * else's contract has not called it.
   */
  function stakes(article, strips, author, solana) {
    if (!author?.handle || !solana.length) return;
    const own = article.querySelector('[data-testid="tweetText"]');
    if (!own) return;
    const theirs = E.findTokens(E.textWithLinks(own));
    const written = new Set([...theirs.mints, ...theirs.pairs.map((id) => pairMints.get(id)).filter(Boolean)]);
    const { postedAt } = postOf(article);
    for (const r of solana.filter((x) => written.has(x.address)).slice(0, 2)) {
      E.settle(E.ask({ type: "stake", handle: author.handle, mint: r.address, postedAt: postedAt ?? null }), null, 12000).then((stake) => {
        if (!stake || !strips.isConnected) return;
        const strip = E.makeStakeStrip(stake);
        if (strip) strips.append(strip);
      });
    }
  }

  function render(article, found, verdicts, resolved, byMint, author, callers = {}, clusters = {}, symbols = {}) {
    if (article.querySelector('[data-edgerun="badge"]')) return;

    const results = found.addresses.map((a) => verdicts[a]).filter(Boolean);
    const tickers = found.tickers.map((t) => resolved[t]).filter(Boolean);
    const solana = (found.mints || []).map((m) => byMint.get(m)).filter(Boolean);

    // Every decision about what this post gets told lives in detect.js, where it can be
    // tested without a DOM. This function only draws the answers.
    //
    // Answers, plural: a post naming three tokens gets three strips. Picking one and saying
    // "showing the one that matters most" was answering a question nobody asked - somebody
    // who pastes three contracts is talking about three things.
    const found_ = E.decideBadges({
      results,
      official: tickers.filter((t) => t.kind === "official"),
      onchain: tickers.filter((t) => t.kind === "onchain"),
      namedTickers: found.tickers,
      solana,
      symbols: found.tickers.map((t) => symbols[t]).filter(Boolean),
    });

    // Computed before the early return, because it can be the ONLY thing worth saying. Six
    // accounts pushing one contract into a feed inside eleven minutes is a finding even when
    // that contract passes every check there is - and it is the finding a scanner cannot
    // reach, so returning early on "no token badges" would have hidden the whole point.
    const account = E.decideAccount({
      caller: author ? callers[author.handle.toLowerCase()] || null : null,
      clusters,
      addresses: [...found.addresses, ...(found.mints || []).filter((m) => byMint.has(m))],
      // the token's own metadata names the account that is posting it: said even when the
      // account has no record yet, because it is a fact about this post, not about history
      own: E.ownTokens(author, solana),
      handle: author?.handle || null,
    });
    if (!found_.length && !account) return;

    // A strip directly under the post text, not a chip tucked into the action bar. The
    // action bar is cramped, low-contrast and below the fold of the eye's path - a warning
    // about a fake contract has to sit in the reading flow, where it cannot be scrolled past.
    const strips = document.createElement("div");
    strips.setAttribute("data-edgerun", "badge");
    for (const result of found_) {
      const badge = E.makeBadge({
        mode: "block",
        onFull: async (address) => {
          try {
            // a mint has no second tier - its whole scan is one read - so "full" is a re-read
            const full = E.isAddress(address)
              ? await E.ask({ type: "verdict", address, level: "full", fresh: true })
              : await E.ask({ type: "mint", address, fresh: true });
            badge.update(full);
          } catch (err) {
            badge.fail(err.message);
          }
        },
        onWatch: (address) => E.ask({ type: "watch:toggle", address }).catch(() => {}),
      });
      badge.update(result);
      strips.append(badge);
    }

    // The account sits under the verdicts: the contract is what you act on now, the record is
    // the context for it.
    if (account) {
      const strip = E.makeAccountStrip(account, {
        onOpen: (handle) => E.ask({ type: "panel:caller", handle }).catch(() => {}),
      });
      if (strip) strips.append(strip);
    }

    stakes(article, strips, author, solana);

    const text = article.querySelector('[data-testid="tweetText"]');
    const anchor = text?.parentElement?.contains(text) ? text : null;
    if (anchor) {
      anchor.insertAdjacentElement("afterend", strips);
    } else {
      // no post text (a card-only or media-only post): fall back to the action bar row
      const bar = article.querySelector('[role="group"]');
      if (!bar) return;
      bar.insertAdjacentElement("beforebegin", strips);
    }
  }

  /* ---- the profile card, and the cold start it fixes ----
   *
   * The account record is the thing here a server cannot produce, and until now it built up
   * only as a side effect of ordinary scrolling. That made a fresh install look like a plain
   * token checker for the first few days: every badge was about a contract, because there was
   * no history behind any account yet.
   *
   * A profile page fixes both halves at once. It is the one page where showing a whole record
   * is obviously wanted, and it is also a list of exactly the posts needed to build one. The
   * scan below does what a reader would do by hand - scroll their timeline - and lets the
   * existing observer do the recording. Nothing is fetched behind X's back: the same posts,
   * the same detection, the same attribution rules, just without the wrist work.
   */
  let profileFor = null;   // whose card is currently on the page
  let scanning = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Ten seconds. Long enough to read a real slice of a timeline, short enough to sit through. */
  const SCAN_MS = 10000;

  /*
   * How hard to push.
   *
   * There is a real tension here and it is worth naming: X unmounts posts as they leave the
   * viewport, so scrolling FASTER covers more timeline but reads less of it - a post that
   * mounts and unmounts between two ticks is never seen. What makes this survivable is that
   * detection fires on a 600px margin rather than on screen, so a post is picked up before it
   * arrives and stays eligible for a step or two after.
   *
   * 0.8 of a viewport every 450ms is the compromise: about twenty-two screens in ten seconds,
   * with every post spending at least one full tick inside the detection margin.
   */
  const STEP = 0.8;
  const TICK = 450;

  /** Permalinks of the posts currently mounted - the honest way to count what was read. */
  function harvest(into) {
    let added = 0;
    for (const a of document.querySelectorAll('article[data-testid="tweet"] a[href*="/status/"]')) {
      const href = a.getAttribute("href") || "";
      const m = /\/status\/(\d+)/.exec(href);
      if (m && !into.has(m[1])) {
        into.add(m[1]);
        added++;
      }
    }
    return added;
  }

  async function scanProfile({ onProgress, stopped } = {}) {
    if (scanning) return null;
    scanning = true;
    const handle = E.profileHandleFrom(location.pathname);
    const seen = new Set();
    try {
      const until = Date.now() + SCAN_MS;
      let quiet = 0;
      harvest(seen);
      while (Date.now() < until && !stopped?.()) {
        window.scrollBy(0, Math.round(window.innerHeight * STEP));
        await sleep(TICK);
        const added = harvest(seen);
        onProgress?.({ posts: seen.size, left: Math.max(0, until - Date.now()) });
        // Three quiet ticks means the end of the timeline, or a rate limit. Either way there
        // is nothing further down to read, so stop rather than spend the rest of the budget
        // scrolling against a wall.
        if (added === 0 && ++quiet >= 3) break;
        if (added > 0) quiet = 0;
      }

      // The last batch is still in flight: the 220ms flush plus a worker round trip.
      await sleep(700);
      window.scrollTo({ top: 0, behavior: "auto" });
      await sleep(250);
      const record = await E.ask({ type: "graph:caller", handle });
      return { record, posts: seen.size };
    } catch (err) {
      E.log("profile scan failed", err.message);
      return null;
    } finally {
      scanning = false;
    }
  }

  const profileAnchor = () => E.profileAnchorIn(document.querySelector('[data-testid="primaryColumn"]'));

  /*
   * React can pull the card out again while the profile hydrates. Rather than fight that, put
   * it back.
   *
   * Bounded by TIME rather than by a number of attempts, which was the first instinct and the
   * wrong one: a count has to guess how many times React will re-render before it settles,
   * and guessing twelve means giving up on the thirteenth - on exactly the page that needed
   * one more. A window covers the whole hydration burst however many renders that takes, and
   * then stops for good.
   *
   * Past the window nothing is lost. `sweep()` already rebuilds the card from scratch on any
   * later mutation; this observer only exists because it can do the same thing synchronously,
   * without a round trip to the worker, during the one second where the flicker is visible.
   */
  const HEAL_MS = 20000;
  let healer = null;

  function mountCard(card, spot) {
    spot.el.insertAdjacentElement(spot.where, card);
    healer?.disconnect();
    const until = Date.now() + HEAL_MS;
    healer = new MutationObserver(() => {
      if (card.isConnected) return;
      if (Date.now() > until || E.profileHandleFrom(location.pathname) !== profileFor) {
        return void healer?.disconnect();
      }
      const again = profileAnchor();
      if (again) again.el.insertAdjacentElement(again.where, card);
    });
    healer.observe(document.body, { childList: true, subtree: true });
  }

  // The card we built for the profile currently open, kept so putting it back costs nothing.
  let currentCard = null;

  async function profileCard() {
    const handle = E.profileHandleFrom(location.pathname);
    if (handle !== profileFor) {
      healer?.disconnect();
      healer = null;
      document.querySelector('[data-edgerun="profile"]')?.remove();
      currentCard = null;
      profileFor = handle;
    }
    if (!handle) return;

    // Already up and attached: nothing to do.
    if (currentCard?.isConnected) return;

    /*
     * Built once, then pulled out of the tree by a re-render. Put the SAME element straight
     * back, synchronously.
     *
     * The first version had no branch here: a removed card meant building a new one, which
     * meant waiting on the worker for the record first. Every re-render therefore cost a
     * message round trip before anything could reappear, and while that was in flight the
     * page had usually re-rendered again - so the card lost the race repeatedly and read as
     * simply gone. Reusing the element removes the wait entirely.
     */
    if (currentCard) {
      const back = profileAnchor();
      if (back) mountCard(currentCard, back);
      return;
    }

    if (document.querySelector('[data-edgerun="profile"]')) return;

    const spot = profileAnchor();
    if (!spot) return; // the profile has not rendered yet; the next mutation brings us back

    let record = null;
    try {
      record = await E.ask({ type: "graph:caller", handle });
    } catch {
      /* worker asleep or storage blocked: the card still draws, empty and honest */
    }
    if (E.profileHandleFrom(location.pathname) !== handle) return; // navigated away while waiting
    if (document.querySelector('[data-edgerun="profile"]')) return;

    const fresh = profileAnchor();
    if (!fresh) return;

    currentCard = E.makeProfileCard(handle, record, {
      onScan: scanProfile,
      onOpen: (h) => E.ask({ type: "panel:caller", handle: h }).catch(() => {}),
      onAfter: (h) => E.ask({ type: "graph:outcomes", handle: h }),
    });
    mountCard(currentCard, fresh);
  }

  function sweep() {
    profileCard();
    for (const article of tweets()) {
      article.setAttribute(SEEN, "1");
      E.whenNear(article, () => {
        const found = E.findTokens(textOf(article));
        // Mints count here too. Leaving them out of this gate meant a post whose only
        // contract was a Solana mint never entered the batch at all - no scan, no badge, no
        // sighting - which on a pump.fun-shaped feed is most of the posts that matter.
        if (!found.addresses.length && !found.tickers.length && !found.mints.length && !found.pairs.length) return;
        pending.set(article, found);
        flush();
      });
    }
  }

  E.watch(document.body, sweep, 300);

  /*
   * SPA navigation, which mutations alone do not reliably announce.
   *
   * Dexscreener and Blockscout have both used this since they were written; X, the one
   * surface here that is actually a single-page app, was relying entirely on the mutation
   * sweep. Moving between two profiles therefore left whichever card happened to be mounted
   * sitting under the wrong account until something else happened to trigger a sweep.
   */
  E.onRouteChange(() => {
    healer?.disconnect();
    healer = null;
    document.querySelector('[data-edgerun="profile"]')?.remove();
    currentCard = null;
    profileFor = null;
    sweep();
  });
  E.log("x surface active");
})();
