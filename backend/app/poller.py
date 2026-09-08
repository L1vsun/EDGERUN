"""Background job: polls Robinhood Chain for newly-verified contracts and
newly-listed tokens, scans anything not already in the cache, and writes the
result in — this is what makes /api/feed alive instead of manually curated.
"""
from __future__ import annotations

import asyncio
import logging

from edgerun.blockscout import BlockscoutClient, BlockscoutError
from edgerun.config import Config
from edgerun.scan import scan_address

from . import settings
from .cache import ScanCache

log = logging.getLogger("edgerun.poller")


async def run_poller(cache: ScanCache, config: Config) -> None:
    bs = BlockscoutClient(config.explorer_base)
    try:
        while True:
            try:
                await _poll_once(bs, cache, config)
            except Exception:
                log.exception("poll cycle failed, will retry")
            await asyncio.sleep(settings.POLL_INTERVAL_SECONDS)
    finally:
        bs.close()


async def _poll_once(bs: BlockscoutClient, cache: ScanCache, config: Config) -> None:
    candidates: set[str] = set()

    try:
        for item in await asyncio.to_thread(bs.newest_smart_contracts, 30):
            addr = (item.get("address") or {}).get("hash")
            if addr:
                candidates.add(addr)
    except BlockscoutError as exc:
        log.warning("newest_smart_contracts failed: %s", exc)

    try:
        for item in await asyncio.to_thread(bs.newest_tokens, 30):
            addr = item.get("address_hash")
            if addr:
                candidates.add(addr)
    except BlockscoutError as exc:
        log.warning("newest_tokens failed: %s", exc)

    new_addresses = [a for a in candidates if not cache.has_ever_scanned(a)]
    for addr in new_addresses[:20]:  # cap per cycle so one burst can't stall the loop
        try:
            result = await asyncio.to_thread(scan_address, addr, config)
        except Exception as exc:
            log.warning("scan failed for %s: %s", addr, exc)
            continue
        cache.set(addr, result.to_dict())

    if new_addresses:
        cache.trim(settings.FEED_MAX_ITEMS)
        log.info("poll cycle: %d new address(es) scanned", len(new_addresses[:20]))
