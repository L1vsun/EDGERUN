# Screenshots used on the site

`components/Shots.tsx` picks these up by filename and shows a labelled placeholder for any
that are missing, so a absent file never renders as a broken image.

| file | what it is |
|---|---|
| `product.jpg` | **the hero shot.** Two real captures side by side: the badge in a Dexscreener pair header, and the panel open on the same mint |
| `solana.jpg` | a Solana mint in the panel: the checks, **the launch**, and **who holds it** after *dig deeper* |
| `dexscreener.jpg` | a Dexscreener Solana pair page with the badge next to the ticker |
| `pumpfun.jpg` | a pump.fun coin page with the badge in its fixed corner |

All four were captured on 2026-10-07 from the unpacked 0.5.0 extension running in a real
Chromium, on live pages, for one real mint (`GTiqdugp…`, an unverified token calling itself
PUMP). Nothing in them is staged.

**There is no X shot, on purpose.** A logged-out browser is served a static copy of a post
with none of the app's markup, so the extension has nothing to attach to and no capture was
possible. The two X shots this folder used to carry showed the pre-0.5.0 badge - one of them
a case the code no longer handles that way - and were removed rather than left to describe a
product that has changed. To add one:

1. Signed in to X, with the extension loaded, find or write a post that pastes a mint.
2. Let the badge land under the text. For the hero, click it so the side panel opens and
   expand that row.
3. Capture at **1440x900, 100% zoom, browser language English**. Save as JPEG, ~1500px wide,
   quality 82, and add it to `SHOTS` in `components/Shots.tsx`.

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
