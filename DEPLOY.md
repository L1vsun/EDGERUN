# Deploying edgerun

## The constraint to know before you start

**GitHub Pages only serves static files — it cannot run the FastAPI backend.**
There's no way around this; GitHub Pages has no server process, no Python runtime, and
no way to run the live-feed poller in the background. So this ships as two separate
deployables:

1. **`frontend/`** — a static-exported Next.js site. This *is* GitHub-Pages-able.
2. **`backend/`** — a FastAPI process that must run somewhere that runs processes:
   Railway, Render, Fly.io, a VPS, a Docker host, etc. All free-tier-friendly options.

The frontend calls the backend over plain HTTPS (`NEXT_PUBLIC_API_BASE`), so once the
backend has a public URL, the GitHub Pages frontend works exactly like a normal
client-side app calling a normal API — there's no coupling beyond that one URL.

## 1. Deploy the backend first

Pick any host that runs a long-lived process (needed for the poller) and exposes one
port over HTTPS. Railway/Render's free tiers both work with zero config beyond:

```
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Set the env vars from `backend/.env.example` — at minimum `CORS_ORIGINS` to your
GitHub Pages origin (`https://<user>.github.io`) once you know it. Note the resulting
public URL, e.g. `https://edgerun-api.up.railway.app`.

## 2. Publish the frontend to GitHub Pages — automated (recommended)

`.github/workflows/deploy-pages.yml` already does the build-and-publish on every push
to `main`. One-time setup:

1. Repo Settings -> Pages -> **Source: GitHub Actions**.
2. Repo Settings -> Secrets and variables -> Actions -> **Variables** tab, add
   `NEXT_PUBLIC_API_BASE` = your backend's public URL from step 1. These are all
   `NEXT_PUBLIC_*` values that end up in the public client bundle anyway, so plain
   repo Variables (not Secrets) are correct here — see the workflow file's header
   comment for the full list of optional ones (`NEXT_PUBLIC_BASE_PATH` for a project
   page, the token CA/DEX URL once launched, etc).
3. Push to `main`. The Actions tab shows the build; once it's green, the Pages URL is
   live (also shown in the deployment's environment link).

Every subsequent push to `main` that touches `frontend/` redeploys automatically —
this is also how you update the token banner's CA/DEX values once the token launches
(set the variables, then push or re-run the workflow manually from the Actions tab).

## 2b. Publish the frontend — manual (fallback, if you'd rather not use Actions)

```
cd frontend
cp .env.example .env.local
# edit .env.local: NEXT_PUBLIC_API_BASE=https://edgerun-api.up.railway.app
npm install
npm run build
```

This produces a static `frontend/out/` directory — `output: 'export'` in
`next.config.js` is what makes `next build` emit plain HTML/CSS/JS instead of needing
a Node server. If deploying to a **project page** (`https://<user>.github.io/<repo>/`,
the default for a repo not named `<user>.github.io`), set `NEXT_PUBLIC_BASE_PATH=/<repo>`
before building — otherwise asset paths 404. Then commit `frontend/out` to a
`gh-pages` branch and point Pages Settings at that branch instead of GitHub Actions.

## 3. Set the token banner values for real, once the token exists

The banner reads `NEXT_PUBLIC_EDGERUN_CONTRACT_ADDRESS` and
`NEXT_PUBLIC_EDGERUN_DEX_URL` at **build time** (they're baked into the static
export). When the token deploys: set both as repo Variables (automated path) or in
your build environment (manual path), then rebuild/republish. There's no other place
in the code these values live — see `frontend/lib/config.ts`.

## Local dev (no deploy needed)

```
# terminal 1 — backend
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8811

# terminal 2 — frontend
cd frontend && npm install && npm run dev
# visit http://localhost:3000, NEXT_PUBLIC_API_BASE defaults to localhost:8811
```

The CLI (`edgerun scan <address>` / `edgerun watch`) needs neither — it talks to
Blockscout/RPC directly:

```
cd edgerun && python -m venv .venv && .venv/bin/pip install -e .
.venv/bin/edgerun scan 0x...
```
