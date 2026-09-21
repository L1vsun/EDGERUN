# Screenshots used on the site

`components/Shots.tsx` picks these up by filename and shows a labelled placeholder for any
that are missing, so a absent file never renders as a broken image.

| file | what to capture |
|---|---|
| `x-fake.jpg` | a post on x.com naming a ticker and a contract, with the red badge under the text |
| `x-ticker.jpg` | a post with a `$TICKER`, panel open, showing what that ticker resolves to |
| `explorer.jpg` | robinhoodchain.blockscout.com token page with the EDGERUN panel at the top |
| `dexscreener.jpg` | dexscreener.com/robinhood/<pair> with the badge next to the ticker |

Capture at 2x and crop tight. Save as **JPEG, ~1500px wide, quality 82**: these are dense UI
screenshots and PNG costs three to five times as much for no visible gain. Every visitor pays
for this page, and GitHub Pages' bandwidth is what caps launch day.

**Crop out anyone's identity.** Avatar, display name and handle come off before a capture of
a real post goes on the site - the badge and the post text are the evidence, whose post it was
is not, and a real account does not need to appear in someone else's marketing.
