import extensionMeta from "./extension-meta.json";

// Single source for the values the coder brief requires be "trivial to drop
// in from one config/env variable, not scattered across multiple files."
// Set these as env vars at build time (see ../.env.example and ../DEPLOY.md).
// The token isn't deployed yet, so these default to visible placeholders
// rather than silently rendering blank.

// ═══════════════════════════════════════════════════════════════════════════
//  PASTE THE TOKEN'S ADDRESS HERE WHEN IT IS LIVE. That is the only edit
//  required: every buy button, header link and footer on the site reads from
//  it, and each one turns from "soon" into a link the moment it is filled in.
//
//  A Solana mint (base58) or an EVM contract (0x…) both work. A mint links to
//  the token's page on Jupiter, which trades whatever pool the token is in -
//  including a launchpad's own curve - so the link does not depend on where
//  it launched or whether it has graduated. Set NEXT_PUBLIC_EDGERUN_DEX_URL
//  to send buyers somewhere else instead.
//
//  Commit, push, done. An env var of the same name overrides the address if
//  you would rather not commit it.
// ═══════════════════════════════════════════════════════════════════════════
const TOKEN_CONTRACT = "";

export const TOKEN_TICKER = process.env.NEXT_PUBLIC_EDGERUN_TICKER || "$EDGERUN";

export const CONTRACT_ADDRESS =
  (process.env.NEXT_PUBLIC_EDGERUN_CONTRACT_ADDRESS || TOKEN_CONTRACT).trim();

const IS_EVM = /^0x[0-9a-fA-F]{40}$/.test(CONTRACT_ADDRESS);
// Base58: no 0, O, I or l. Case-carrying - never lowercase a mint.
const IS_SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(CONTRACT_ADDRESS);

/** True once the address above is set: what every "buy" surface switches on. */
export const TOKEN_LIVE = IS_EVM || IS_SOLANA;

// Every "buy" button on the site resolves through here. Before the address is
// set there is no link at all and the buttons render a pre-launch state
// instead of pointing somewhere useless.
export const SOLANA_BUY_BASE =
  process.env.NEXT_PUBLIC_SOLANA_BUY_BASE || "https://jup.ag/tokens";
export const PONS_LAUNCHPAD_BASE =
  process.env.NEXT_PUBLIC_PONS_LAUNCHPAD_BASE || "https://www.ponsfamily.com/launchpad";

const DEX_URL_OVERRIDE = process.env.NEXT_PUBLIC_EDGERUN_DEX_URL || "";

export function buyUrl(): string {
  if (DEX_URL_OVERRIDE) return DEX_URL_OVERRIDE;
  if (IS_SOLANA) return `${SOLANA_BUY_BASE.replace(/\/$/, "")}/${CONTRACT_ADDRESS}`;
  if (IS_EVM) return `${PONS_LAUNCHPAD_BASE.replace(/\/$/, "")}/${CONTRACT_ADDRESS}`;
  return "";
}

export const DEX_URL = buyUrl();

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

import shotHashes from "./shot-hashes.json";

/**
 * A screenshot URL that changes when the screenshot does.
 *
 * Pages serves these with `cache-control: max-age=600` and the filenames never change, so
 * replacing one leaves anybody who visited in the last ten minutes looking at the old image.
 * The hash is written by scripts/hash-shots.sh at prebuild, so this cannot drift from what is
 * actually on disk. Falls back to the plain path for a file the script has not seen.
 */
export function shot(file: string): string {
  const v = (shotHashes as Record<string, string>)[file];
  return asset(`/shots/${file}${v ? `?v=${v}` : ""}`);
}

// The archive the site hands out directly, plus what was in it. Both are produced by
// scripts/pack-extension.sh - re-run it after changing anything under extension/, or the
// published hash stops matching the published file, which is worse than publishing neither.
// Declared below asset() on purpose: it reads BASE_PATH, which is a const further up.
export const EXTENSION_ZIP = asset("/edgerun-extension.zip");
export const EXTENSION_VERSION = extensionMeta.version;
export const EXTENSION_SHA256 = extensionMeta.sha256;
export const EXTENSION_KB = Math.round(extensionMeta.bytes / 1024);
