from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from edgerun.config import load_config
from edgerun.scan import scan_address

from . import settings
from .cache import ScanCache
from .poller import run_poller
from .rate_limit import RateLimiter

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="edgerun scan API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)

config = load_config(settings.EDGERUN_CONFIG)
cache = ScanCache(settings.CACHE_DB_PATH)
limiter = RateLimiter(settings.RATE_LIMIT_PER_MINUTE)

_poller_task: asyncio.Task | None = None


@app.on_event("startup")
async def _start_poller() -> None:
    global _poller_task
    _poller_task = asyncio.create_task(run_poller(cache, config))


@app.on_event("shutdown")
async def _stop_poller() -> None:
    if _poller_task:
        _poller_task.cancel()


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/config")
def public_config() -> dict:
    """Non-sensitive config the frontend's 'verify it yourself' section links to."""
    return {
        "explorer_base": config.explorer_base,
        "chain_id": config.chain_id,
        "rpc_url": config.rpc_url,
        "reference_token_count": len(config.reference_tokens),
        "max_edit_distance_flag": config.thresholds.max_edit_distance_flag,
        "poll_interval_seconds": settings.POLL_INTERVAL_SECONDS,
        "scan_cache_ttl_seconds": settings.SCAN_CACHE_TTL_SECONDS,
        "token_ticker": settings.EDGERUN_TOKEN_TICKER,
        "token_contract_address": settings.EDGERUN_CONTRACT_ADDRESS,
        "token_dex_url": settings.EDGERUN_DEX_URL,
    }


@app.get("/api/feed")
def feed(limit: int = 30) -> dict:
    limit = max(1, min(limit, 100))
    return {"items": cache.feed(limit)}


@app.get("/api/scan/{address}")
def scan(address: str, request: Request, force: bool = False) -> dict:
    client_ip = request.client.host if request.client else "unknown"
    if not limiter.allow(client_ip):
        raise HTTPException(status_code=429, detail="rate limit exceeded, try again in a minute")

    if not force:
        cached = cache.get(address, settings.SCAN_CACHE_TTL_SECONDS)
        if cached is not None:
            return {**cached, "cached": True}

    try:
        result = scan_address(address, config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    result_dict = result.to_dict()
    cache.set(address, result_dict)
    return {**result_dict, "cached": False}
