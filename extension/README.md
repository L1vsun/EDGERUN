# EDGERUN - browser extension

Puts a verdict next to the token wherever you already look at it: a post on X, a Dexscreener
pair, a token page on Solscan, pump.fun or Blockscout. The question it answers first is the one
that actually costs people money - **is this the contract it says it is?** - and the one it
answers next is the one no scanner can: **who put it in front of you, and what happened after.**

Solana and five EVM chains. A Solana mint is read in one request; an `0x` address gets the full
contract lane on the one EVM chain where an explorer and an issuer's registry are both wired,
and identity plus curated lists on the others.

## Install (unpacked)

1. Download the repo from https://github.com/L1vsun/EDGERUN (Code → Download ZIP) and unzip it.
2. `chrome://extensions` → enable Developer mode → **Load unpacked** → pick this `extension/` folder.
3. Open any post on X that pastes a Solana mint or a contract address, a Dexscreener pair, or a
   token page on Solscan, pump.fun or Blockscout. No account, no key, nothing to configure.

Chrome 137+ ignores `--load-extension` from the command line unless
`--disable-features=DisableLoadExtensionCommandLineSwitch` is also passed; loading from the
Extensions page is unaffected.

## Architecture: there is no backend

Every check runs in the extension's service worker, against the chains, an issuer's published
registry where one exists, curated token lists and - for launch context on Solana - a keyless
index. The hosted edgerun backend is deliberately **not** in the path. Measured
against it on 2026-09-21:

| | measured |
|---|---|
| cold start (`/api/health`, Render free tier) | **31.6 s** |
| warm uncached scan (`/api/scan/<addr>?force=true`) | **14.1 s** |
| rate limit | **12 requests/minute/IP** |
| batch endpoint | none |
| the stock-token check on the canonical TSLA | **absent from the response** (the deployed build is stale - `/api/impersonators` 404s too, though it exists in `main.py`) |

A badge on a scrolling feed cannot be built on those numbers. Reading the chain directly
instead, the same work takes:

| | measured |
|---|---|
| one address, identity tier | **~200 ms** |
| five addresses, batched | **~206 ms total** (one HTTP round trip) |
| one address, full check | **~6.5-8 s** (explorer latency dominates) |

A service worker with `host_permissions` is also in a *better* position than a web page: no
CORS, and no page CSP on its requests.

## Two tiers

| tier | what it runs | cost | used by |
|---|---|---|---|
| `identity` | the registry + the reference list | one batched RPC call for up to 12 addresses | the X timeline |
| `full` | identity + source verification, mint selectors, ownership, LP lock, and a simulated transfer out of a live holder's wallet | ~2 explorer + ~3 RPC calls | token pages, the side panel, "run full check" |

## Verdicts, and what each is allowed to mean

- **OFFICIAL** - this address is in its issuer's published registry. A fact, not a score.
- **FAIL** - it claims an official asset and is not it, or holders provably cannot move it.
- **CAUTION** - the contract lane found something, or resolved nothing at all.
- **PASS** - the full check ran and found nothing. On an EVM chain, only reachable at the
  `full` tier. On a Solana mint the badge says **mint is clean** instead of "checks pass",
  because a mint scan reads the mint and nothing else, and most rugs never needed the mint.
- **UNRESOLVED** - nothing established yet. An identity-clean token lands here *on purpose*:
  "not impersonating anything" is not "safe", and the badge must never let the first read as
  the second.

There is no path from a failed request to a green badge. A broken upstream is always
UNRESOLVED.

## What a `$TICKER` is allowed to say

A ticker maps to many contracts on every chain. On one EVM chain a ten-ticker sweep found 213
contracts using a registered ticker that were not the registered contract; on Solana a second
`$ANYTHING` costs less than lunch to mint. So a ticker is never resolved to "the" token. It
is compared against a contract the same post hands over, or - when the post hands over none -
answered with the fact that it is shared:

- where an issuer publishes a registry, a post that says **$TSLA** and pastes a contract that
  is not the registered TSLA address is showing you a different token than the one it names.
  Provable from the registry alone, and the one case allowed to say *not the real one*;
