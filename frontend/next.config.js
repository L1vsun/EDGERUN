/** @type {import('next').NextConfig} */
// output: 'export' makes `npm run build` emit static HTML/CSS/JS into ./out —
// that's what GitHub Pages serves. See ../DEPLOY.md for the full deploy
// steps and why the backend (FastAPI) is NOT part of this static export.
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  // If deploying to a GitHub Pages *project* page (username.github.io/edgerun),
  // this needs to be '/edgerun' (your repo name) — set NEXT_PUBLIC_BASE_PATH at
  // build time (the deploy workflow does this for you) or hardcode it here.
  // Leave unset for a custom domain or a user/org root page.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  trailingSlash: true,
};

module.exports = nextConfig;
