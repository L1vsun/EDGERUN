"""The official Robinhood stock-token registry.

This is the one thing a generic contract scanner structurally cannot do, and
it is specific to this chain: Robinhood Chain carries 194 *real tokenised
securities* - TSLA, NVDA, AAPL, SPY, GME - issued by Robinhood Assets (Jersey)
Limited as ordinary ERC-20s. Robinhood publishes the authoritative contract
address for every one of them at a public endpoint.

That turns impersonation detection from a heuristic into a fact. Everywhere
else this tool says "2 edits from a token we consider established"; here it can
say "the official Tesla token is 0x322F0929…, and this is not it."

It matters because the fakes are already everywhere. A search of ten tickers
against the live chain on 2026-09-09 returned 213 contracts using an official
ticker that were not the official contract - including six separate contracts
named exactly "NVIDIA • Robinhood Token". Every one of them is a structurally
clean ERC-20: verified source, renounced ownership, no mint. A scanner that
only reads the contract gives all of them a green verdict.

Docs: https://docs.robinhood.com/chain/stock-tokens/
API:  https://api.robinhood.com/rhj/assets  (public, no key, 60 req/s, 15s cache)
"""
from __future__ import annotations

import threading
import time
import unicodedata

import httpx

REGISTRY_URL = "https://api.robinhood.com/rhj/assets"
ROBINHOOD_CHAIN_ID = 4663

# Every official token is named "<Company> • Robinhood Token". Verified: all
# 194 entries match. Impersonators copy this string verbatim, which makes it a
# high-signal claim of officialness rather than a coincidence.
OFFICIAL_NAME_MARKER = "robinhood token"

# ERC-8056 corporate-action multiplier. Verified on-chain: the official TSLA
# token returns 1e18; an ordinary meme token reverts. A positive fingerprint,
# used only to corroborate - never to declare something official on its own,
# since anyone can implement a function that returns a number.
UI_MULTIPLIER_SELECTOR = "0xa60bf13d"

_REFRESH_SECONDS = 3600


def normalize_name(name: str) -> str:
    """Fold the bullet, accents and case so 'Tesla • Robinhood Token' and
    'Tesla - robinhood token' compare equal."""
    folded = unicodedata.normalize("NFKD", name or "")
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    for ch in "•·|---":
        folded = folded.replace(ch, " ")
    return " ".join(folded.lower().split())


class StockRegistry:
    """Official ticker -> contract address, refreshed on a TTL.

    A registry that cannot be loaded must never cause a token to be treated as
    genuine, so `loaded` is exposed and the check reports `unresolved` when the
    upstream is unreachable.
    """

    def __init__(self, url: str = REGISTRY_URL, timeout: float = 12.0):
        self._url = url
        self._timeout = timeout
        self._lock = threading.Lock()
        self._by_ticker: dict[str, dict] = {}
        self._by_address: dict[str, dict] = {}
        self._fetched_at = 0.0
        self._error: str | None = None

    @property
    def loaded(self) -> bool:
        return bool(self._by_ticker)

    @property
    def error(self) -> str | None:
        return self._error

    @property
    def count(self) -> int:
        return len(self._by_ticker)

    def refresh(self, force: bool = False) -> bool:
        with self._lock:
            if not force and self.loaded and time.time() - self._fetched_at < _REFRESH_SECONDS:
                return True
            try:
                resp = httpx.get(
                    self._url,
                    timeout=self._timeout,
                    headers={"Accept": "application/json", "User-Agent": "edgerun/0.1"},
                )
                resp.raise_for_status()
                payload = resp.json()
            except (httpx.HTTPError, ValueError) as exc:
                self._error = f"registry unreachable: {exc}"
                return False

            by_ticker, by_address = {}, {}
            for asset in payload.get("assets", []):
                ticker = (asset.get("tokenSymbol") or "").upper()
                if not ticker:
                    continue
                for dep in asset.get("deployments", []):
                    if dep.get("chainId") != ROBINHOOD_CHAIN_ID:
                        continue
                    addr = (dep.get("contractAddress") or "").lower()
                    if not addr:
                        continue
                    entry = {
                        "ticker": ticker,
                        "name": asset.get("tokenName", ""),
                        "address": addr,
                        "status": asset.get("status", ""),
                        "multiplier": asset.get("currentMultiplier", ""),
                    }
                    by_ticker[ticker] = entry
                    by_address[addr] = entry

            if not by_ticker:
                self._error = "registry returned no Robinhood Chain deployments"
                return False

            self._by_ticker, self._by_address = by_ticker, by_address
            self._fetched_at = time.time()
            self._error = None
            return True

    def official_for_ticker(self, ticker: str) -> dict | None:
        self.refresh()
        return self._by_ticker.get((ticker or "").upper())

    def official_for_address(self, address: str) -> dict | None:
        self.refresh()
        return self._by_address.get((address or "").lower())

    def all_tickers(self) -> list[str]:
        self.refresh()
        return sorted(self._by_ticker)


# One shared instance: the registry is identical for every scan, and refetching
# it per contract would hammer Robinhood's endpoint for no benefit.
REGISTRY = StockRegistry()