- on Solana, a post naming one ticker beside a mint that calls itself something else gets a
  sentence saying exactly that. It never changes the verdict - "`$WIF` is dead, this is next"
  names `$WIF` without claiming to be it;
- **a post with a ticker and no contract** gets one line when at least two Solana mints use
  that exact symbol (`lookupSymbol`, one cached index search per ticker). Quiet, and naming
  the mint, when a list vouches for one; a caution when none does. Never for a currency, never
  for a ticker one mint uses, at most two lines a post, and never beside a contract - with a
  contract in the post, the contract is the answer to "which one";
- a per-chain count on an EVM chain is shown only **beside a contract on that same chain**.
  It used to appear under any post naming the ticker, which under a post about a Solana
  token was a warning about somewhere else entirely.

### Why the feed is built the way it is

Reported from the field on 2026-10-07 as "I scroll and nothing ever appears", and three
things were wrong at once:

1. **The batch was debounced.** A debounce restarts its timer on every call, so while posts
   keep arriving it never fires - and a timeline unmounts a post as it leaves. Throttled now.
2. **Every source was awaited as one group.** A slow explorer held back every badge on the
   screen. Each source is bounded by `E.settle` now, and there are two lanes: a ticker line
   is drawn the moment its lookup lands, without waiting for any chain read.
3. **Mints were read one after another**, each waiting on the index first. They are read
   together, and the chain read starts before the index has answered.

Measured on an X-shaped page served at `x.com` to the real extension, cold, live network:
first line at 2.4 s, contract badges by 5 s, where it had been 6.4 s for anything at all.

A page that outlives an extension reload can no longer reach its worker and used to fail
silently for ever. It now says so in a corner, once, and reloads on a click.

An `0x` address with no contract behind it on the chain that was read gets no badge at all:
it is a wallet, or a token on a chain that pass did not ask. The panel keeps the row, and
*dig deeper* asks the other chains.

## Solana

`lib/solana.js` is a second provider, not a chain-table row. One batched request reads the
mint account (`jsonParsed`) and, for a legacy SPL mint, its Metaplex metadata account - whose
address is derived locally in `lib/metaplex.js` (ed25519 curve test, SHA-256, bump search).
Verified against the live chain 2026-10-07: the derived account for BONK, WIF, USDC and
wrapped SOL each carries its own mint inside it, which is also what is checked before a name
is taken from one.

| read | what it means |
|---|---|
| `mintAuthority`, `freezeAuthority` | who can create supply, who can freeze any account |
| `permanentDelegate` | who can move or burn tokens out of **any** holder's account |
| `defaultAccountState: frozen` | new holders start frozen: receivable, not movable |
| `transferHook` program / authority | code that can reject a transfer, armed or armable |
| `transferFeeConfig` rate / authority | a sell tax, live or switchable |
| `pausableConfig` | all transfers can be paused; `paused: true` is a **fail** |
| `nonTransferable` | cannot be sold at all |
| metadata update authority / `isMutable` | whether the name it compares against is fixed |

A power is always reported and is a warning only on a token no list vouches for - real USDC
holds both authorities and PYUSD carries a permanent delegate by design. Two lists can vouch:
the curated one this extension loads, and Jupiter's verified set.

**Holders, read from the chain on request (`lib/holders.js`).** `solana-rpc.publicnode.com`
blocks `getTokenLargestAccounts` and wants a paid key for `getTokenSupply`; `api.mainnet-beta`
403s an extension origin. Of fifteen public endpoints tried on 2026-10-07 exactly one answers
keyless with CORS: `public.rpc.solanavibestation.com`. It refuses batches and answers a burst
with a 403, so it gets one request and a budget of its own; the two follow-up reads go to
publicnode, batched.

Three requests: the twenty largest token accounts; each one parsed (its owner, its state);
each owner's controlling program. An owner the system program controls is a wallet; any other
is a program's account - a pool, a curve, a locker - and is counted apart. If the third
request fails nothing is called a wallet and no concentration is claimed: guessing "wallet"
is how a bonding curve becomes "one holder owns 80%".

