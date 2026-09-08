"""Thin client for Robinhood Chain's Blockscout REST v2 API.

Every field name here was confirmed live against robinhoodchain.blockscout.com
(and cross-checked against eth.blockscout.com, which runs the same Blockscout
version) on 2026-09-08 — see docs/checks.md for the exact calls. Nothing here
is inferred from Blockscout's general docs; it's the observed response shape.

The instance sits behind Cloudflare and returns a bot-challenge page to
requests with no browser-like User-Agent, so we always send one. A call that
still fails (timeout, 5xx, challenge page) raises BlockscoutError — callers
turn that into an `unresolved` check, never a silent pass.
"""
from __future__ import annotations

import httpx

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

# Cloudflare in front of this instance rejects requests that look automated.
# A User-Agent alone is NOT enough: verified 2026-09-08, dropping `Referer`
# turns a working 200 into a 403 on every endpoint. Send the header set a
# real browser XHR would send, and keep Referer in it.
def _browser_headers(base_url: str) -> dict[str, str]:
    return {
        "User-Agent": BROWSER_UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": f"{base_url}/",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
    }


class BlockscoutError(RuntimeError):
    """Raised when Blockscout can't answer — network, 4xx/5xx, or a challenge page."""


class BlockscoutClient:
    def __init__(self, base_url: str, timeout: float = 12.0):
        self.base_url = base_url.rstrip("/")
        self._client = httpx.Client(
            base_url=self.base_url,
            headers=_browser_headers(self.base_url),
            timeout=timeout,
            follow_redirects=True,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "BlockscoutClient":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def _get(self, path: str, params: dict | None = None) -> dict:
        try:
            resp = self._client.get(path, params=params)
        except httpx.HTTPError as exc:
            raise BlockscoutError(f"GET {path} failed: {exc}") from exc
        if resp.status_code == 403:
            raise BlockscoutError(
                f"GET {path} -> HTTP 403 (blocked by the explorer's bot protection — "
                "check the request headers in blockscout.py::_browser_headers)"
            )
        if resp.status_code == 429:
            raise BlockscoutError(f"GET {path} -> HTTP 429 (rate limited by the explorer)")
        if resp.status_code != 200:
            raise BlockscoutError(f"GET {path} -> HTTP {resp.status_code}")
        try:
            return resp.json()
        except ValueError as exc:
            raise BlockscoutError(f"GET {path} returned non-JSON (likely a bot-challenge page)") from exc

    # --- endpoints actually used by the scan pipeline ---

    def address(self, address: str) -> dict:
        """GET /api/v2/addresses/{address} — is_contract, is_verified, creator, token summary."""
        return self._get(f"/api/v2/addresses/{address}")

    def smart_contract(self, address: str) -> dict:
        """GET /api/v2/smart-contracts/{address} — source, bytecode, compiler, verification."""
        return self._get(f"/api/v2/smart-contracts/{address}")

    def token(self, address: str) -> dict:
        """GET /api/v2/tokens/{address} — name, symbol, decimals, total_supply, holders_count."""
        return self._get(f"/api/v2/tokens/{address}")

    def newest_smart_contracts(self, limit: int = 50) -> list[dict]:
        """GET /api/v2/smart-contracts — most-recently-verified contracts, newest first."""
        data = self._get("/api/v2/smart-contracts")
        return data.get("items", [])[:limit]

    def newest_tokens(self, limit: int = 50) -> list[dict]:
        """GET /api/v2/tokens — token list as surfaced by the explorer, newest activity first."""
        data = self._get("/api/v2/tokens")
        return data.get("items", [])[:limit]

    def explorer_url(self, address: str) -> str:
        return f"{self.base_url}/address/{address}"
