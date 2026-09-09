"""Minimal JSON-RPC client against Robinhood Chain's public RPC.

Used for exactly two things the Blockscout REST API doesn't give us directly:
  - eth_call owner() to check the live current owner (ownership can change
    after verification; this reads chain state at scan time, not the source).
  - eth_getCode, so the dangerous-function bytecode scan works even on
    unverified contracts (bytecode is always public; source may not be).

Confirmed working against https://rpc.mainnet.chain.robinhood.com on
2026-09-08 with no API key required.
"""
from __future__ import annotations

import httpx

OWNER_SELECTOR = "0x8da5cb5b"  # owner() — keccak256("owner()")[:4], verified locally
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


class RpcError(RuntimeError):
    """RPC failure. `revert_data` carries the ABI-encoded revert payload when
    the node returned one, so callers can decode *why* a call failed rather
    than only that it did."""

    def __init__(self, message: str, revert_data: str | None = None):
        super().__init__(message)
        self.revert_data = revert_data


class RpcClient:
    def __init__(self, url: str, timeout: float = 10.0):
        self.url = url
        self._client = httpx.Client(timeout=timeout)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "RpcClient":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def _call(self, method: str, params: list) -> str:
        try:
            resp = self._client.post(
                self.url,
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
            )
            resp.raise_for_status()
            body = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise RpcError(f"{method} failed: {exc}") from exc
        if "error" in body:
            err = body["error"]
            data = err.get("data") if isinstance(err, dict) else None
            raise RpcError(f"{method} -> {err}", revert_data=data if isinstance(data, str) else None)
        return body["result"]

    def eth_call(self, from_address: str | None, to: str, data: str) -> str:
        """`from` matters: a transfer simulation must run as a real holder,
        otherwise it reverts on balance and tells you nothing."""
        tx: dict[str, str] = {"to": to, "data": data}
        if from_address:
            tx["from"] = from_address
        return self._call("eth_call", [tx, "latest"])

    def eth_get_code(self, address: str) -> str:
        return self._call("eth_getCode", [address, "latest"])

    def owner(self, contract_address: str) -> str | None:
        """Returns the checksummed-ish lowercase owner address, or None if the
        call reverted / the contract has no owner() (not every contract does)."""
        try:
            result = self.eth_call(None, contract_address, OWNER_SELECTOR)
        except RpcError:
            return None
        if not result or result == "0x" or len(result) < 66:
            return None
        addr = "0x" + result[-40:]
        return addr.lower()

    def is_renounced(self, owner_address: str | None) -> bool | None:
        if owner_address is None:
            return None
        return owner_address.lower() == ZERO_ADDRESS