| finding | status |
|---|---|
| one wallet holds half of supply or more, or ten hold four fifths | warn (unvouched) |
| every one of the largest wallet accounts is frozen (3 or more) | **fail** (unvouched) |
| some of the largest accounts are frozen | warn (unvouched) |
| any of the above on a token a list vouches for | reported, never charged |

The total holder *count* still comes from `lib/jupiter.js`, as context, attributed.

### Context from an index (`lib/jupiter.js`)

One keyless request covers a whole batch of mints: launchpad, first-trade time, graduation,
holder count, top-ten share, the wallet the index attributes the mint to and how many others
it counts for that wallet, and the token's own X link. **None of it enters the verdict** except
identity (verified or not, and which verified mints already hold the symbol). It is drawn as
its own block, every row saying whose count it is.

Two hosts, in order - `lite-api.jup.ag` then `api.jup.ag` - because the keyless one has been
announced for retirement and postponed with no date. If both stop answering, every mint is
scanned exactly as it was before the index existed.

The creator wallet is worded as *"Jupiter attributes this mint to"*, never *"the dev is"*: for
one fresh mint, two indexes named two different creators on the same day, and a wallet with
3,648 launches turned out to be a launch tool signing for its users.

### The X link, against the feed

A token names an X account by writing a URL into its metadata. `parseXLink` tells an account
from a single post from a community; `bindingCheck` then asks the only question that tests the
link - has that account ever posted this contract - of the account graph. When the poster is
the account the token names, the feed strip says so, and the call is stored as `own`.

### The deeper read (`readDeep`, undocumented endpoint)

The data behind Jupiter's own token pages (`datapi.jup.ag`) carries what the documented search
does not: bundled buys at launch and the share of supply they held at their peak, holders it
classes as bots, when the creator wallet was first funded, when a Dexscreener profile was
paid for. Keyless, answers an extension - and **undocumented**, so it is asked only on *dig
deeper*, never on the way to a verdict, and expected to stop answering one day. "Bundled" and
"bot" are Jupiter's classifications; each row says so.

### The crowd (`lib/crowd.js`, the same undocumented source)

A launchpad mint passes its scan almost every time, because the mint was never the weapon.
Three more endpoints of `datapi.jup.ag` answer an extension keyless (measured 2026-10-10,
twelve requests back to back, none refused) and are where the rest of the answer is:

| endpoint | what it carries | used for |
|---|---|---|
| `/v1/holders/<mint>` | the hundred largest holders: who first funded each and when, the index's tags (pool, exchange, bundler, sniper, insider), and the accounts it files a wallet under | who paid for the holders; the wallet book |
| `/v1/txs/<mint>?traderAddress=<wallet>` | every trade one wallet made in one token, timed | the wallet line; the creator's own trades |
| `/v1/dev/stats/<wallet>` | how many tokens a creator launched, how many graduated, its best three | the creator's record |

**The wallet line** is the only automatic one. A post by `@handle` carrying a mint the author
wrote themselves asks the worker one question: does the index file a wallet under that handle,
and what did it do in this token. The holder list is read (five-minute cache, `datapi` budget
of 24 a minute), the wallet's trades are read, and `stakeOf(trades, postedAt)` reduces them to
what was held when the post went out and what has been sold since. `stakeLine` turns that into
a sentence and is amber in exactly one case - the wallet held the token at the post and has
sold half or more of it since. A round trip that ended before the post is not "bought before
this post". Tokens that arrived by transfer are invisible to a list of trades, so a holding
the trades do not explain is said as that: *most of it sent to the wallet rather than bought*.

**The book.** The index has no "wallets of @handle" question to ask - fourteen guesses at one
were all 404. The only place an attribution appears is beside a wallet in a holder list. So
every list that is read is also read for names, and the pairs are kept in
`chrome.storage.local` (`book:x`, capped at 4,000 accounts, emptied by *forget everyone*).
Only the index's **X** attribution is used; the same wallet's name on a launchpad or a trading
app is a different namespace.

