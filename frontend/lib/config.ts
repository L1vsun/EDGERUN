// Single source for the values the coder brief requires be "trivial to drop
// in from one config/env variable, not scattered across multiple files."
// Set these as env vars at build time (see ../.env.example and ../DEPLOY.md).
// The token isn't deployed yet, so these default to visible placeholders
// rather than silently rendering blank.

export const TOKEN_TICKER = process.env.NEXT_PUBLIC_EDGERUN_TICKER || "$EDGERUN";

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_EDGERUN_CONTRACT_ADDRESS || "";

// Every "buy" button on the site resolves through here. Once the contract
// address is set, buying goes to the token's Pons launchpad page; before
// that there is no link at all and the buttons render a pre-launch state
// instead of pointing somewhere useless.
export const PONS_LAUNCHPAD_BASE =
  process.env.NEXT_PUBLIC_PONS_LAUNCHPAD_BASE || "https://www.ponsfamily.com/launchpad";

const DEX_URL_OVERRIDE = process.env.NEXT_PUBLIC_EDGERUN_DEX_URL || "";

export function buyUrl(): string {
  if (DEX_URL_OVERRIDE) return DEX_URL_OVERRIDE;
  if (CONTRACT_ADDRESS) return `${PONS_LAUNCHPAD_BASE.replace(/\/$/, "")}/${CONTRACT_ADDRESS}`;
  return "";
}

export const DEX_URL = buyUrl();

// Base URL of the FastAPI backend (see ../backend). Must be reachable from
// the browser — set to your deployed backend's public URL. Static export
// (GitHub Pages) cannot run this backend itself.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8811";

export const GITHUB_REPO_URL = process.env.NEXT_PUBLIC_GITHUB_REPO_URL || "";
