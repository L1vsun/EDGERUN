# Launch checklist

Everything is already wired. At launch you set the contract address in **two**
places and redeploy both halves. Nothing else changes.

---

## Step 1 — Backend (Render) · ~2 min

dashboard.render.com → `edgerun` → **Environment** → add:

```
EDGERUN_CONTRACT_ADDRESS = 0xYourContractAddress
```

Save. Render redeploys automatically.

This starts the price/holders sampler. Without it the chart has nothing to plot.

## Step 2 — Frontend (Netlify) · ~2 min

app.netlify.com → your site → **Site configuration → Environment variables** → add:

```
NEXT_PUBLIC_EDGERUN_CONTRACT_ADDRESS = 0xYourContractAddress
```

Then **Deploys → Trigger deploy → Deploy site**.

`NEXT_PUBLIC_*` values are baked in at build time, so a redeploy is required —
setting the variable alone changes nothing.

## Step 3 — Verify · ~1 min

```
curl https://edgerun.onrender.com/api/token
```

You want `"launched": true` and a `buy_url` ending in your address. Then on the
site: the CA appears in the top bar, "copy CA" works, and every buy button
points at `https://www.ponsfamily.com/launchpad/<your address>`.

That's it. No code changes, no file edits.

---

## Will the chart work? Honestly: partly, at first

Tested on 2026-09-09 by pointing the sampler at a real freshly-deployed token.

| | works at launch? |
|---|---|
| **Holders chart** | **Yes** — holder count is on-chain from block one |
| Buy button → Pons | Yes, immediately |
| CA + copy button | Yes, immediately |
| Market cap / volume | No — same source as price |
| **Price chart** | **Not immediately** |

**Why price is empty at first.** The price comes from Blockscout's
`exchange_rate` field, which is only populated once a price aggregator
(CoinGecko and similar) lists the token. Verified against four real recently
deployed tokens on this chain — every one returned `exchange_rate: null` while
`holders_count` was populated. Established bridged assets like LINK and CBBTC
have prices; new tokens do not.

So for the first hours or days after launch — until an aggregator picks
$EDGERUN up — there is no price to draw. This is a limit of the data source,
not a bug, and no amount of code changes it.

**What the site does about it.** The chart auto-switches to the **holders**
series when no price samples exist, so visitors see a live, real, moving chart
from the first minutes instead of an empty frame. It flips back to price
automatically once price data starts arriving. The price card says "no price
feed yet — holders and supply are tracked from block one" rather than showing
a fake zero.

**Two more things to expect, both normal:**

- The chart needs **two** samples before it can draw a line, and samples are
  taken every 60s. Expect an empty frame for the first couple of minutes.
- Render's free tier has an **ephemeral disk**: the database — chart history,
  the deployer index and the watchtower's event log — is wiped on every deploy
  and on spin-down after inactivity. For history that survives, you need a
  Render persistent disk (paid) or an external Postgres. Worth doing before
  launch if the chart matters to you, because otherwise it restarts from zero
  every time you redeploy.

---

## Want a real price chart on day one?

The only way is to read the price from the DEX pool directly (reserves ratio in
the Pons pair contract) instead of waiting for an aggregator. That needs the
Pons factory/router address on chain 4663, which isn't published anywhere I
could verify. If you can get that address from the Pons team or a deployed
pair, it's a contained change to `backend/app/poller.py` — say the word and
I'll wire it.

---

## Optional at the same time

```
EDGERUN_DEX_URL          # only to send buy links somewhere other than Pons
NEXT_PUBLIC_SITE_URL     # your final domain, so social cards unfurl correctly
CORS_ORIGINS             # add your custom domain when you point one at the site
```
