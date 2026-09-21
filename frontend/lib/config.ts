// Single source for the values the coder brief requires be "trivial to drop
// in from one config/env variable, not scattered across multiple files."
// Set these as env vars at build time (see ../.env.example and ../DEPLOY.md).
// The token isn't deployed yet, so these default to visible placeholders
// rather than silently rendering blank.

// ═══════════════════════════════════════════════════════════════════════════
//  PASTE THE CONTRACT ADDRESS HERE WHEN THE TOKEN IS LIVE. That is the only
//  edit required: every buy button, header link and footer on the site reads
//  from it, and each one turns from "soon" into a link to
//  https://www.ponsfamily.com/launchpad/<address> the moment it is filled in.
//  Commit, push, done. An env var of the same name overrides it if you would
//  rather not commit the address.
// ═══════════════════════════════════════════════════════════════════════════
const TOKEN_CONTRACT = "";

export const TOKEN_TICKER = process.env.NEXT_PUBLIC_EDGERUN_TICKER || "$EDGERUN";

export const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_EDGERUN_CONTRACT_ADDRESS || TOKEN_CONTRACT;

/** True once the address above is set: what every "buy" surface switches on. */
export const TOKEN_LIVE = /^0x[0-9a-fA-F]{40}$/.test(CONTRACT_ADDRESS.trim());

// Every "buy" button on the site resolves through here. Once the contract
// address is set, buying goes to the token's Pons launchpad page; before
// that there is no link at all and the buttons render a pre-launch state
// instead of pointing somewhere useless.
export const PONS_LAUNCHPAD_BASE =
  process.env.NEXT_PUBLIC_PONS_LAUNCHPAD_BASE || "https://www.ponsfamily.com/launchpad";

const DEX_URL_OVERRIDE = process.env.NEXT_PUBLIC_EDGERUN_DEX_URL || "";

export function buyUrl(): string {
  if (DEX_URL_OVERRIDE) return DEX_URL_OVERRIDE;
  if (TOKEN_LIVE) return `${PONS_LAUNCHPAD_BASE.replace(/\/$/, "")}/${CONTRACT_ADDRESS.trim()}`;
  return "";
}

export const DEX_URL = buyUrl();

// Base URL of the FastAPI backend (see ../backend). Must be reachable from
// the browser - set to your deployed backend's public URL. Static export
// (GitHub Pages) cannot run this backend itself.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8811";

export const GITHUB_REPO_URL = process.env.NEXT_PUBLIC_GITHUB_REPO_URL || "https://github.com/L1vsun/EDGERUN";

// Where the extension itself is downloaded from until it is in the Chrome Web Store.
export const EXTENSION_URL = process.env.NEXT_PUBLIC_EXTENSION_URL || GITHUB_REPO_URL;

export const GITHUB_USER_URL = "https://github.com/L1vsun";
export const X_URL = "https://x.com/L1vsun";

// Static files in /public are NOT basePath-prefixed automatically for plain
// <img src>, so anything under /public must go through this. Netlify serves
// from the root (empty basePath); a GitHub Pages project page needs /EDGERUN.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function asset(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
