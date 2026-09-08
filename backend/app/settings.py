from __future__ import annotations

import os
from pathlib import Path

# Everything here is env-overridable so the same image can point at mainnet
# or testnet, and so the CA/DEX-link values the frontend needs can be dropped
# in from one place without touching code (see EDGERUN_coder_brief.md's
# "Token banner" requirement).

EDGERUN_CONFIG = os.environ.get(
    "EDGERUN_CONFIG",
    str(Path(__file__).resolve().parent.parent.parent / "edgerun" / "data" / "known_tokens.json"),
)

CACHE_DB_PATH = os.environ.get("CACHE_DB_PATH", str(Path(__file__).resolve().parent.parent / "edgerun_cache.db"))

# LP-lock status can change; the brief asks for a refresh interval measured
# in minutes, not hours.
SCAN_CACHE_TTL_SECONDS = int(os.environ.get("SCAN_CACHE_TTL_SECONDS", 5 * 60))

POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", 45))
FEED_MAX_ITEMS = int(os.environ.get("FEED_MAX_ITEMS", 200))

RATE_LIMIT_PER_MINUTE = int(os.environ.get("RATE_LIMIT_PER_MINUTE", 12))

# Comma-separated list, e.g. "https://yourname.github.io"
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]

# Token identity — the one thing the frontend banner needs and the token
# isn't deployed yet, so these default to placeholders. Set the real values
# as env vars at deploy time; nothing else needs to change.
EDGERUN_TOKEN_TICKER = os.environ.get("EDGERUN_TOKEN_TICKER", "$EDGERUN")
EDGERUN_CONTRACT_ADDRESS = os.environ.get("EDGERUN_CONTRACT_ADDRESS", "")
EDGERUN_DEX_URL = os.environ.get("EDGERUN_DEX_URL", "")