**Who paid for the holders** is asked for (*dig deeper*). `funderGroups` sorts the largest
fifty wallets by funding time and sweeps a one-hour window per funder, so a payer that also
funded an unrelated wallet two years ago does not stretch the group. A group is a warning at
three wallets holding a twentieth of supply, on a token no list vouches for, **and only when
`isBusy` read the payer as quiet**: its thousand newest signatures, from the chain. A thousand
inside a day is an exchange's withdrawal wallet, a bridge or a bot. The first version of that
test looked at fifty signatures and was wrong in the direction that matters - a distributor
paying for fifty wallets right now looks exactly like an exchange for an hour. If the read
fails the row is stated without colour, and says the payer could not be told apart.

**The creator's record** is asked for too. Past a thousand launches the "creator" is a launch
service signing for its users, and the row says that and stops. Below it: launched, graduated,
this week, its best other tokens marked by whether anybody still trades them, and what the
creator wallet did with this one.

Everything here is worded as the index's record, and none of it is on the path to a verdict.
`readTrades` refuses an answer in which any trade belongs to another wallet: if the index ever
stops honouring the filter, a stranger's trades must not be charged to this one.

### Contracts behind links

`E.textWithLinks` reads a post's `innerText` plus the `textContent` of every link in it, for
the part of a URL the page displays cut short. A link to `dexscreener.com/solana/<id>` is
taken out of the text before mints are looked for - a pair id is not a mint, and their links
are lowercased - and resolved through the worker to the token it trades. **Whether X keeps a
truncated URL's tail in the link's markup could not be checked**: a logged-out visitor is
served a static page with none of the app's markup. If it does not, this adds nothing.

## What happened after (`lib/outcome.js`)

Each recorded call carries the time its post was **written** (the first `<time>` in the
article), not the time it scrolled past. On request, a call is priced:

- **entry** - the close of the bar the post landed in;
- **now** - today's price in the pool the token trades in now;
- **peak** - the highest high after the entry bar.

One request to Dexscreener for the token's pools, one to GeckoTerminal for candles. The frame
is the finest one whose 1000 bars still reach the post. A post made on a bonding curve is
priced on the curve and read against the open pool; a post older than every pool is measured
from the token's first trade and says so (`basis: "first_trade"`); history that merely ran out
gets no number.

Four calls a run, stored on the record, so a second press continues. A rate limit stops the
run and is **not** stored. Nothing here sets an account's tone - somebody warning about a
contract has posted it too.

The same work exposed a bug in the existing chart and tape: both ranked pools by 24h volume,
and a launchpad token that graduated today still shows more volume on its finished curve than
on the pool it trades in (measured: $187k against $35k, the curve holding nothing). Both
pickers now set aside a pool with no liquidity when a pool created after it holds real
liquidity. A rugged pool keeps a few dollars and has no successor, so it still leads.

## What it knows that a contract scan cannot

Four things, none of which come from reading bytecode:

- **The deployer's behaviour.** Not just "what else did this wallet launch" but *what it has
  been calling on this token*. The fake TSLA at `0xD18F5e73…` reads clean as a contract -
  verified source, no mint. Its deployer spent **40 `setBlacklistBatch` and 7 `setBlacklist`
  calls on that token, 47 of its last 50 transactions.** That is an operator blocking buyers
  in bulk, and no bytecode scan will ever show it. On demand, ~4 explorer requests.
- **What *you* have seen before.** The extension is the only witness to your own feed, so it
  remembers every address and ticker it has shown you: *"this was PASS when you checked it 5
  days ago - it is FAIL now"*, *"you saw $PEPE yesterday pointing at a different contract"*.
  A rug is a sequence, not a single bad contract, and a sequence is only visible to something
  with a memory. Local only; it is never uploaded and there is nowhere for it to go.
