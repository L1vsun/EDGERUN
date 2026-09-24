# Screenshots used on the site

`components/Shots.tsx` picks these up by filename and shows a labelled placeholder for any
that are missing, so a absent file never renders as a broken image.

| file | what to capture |
|---|---|
| `product.jpg` | **the hero shot** - see below. The one image on the first screen |
| `x-fake.jpg` | a post on x.com naming a ticker and a contract, with the red badge under the text |
| `solana.jpg` | a Solana mint in the panel: mint authority, freeze authority, and the token program row |
| `explorer.jpg` | robinhoodchain.blockscout.com token page with the EDGERUN panel at the top |
| `dexscreener.jpg` | dexscreener.com/robinhood/<pair> with the badge next to the ticker |

## `product.jpg` - the one on the first screen

The only screenshot a visitor is guaranteed to see, so it has to carry the whole product in
one frame: a real post on the left, the badge under it, and the **side panel open on the
right**. Not a crop of either half - the two together are the story, and no competing tool
can produce that picture.

1. Post on X yourself: a line naming `$TSLA`, then `0xD18F5e73eC5E2D0b18eBe97426Dc5edC2C887715`.
   A bare `$TICKER` with no address will not produce a badge - that is deliberate, so the post
   has to carry a contract.
2. Let the red badge land, click it so the side panel opens.
3. Expand that row in the panel so the checks are visible.
4. Capture the browser viewport at **1440x900, 100% zoom**, light theme.

Use your own post. Crop out any other account's avatar, name or handle.

---

The grid is a masonry layout, so a shot keeps its own proportions - a tall side panel and a
wide in-feed badge both sit correctly without being cropped or letterboxed. Nothing needs to
match anything else's shape.

Capture at 2x and crop tight. Save as **JPEG, ~1500px wide, quality 82**: these are dense UI
screenshots and PNG costs three to five times as much for no visible gain. Every visitor pays
for this page, and GitHub Pages' bandwidth is what caps launch day.

**Crop out anyone's identity.** Avatar, display name and handle come off before a capture of
a real post goes on the site - the badge and the post text are the evidence, whose post it was
is not, and a real account does not need to appear in someone else's marketing.
