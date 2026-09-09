from __future__ import annotations

import asyncio
import logging
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.middleware.cors import CORSMiddleware

from edgerun.config import load_config
from edgerun.scan import scan_address

from . import settings
from .cache import ScanCache
from .poller import run_poller, run_token_sampler
from .watchtower import run_watchtower
from .rate_limit import RateLimiter
from .receipt import render_og_image, render_receipt_page

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

_background_tasks: list[asyncio.Task] = []


@app.on_event("startup")
async def _start_background_tasks() -> None:
    _background_tasks.append(asyncio.create_task(run_poller(cache, config)))
    _background_tasks.append(asyncio.create_task(run_token_sampler(cache, config)))
    _background_tasks.append(asyncio.create_task(run_watchtower(cache, config)))


@app.on_event("shutdown")
async def _stop_background_tasks() -> None:
    for task in _background_tasks:
        task.cancel()


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
        "token_dex_url": settings.buy_url(),
    }


@app.get("/api/events")
def events(limit: int = 50, severity: str | None = None) -> dict:
    """Watchtower feed: contracts whose state CHANGED after we first scanned
    them. This is the part a snapshot scanner structurally cannot give you."""
    limit = max(1, min(limit, 200))
    if severity and severity not in ("critical", "warning", "info"):
        raise HTTPException(status_code=400, detail="severity must be critical, warning or info")
    return {"items": cache.events(limit=limit, severity=severity), "total": cache.event_count()}


@app.get("/api/deployers")
def deployers(limit: int = 25, min_launches: int = 2) -> dict:
    """Deployer reputation, worst first — serial ruggers are only visible in
    aggregate, which is why this is its own view rather than a scan field."""
    limit = max(1, min(limit, 100))
    return {"items": cache.deployers(limit=limit, min_launches=max(1, min_launches))}


@app.get("/api/deployers/{deployer}")
def deployer_detail(deployer: str) -> dict:
    contracts = cache.deployer_contracts(deployer)
    if not contracts:
        raise HTTPException(status_code=404, detail="no scanned contracts for this deployer")
    return {"deployer": deployer, "contracts": contracts}


def _load_for_share(address: str) -> dict:
    """Scan on demand if we've never seen it, so any address can be shared."""
    cached = cache.get(address, settings.SCAN_CACHE_TTL_SECONDS)
    if cached is not None:
        return cached
    try:
        result = scan_address(address, config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    payload = result.to_dict()
    cache.set(address, payload)
    return payload


@app.get("/og/{address}.png")
def og_image(address: str) -> Response:
    payload = _load_for_share(address)
    png = render_og_image(payload)
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=300"},
    )


@app.get("/s/{address}", response_class=HTMLResponse)
def share_receipt(address: str, request: Request) -> HTMLResponse:
    """The link you paste into Telegram/X. Server-rendered so it unfurls."""
    payload = _load_for_share(address)
    base = str(request.base_url).rstrip("/")
    html_doc = render_receipt_page(
        payload,
        site_url=settings.SITE_URL,
        og_image_url=f"{base}/og/{payload['address']}.png",
        page_url=f"{base}/s/{payload['address']}",
    )
    return HTMLResponse(content=html_doc, headers={"Cache-Control": "public, max-age=120"})


@app.get("/api/token")
def token_stats() -> dict:
    """Live $EDGERUN market state, straight from Blockscout.

    `launched: false` until a contract address is configured — the frontend
    renders an explicit pre-launch state for that rather than zeros.
    """
    address = settings.EDGERUN_CONTRACT_ADDRESS
    base = {
        "launched": bool(address),
        "ticker": settings.EDGERUN_TOKEN_TICKER,
        "address": address,
        "buy_url": settings.buy_url(),
        "explorer_url": f"{config.explorer_base}/address/{address}" if address else "",
    }
    if not address:
        return {**base, "price": None, "market_cap": None, "volume_24h": None, "holders": None}

    latest = cache.latest_token_sample()
    day_ago = cache.token_sample_at_or_before(time.time() - 86400)

    # A change figure is only shown when two real samples exist to compare.
    change_24h = None
    if latest and day_ago and latest.get("price") and day_ago.get("price"):
        change_24h = (latest["price"] - day_ago["price"]) / day_ago["price"] * 100

    return {
        **base,
        "price": latest.get("price") if latest else None,
        "market_cap": latest.get("market_cap") if latest else None,
        "volume_24h": latest.get("volume_24h") if latest else None,
        "holders": latest.get("holders") if latest else None,
        "updated_at": latest.get("ts") if latest else None,
        "change_24h": change_24h,
        "samples": len(cache.token_samples(0, limit=1000)),
    }


@app.get("/api/token/history")
def token_history(range: str = "24h") -> dict:
    """Real samples only — one point per poll cycle, nothing interpolated."""
    windows = {"1h": 3600, "24h": 86400, "7d": 7 * 86400, "all": None}
    if range not in windows:
        raise HTTPException(status_code=400, detail=f"range must be one of {list(windows)}")
    window = windows[range]
    since = 0.0 if window is None else time.time() - window
    return {"range": range, "points": cache.token_samples(since)}


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