- **Which of the colliding contracts people actually hold.** Reporting "7 contracts use
  $PEPE" is honest but leaves you stuck, so the panel can rank them by holder count. Measured
  live: 31,906 / 7,200 / 1,958 / 1,516 / 339 / 26. When one dominates it says so; when two are
  comparable - as here - it reports **contested** rather than picking a winner.
- **A blocklist you can read.** `frontend/public/blocklist.json` in this repo, served from the
  same Pages site, fetched hourly. Each entry carries the evidence that put it there and
  `git log` says who added it. Everyone else in this category ships a list you cannot audit.

Plus **copy proof** - a pasteable reply naming what was claimed, what the contract actually
is, the two strongest measured facts and the explorer link, so nobody has to take our word.

## Design

A sticker: a bone card with a hard ink outline on a hard flat shadow, no blur anywhere. It
sits on other people's pages - X in dark mode, Dexscreener's near black, an explorer's grey -
and nothing else on those pages has a flat pink shadow, so it reads instantly against all
three and is recognisable in a screenshot with the page cropped away, which is how these
lines travel. Every surface carries a small stamp: the mark and the name.

Red, amber and green are verdicts and are never used for decoration. The verdict shows as a
filled label, as the glyph, and - on a fake - as the colour of the shadow the card stands on.
Pink is the brand's and means only "this is EDGERUN".

The brand's ground everywhere else is a gradient, pink running through coral into orange.
On a badge only the pink is used, because coral and orange sit beside the verdict colours and
a card standing on either would read as "fail" or "caution". In the side panel the gradient
is on the controls - the check button, the selected tab, the next action - and nowhere a
verdict is shown.

- **On X the badge is a strip under the post text**, not a chip in the action bar. The action
  bar is cramped, low-contrast and off the eye's path; a warning about a fake contract belongs
  in the reading flow where it cannot be scrolled past.
- **Only a fake gets full volume** - red fill, a two-pulse ring on arrival, then still. Clean
  and unverified results are quieter cards. If everything shouted, nothing would.
- **The panel opens beside the post, never over it.** It goes into the gutter next to the
  post - right if there is room, then left - and only drops below the badge when the window
  is too narrow for either. Opening underneath covered the very post the reader was trying to
  judge, which is backwards for a panel whose job is to comment on it. It also opens with
  only the checks that decided the verdict, and a "+N more checks" line for the rest.
- **The panel is parented to the document root**, not to the badge. X puts `transform` on
  timeline containers, and `position: fixed` inside a transformed ancestor resolves against
  that ancestor rather than the viewport - which is why the panel used to open half off the
  right edge. It is now positioned from the badge's own rect, clamped to the viewport, flips
  above the badge when there is no room below, follows on scroll, and closes once its badge
  leaves the screen.
- **Fonts are declared on the inner elements**, not just `:host`. A page's own rules outrank
  `:host` rules on the host element, so the host page's font leaks in through inheritance.
  In-page surfaces use the system face; the side panel, which is the extension's own page,
  carries the display face (Bricolage Grotesque, SIL OFL, `sidepanel/fonts/`).
- **The side panel opens before anything is awaited.** `chrome.sidePanel.open()` needs the
  click it was called for, and that survives the hop through `sendMessage` but not an
  `await`: with one storage write in front of it every badge click was answered "may only be
  called in response to a user gesture" and fell back to the in-page window.

## Layout

```
manifest.json            MV3
rules/referer.json       puts a Referer on explorer calls (see below)
background/worker.js     the only code that touches the network
lib/chain.js             batched JSON-RPC, ABI decoding
lib/blockscout.js        explorer v2
lib/registry.js          an issuer's stock-token registry, cached an hour
lib/solana.js            the mint scan: authorities, Token-2022 powers, metadata
lib/metaplex.js          metadata-account derivation and parsing for legacy mints
lib/jupiter.js           launch context for Solana mints, the X link, list vouching
lib/outcome.js           what the price did after a post
lib/holders.js           the largest holders, read from the chain: wallets, pools, frozen
lib/crowd.js             who paid for the holders, the wallet book, one wallet's trades
                         against a post, the creator's record
lib/graph.js             who posted what, when, and whether they arrived together
lib/verdict.js           the checks and the verdict assembly
lib/selectors.js         4-byte selectors, revert tables
lib/known.js             the maintained reference list
lib/budget.js            per-upstream spend caps
shared/detect.js         address/ticker detection, DOM watching, messaging
shared/badge.js          the shadow-DOM badge, the account line, the wallet line
sites/{twitter,dexscreener,solana-pages,blockscout}.js
providers/injected.js    inert - see "transaction interception"
sidepanel/               the side panel: session ledger, paste-an-address,
                         the watchlist and the deployer dossier
```

