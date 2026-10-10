# Screenshots used on the site

`components/Shots.tsx` picks these up by filename and shows a labelled placeholder for any
that are missing, so an absent file never renders as a broken image.

| file | what it is |
|---|---|
| `pumpfun.jpg` | a pump.fun coin page with the badge in its fixed corner and its window open beside it |
| `panel.jpg` | the same mint in the side panel: the checks and **the launch** |
| `creator.jpg` | the panel after *dig deeper*: **who paid for the holders** and **the creator** |
| `receipt.jpg` | a finding drawn as a receipt by the extension itself - the picture the *receipt* button makes |

The three captures were taken on 2026-10-10 from the unpacked 0.6.0 extension running in a
real Chromium, on a live page, for one real mint (`HnXDnwTa…`, an unlisted token calling
itself Fartcoin), and the receipt was drawn the same day by 0.7.0 for the same mint. Nothing
in them is staged. The pump.fun capture is cropped to the token's own
column so that no other user's name is in frame.

**There is no X shot and no Dexscreener shot, and both are owed.**

- X: a logged-out browser is served a static copy of a post with none of the app's markup,
  so the extension has nothing to attach to. It has to be captured signed in.
- Dexscreener: on the day these were taken the site answered an automated browser with a
  "verify you are human" page. That is a wall meant for exactly this, so it was not worked
  around. An ordinary browser gets the page.

To add either one:

1. With the extension loaded, open the page in your everyday browser. For X, find or write
   a post that pastes a mint and let the lines land under the text.
2. Capture at **1440x900, 100% zoom, browser language English**.
3. Save as JPEG, ~1500px wide, quality 84, and add it to `SHOTS` in `components/Shots.tsx`.

Use your own post. Crop out any other account's avatar, name or handle - the wallet line
names the account it is about, so for that one use a post you are happy to show.

---

The grid is a masonry layout, so a shot keeps its own proportions - a tall side panel and a
wide in-feed badge both sit correctly without being cropped or letterboxed.

Capture at 2x and crop tight. Save as **JPEG, quality 84**: these are dense UI screenshots
and PNG costs three to five times as much for no visible gain.
