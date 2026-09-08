"""SQLite-backed scan cache + feed store.

One table is enough: every scan (user-triggered or from the poller) is
upserted here. /api/scan reads it as a TTL cache; /api/feed reads it as a
recency-ordered list. Survives backend restarts, which a pure in-memory
cache wouldn't.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS scans (
    address TEXT PRIMARY KEY,
    result_json TEXT NOT NULL,
    verdict TEXT NOT NULL,
    ticker TEXT,
    scanned_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scanned_at ON scans (scanned_at DESC);
"""


class ScanCache:
    def __init__(self, db_path: str):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db_path = db_path
        self._lock = threading.Lock()
        with self._connect() as conn:
            conn.executescript(_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._db_path, timeout=10)

    def get(self, address: str, ttl_seconds: int) -> dict | None:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT result_json, scanned_at FROM scans WHERE address = ?", (address,)
            ).fetchone()
        if row is None:
            return None
        result_json, scanned_at = row
        if time.time() - scanned_at > ttl_seconds:
            return None
        return json.loads(result_json)

    def set(self, address: str, result: dict) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "INSERT INTO scans (address, result_json, verdict, ticker, scanned_at) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(address) DO UPDATE SET "
                "result_json=excluded.result_json, verdict=excluded.verdict, "
                "ticker=excluded.ticker, scanned_at=excluded.scanned_at",
                (
                    address,
                    json.dumps(result),
                    result.get("verdict", ""),
                    result.get("token_symbol") or "",
                    time.time(),
                ),
            )

    def has_ever_scanned(self, address: str) -> bool:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT 1 FROM scans WHERE address = ?", (address,)).fetchone()
        return row is not None

    def feed(self, limit: int = 50) -> list[dict]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT result_json FROM scans ORDER BY scanned_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [json.loads(r[0]) for r in rows]

    def trim(self, max_items: int) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "DELETE FROM scans WHERE address NOT IN "
                "(SELECT address FROM scans ORDER BY scanned_at DESC LIMIT ?)",
                (max_items,),
            )