**Blockscout needs a `Referer`.** It 403s a request that carries none (verified: 403 without,
200 with). A service worker's `fetch` sends none and scripts are forbidden from setting that
header, so `rules/referer.json` puts one back via `declarativeNetRequest`. If that rule ever
stops applying, every explorer call returns 403 - which surfaces as UNRESOLVED, never as a
pass.

**Budgets are counted in HTTP requests, not calls.** A JSON-RPC batch of 48 `eth_call`s is one
request. Caps live in `lib/budget.js` and are held in `chrome.storage.session` so an MV3
worker restart cannot hand out a fresh allowance mid-window. They sit well under the
explorer's own 150-per-window, because that limit is now spent from the user's IP.

## Selector drift is normal maintenance

Host pages change their markup. Two defences, both deliberate:

- **Blockscout** - the address comes from the URL; the badge waits for the real `h1` rather
  than grabbing whatever exists at `document_idle`.
- **Solscan and pump.fun** - the mint is in the path, and the badge goes in a fixed corner. It
  is never threaded into those pages' own markup: nothing here has been anchored against
  their live DOM, and a badge in an obviously separate corner cannot land in the wrong row.
- **Dexscreener** - the URL carries the chain and the *pair*, not the token (on some chains a
  Uniswap v4 pool id, 32 bytes, not an address; on Solana possibly the mint itself, possibly
  lowercased), so whatever is in the path is resolved first and the address the API answers
  with is the one used. The anchor is
  then found by looking for the token's **own ticker** in the top of the page, not by a
  class-name chain - Dexscreener's classes are hashed and change across deploys.

If no anchor is found, the badge goes in a floating panel of its own. Injecting a security
badge into the wrong row is worse than putting it in an obvious corner.

## Transaction interception (feature 3) is scaffolded, not built

`providers/injected.js` exists so the wiring decision is already made: it is the only script
that would ever run in the page's own JS world (`world: "MAIN"`), and nothing else depends on
being there. Two things must be settled before it does anything:

1. **EIP-6963.** Patching `window.ethereum` is no longer enough - wallets announce themselves
   through `eip6963:announceProvider` and a page may use a provider that never touches
   `window.ethereum`.
2. **Trust.** Wrapping a wallet provider is mechanically what a drainer does. Observe only;
   never modify `params`, never delay or block a call, never touch a signature payload.

## Verified, and not

**0.6.0, 2026-10-10.** What was checked:

- 22 plain `node` suites pass. The new one (`crowd.test.mjs`) runs against two real holder
  lists and one real trade list saved from the index that day.
- **The wallet line, end to end in a real Chromium**: the unpacked extension, its real worker
  and the live index, against a timeline carrying X's DOM contract. A post by an account the
  index has a wallet for, carrying a mint that wallet trades, drew the line with its evidence;
  a post by an account it has no wallet for drew nothing. The posts were stand-ins, so no such
  line is shown anywhere as a real one.
- **The side panel opening from a badge click**, in that browser: before the fix every click
  failed with the user-gesture error; after it the panel opened in 22 ms and the row the badge
  pointed at was focused.
- *Dig deeper* in the real `panel.html` on two live mints: funders, exchange tags, the
  creator's record and its own trades all drew, and the chain holder read being refused fell
  back to the index's list, labelled as that.
