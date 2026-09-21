# Deploying edgerun

## The constraint to know before you start

**GitHub Pages only serves static files - it cannot run the FastAPI backend.**
There's no way around this; GitHub Pages has no server process, no Python runtime, and
no way to run the live-feed poller in the background. So this ships as two separate
deployables:

1. **`frontend/`** - a static-exported Next.js site. This *is* GitHub-Pages-able.
2. **`backend/`** - a FastAPI process that must run somewhere that runs processes:
   Railway, Render, Fly.io, a VPS, a Docker host, etc. All free-tier-friendly options.

The frontend calls the backend over plain HTTPS (`NEXT_PUBLIC_API_BASE`), so once the
backend has a public URL, the GitHub Pages frontend works exactly like a normal
client-side app calling a normal API - there's no coupling beyond that one URL.

## 1. Deploy the backend first

Pick any host that runs a long-lived process (needed for the poller) and exposes one
port over HTTPS. Railway/Render's free tiers both work with zero config beyond:

```
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Set the env vars from `backend/.env.example` - at minimum `CORS_ORIGINS` to your
GitHub Pages origin (`https://<user>.github.io`) once you know it. Note the resulting
public URL, e.g. `https://edgerun-api.up.railway.app`.

## 2. Publish the frontend to Netlify (recommended - custom domain)

Netlify serves from the domain root, so the `basePath` that a GitHub Pages
*project* page needs (`/EDGERUN`) disappears entirely. `frontend/netlify.toml`
already carries the build config.

1. netlify.com → **Add new site** → **Import an existing project** → GitHub → pick
   the repo.
2. **Base directory:** `frontend`. Build command and publish dir come from
   `netlify.toml` (`npm run build` → `out`); leave them as detected.
3. **Site configuration → Environment variables**, add:
   - `NEXT_PUBLIC_API_BASE` = your Render backend URL (e.g. `https://edgerun.onrender.com`)
   - `NEXT_PUBLIC_GITHUB_REPO_URL` = the repo URL
   - at launch: `NEXT_PUBLIC_EDGERUN_CONTRACT_ADDRESS`, and optionally
     `NEXT_PUBLIC_EDGERUN_TICKER` / `NEXT_PUBLIC_EDGERUN_DEX_URL`
   - **do NOT set `NEXT_PUBLIC_BASE_PATH`** - see the note in `netlify.toml`.
     It exists only for GitHub Pages project pages and will break every asset URL here.
4. Deploy. Then **Domain management → Add a custom domain**, point your DNS at
   Netlify, and let it issue the certificate.

### Then update the backend for the new origin - required

The API refuses cross-origin requests it doesn't know about, so the site will
load but show an empty feed until you do this. On Render → **Environment**:

- `CORS_ORIGINS` = your Netlify origin, e.g. `https://edgerun.xyz`
  (scheme + host, no path, no trailing slash). Comma-separate to keep the old
  Pages origin working during the switchover:
  `https://edgerun.xyz,https://l1vsun.github.io`
- `SITE_URL` = the same Netlify URL - this is the "scan another contract" link
  on shared receipt pages, which otherwise still points at GitHub Pages.

Save and let Render redeploy.

Share links (`/s/<address>`) keep pointing at the Render backend either way -
they have to, since a static host can't render per-address OG tags.

## 2b. Publish the frontend to GitHub Pages - automated

`.github/workflows/deploy-pages.yml` already does the build-and-publish on every push
to `main`. One-time setup:

1. Repo Settings -> Pages -> **Source: GitHub Actions**.
2. Repo Settings -> Secrets and variables -> Actions -> **Variables** tab, add
   `NEXT_PUBLIC_API_BASE` = your backend's public URL from step 1. These are all
   `NEXT_PUBLIC_*` values that end up in the public client bundle anyway, so plain
   repo Variables (not Secrets) are correct here - see the workflow file's header
   comment for the full list of optional ones (`NEXT_PUBLIC_BASE_PATH` for a project
   page, the token CA/DEX URL once launched, etc).
3. Push to `main`. The Actions tab shows the build; once it's green, the Pages URL is
   live (also shown in the deployment's environment link).

Every subsequent push to `main` that touches `frontend/` redeploys automatically -
this is also how you update the token banner's CA/DEX values once the token launches
(set the variables, then push or re-run the workflow manually from the Actions tab).

## 2c. Publish the frontend - manual (fallback)

```
cd frontend
cp .env.example .env.local
# edit .env.local: NEXT_PUBLIC_API_BASE=https://edgerun-api.up.railway.app
npm install
npm run build
```

This produces a static `frontend/out/` directory - `output: 'export'` in
`next.config.js` is what makes `next build` emit plain HTML/CSS/JS instead of needing
a Node server. If deploying to a **project page** (`https://<user>.github.io/<repo>/`,
the default for a repo not named `<user>.github.io`), set `NEXT_PUBLIC_BASE_PATH=/<repo>`
before building - otherwise asset paths 404. Then commit `frontend/out` to a
`gh-pages` branch and point Pages Settings at that branch instead of GitHub Actions.

## 3. Launch day: one variable switches everything on

The contract address is the single switch. Set it in **both** places:

- **Frontend** (repo Variable / build env): `NEXT_PUBLIC_EDGERUN_CONTRACT_ADDRESS`
  - baked in at build time, so rebuild/republish after setting it. This turns on
  the price card, the chart, and points every buy button at
  `https://www.ponsfamily.com/launchpad/<address>`.
- **Backend** (Render env var): `EDGERUN_CONTRACT_ADDRESS` - this starts the price
  sampler, which is what gives the chart data to draw.

Until it's set, the site renders an explicit pre-launch state everywhere (an
"armed" price card, a chart that says it activates at launch, and buy buttons that
say the launchpad opens at launch) rather than dead links or a fake chart.

**Why the backend matters for the chart:** Blockscout serves no price history for a
token (verified - `/api/v2/tokens/{addr}/price-history` returns 404). So the backend
records one real price/holders sample per minute into SQLite, and the chart plots
exactly those samples. The series therefore starts empty at launch and fills in from
there - it can't be backfilled, because that data doesn't exist anywhere to fetch.

Optional overrides: `NEXT_PUBLIC_EDGERUN_DEX_URL` / `EDGERUN_DEX_URL` to send buy
links somewhere other than Pons; `TOKEN_SAMPLE_INTERVAL_SECONDS` and
`TOKEN_HISTORY_MAX_AGE_DAYS` to change sampling cadence/retention.

## Local dev (no deploy needed)

```
# terminal 1 - backend
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8811

# terminal 2 - frontend
cd frontend && npm install && npm run dev
# visit http://localhost:3000, NEXT_PUBLIC_API_BASE defaults to localhost:8811
```

The CLI (`edgerun scan <address>` / `edgerun watch`) needs neither - it talks to
Blockscout/RPC directly:

```
cd edgerun && python -m venv .venv && .venv/bin/pip install -e .
.venv/bin/edgerun scan 0x...
```
