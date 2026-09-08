// Single source for the values the coder brief requires be "trivial to drop
// in from one config/env variable, not scattered across multiple files."
// Set these as env vars at build time (see ../.env.example and ../DEPLOY.md).
// The token isn't deployed yet, so these default to visible placeholders
// rather than silently rendering blank.

export const TOKEN_TICKER = process.env.NEXT_PUBLIC_EDGERUN_TICKER || "$EDGERUN";

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_EDGERUN_CONTRACT_ADDRESS || "";

export const DEX_URL = process.env.NEXT_PUBLIC_EDGERUN_DEX_URL || "";

// Base URL of the FastAPI backend (see ../backend). Must be reachable from
// the browser — set to your deployed backend's public URL. Static export
// (GitHub Pages) cannot run this backend itself.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8811";

export const GITHUB_REPO_URL = process.env.NEXT_PUBLIC_GITHUB_REPO_URL || "";