- The new skin on a live `pump.fun/coin/<mint>`: the corner badge and its window.
- **Not verified: Dexscreener.** It answered the test browser with a "verify you are human"
  page. That wall is meant for automated browsers, so it was not worked around.
- **Not verified: any of this on X's own page**, for the same reason as before.

**0.5.0, 2026-10-07.** What was checked:

- 21 plain `node` suites pass, including the derivation against four real mints.
- **The unpacked extension loaded in a real Chromium (Chrome for Testing 153), driven over
  the DevTools protocol.** On live `pump.fun/coin/<mint>` and `solscan.io/token/<mint>` the
  badge appeared with the right verdict. On a live `dexscreener.com/solana/<lowercased pair>`
  the pair resolved to its mint and the badge appeared - in the floating slot, because the
  page a headless browser is served there is Cloudflare's challenge, so the header anchor on
  the real pair page is still unverified. The real `panel.html`, with the real `chrome.*`
  APIs and the real ledger: a pasted mint scanned, the launch block drew, and *dig deeper*
  read holders from the chain ("one wallet holds 58.3% of supply", the curve drawn as a
  program's account).
- The Solana path (index context -> symbol rivals -> mint scan), run in node against the live
  chain and the live index for nine real mints: USDC, PYUSD and jitoSOL keep their powers
  without a warning; an unverified mint calling itself `PUMP` (4 holders) is flagged as using
  a taken symbol; two launchpad mints under an hour old return launch context, one attributed
  to a wallet with 3,648 launches.
- Call pricing against real pools, including a token that changed pools at graduation.
- **Not verified: X's own page.** A logged-out browser is served a static page with no
  `data-testid` at all. What was run instead is the next best thing: the real extension - its
  manifest-injected content scripts, its real worker, the live chain and index - against a
  timeline carrying X's DOM contract, served at `https://x.com/home` by mapping that host to
  a local server. Ticker lines, pasted mints, a mint inside a shortened link, a lowercased
  Dexscreener link, an absent `0x` address, the account graph and the ledger all behaved.
  Whether X's real markup matches that contract in every detail is the part still unseen. Also not seen: the panel
  inside Chrome's actual side panel (it was opened as a tab), and anything in branded Chrome.

Verified live on 2026-09-21 against Robinhood Chain:

- The engine, run outside a browser against real contracts: official TSLA → OFFICIAL; two
  real clones → FAIL with the official address named. One of them
  (`0xD18F5e73…`, symbol TSLA, name "memestock") is a **honeypot**: the simulated transfer
  reverted `"blacklisted"` for all three live holders. The other (`0x066aD1C8…`, named exactly
  "Tesla • Robinhood Token") blocks *some* holders and not others - a targeted blacklist.
- The real content scripts driven against a timeline with X's DOM contract: four badges, the
  cross-check message correct, the fifth post (no tokens) correctly left alone.
- The panel against a harness with the same transformed ancestors X uses: opens fully on
  screen (`left 126 → right 526` in a 1200px viewport), follows the badge on scroll
  (`top 183 → 33` after 150px), and hides once the badge scrolls away.
- The Blockscout surface on the **live explorer**: badge in the `h1`, one panel, all seven
  checks rendered, no console errors.
- Pair resolution through the real worker for both a v3 pair address and a v4 pool id.

Not verified:

- **The Dexscreener DOM.** The site serves a Cloudflare challenge to headless Chrome, so the
  symbol anchor was tested against a header harness, not the real page. Check it by hand.
- **The `declarativeNetRequest` Referer rule as applied by Chrome.** The requirement is
  verified (403 without, 200 with) and the rule is written for it, but Chrome 153 no longer
  honours `--load-extension`, so it was not exercised in a loaded extension. Load the folder
  by hand and open a token page: if the explorer checks read "the explorer blocked this
  request", that rule is the thing to look at.
- Anything on X's real timeline, for the same reason - the DOM contract it depends on
  (`article[data-testid="tweet"]`, `[data-testid="tweetText"]`, `[role="group"]`) is stable
  and widely relied on, but it was exercised against a harness.
