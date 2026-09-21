"""SQLite-backed scan cache + feed store + $EDGERUN price history.

Two tables. `scans` is the scan cache and live feed. `token_samples` is the
price/holders history for our own token - Blockscout has no price-history
endpoint (verified: /api/v2/tokens/{addr}/price-history returns 404), so the
only honest way to draw a chart is to record real samples ourselves on each
poll cycle and plot exactly those. Before launch the table is simply empty
and the UI says so, rather than drawing invented candles.
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

CREATE TABLE IF NOT EXISTS token_samples (
    ts REAL PRIMARY KEY,
    price REAL,
    market_cap REAL,
    volume_24h REAL,
    holders INTEGER
);
CREATE INDEX IF NOT EXISTS idx_token_ts ON token_samples (ts DESC);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    address TEXT NOT NULL,
    ticker TEXT,
    check_id TEXT NOT NULL,
    label TEXT,
    before_status TEXT,
    after_status TEXT,
    severity TEXT,
    detail TEXT,
    verdict_before TEXT,
    verdict_after TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_addr ON events (address);
"""


class ScanCache:
    def __init__(self, db_path: str):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db_path = db_path
        self._lock = threading.Lock()
        with self._connect() as conn:
            conn.executescript(_SCHEMA)
            self._migrate(conn)

    @staticmethod
    def _migrate(conn: sqlite3.Connection) -> None:
        """CREATE TABLE IF NOT EXISTS won't add columns to a table that already
        exists, so a database written by an earlier version needs this."""
        existing = {row[1] for row in conn.execute("PRAGMA table_info(scans)")}
        if "deployer" not in existing:
            conn.execute("ALTER TABLE scans ADD COLUMN deployer TEXT")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_deployer ON scans (deployer)")

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
                "INSERT INTO scans (address, result_json, verdict, ticker, scanned_at, deployer) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(address) DO UPDATE SET "
                "result_json=excluded.result_json, verdict=excluded.verdict, "
                "ticker=excluded.ticker, scanned_at=excluded.scanned_at, deployer=excluded.deployer",
                (
                    address,
                    json.dumps(result),
                    result.get("verdict", ""),
                    result.get("token_symbol") or "",
                    time.time(),
                    (result.get("contract") or {}).get("deployer"),
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

    def stalest(self, limit: int, min_age_seconds: float) -> list[dict]:
        """Contracts not re-checked recently, oldest first - the watchtower's
        work queue. `min_age_seconds` stops us re-scanning something we just
        looked at."""
        cutoff = time.time() - min_age_seconds
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT result_json FROM scans WHERE scanned_at <= ? "
                "ORDER BY scanned_at ASC LIMIT ?",
                (cutoff, limit),
            ).fetchall()
        return [json.loads(r[0]) for r in rows]

    # --- watchtower events ---

    def add_event(self, e: dict) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "INSERT INTO events (ts, address, ticker, check_id, label, before_status, "
                "after_status, severity, detail, verdict_before, verdict_after) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    time.time(), e.get("address"), e.get("ticker"), e.get("check"),
                    e.get("label"), e.get("before"), e.get("after"), e.get("severity"),
                    e.get("detail"), e.get("verdict_before"), e.get("verdict_after"),
                ),
            )

    def events(self, limit: int = 50, severity: str | None = None) -> list[dict]:
        sql = ("SELECT ts, address, ticker, check_id, label, before_status, after_status, "
               "severity, detail, verdict_before, verdict_after FROM events")
        params: list = []
        if severity:
            sql += " WHERE severity = ?"
            params.append(severity)
        sql += " ORDER BY ts DESC LIMIT ?"
        params.append(limit)
        with self._lock, self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        keys = ("ts", "address", "ticker", "check", "label", "before", "after",
                "severity", "detail", "verdict_before", "verdict_after")
        return [dict(zip(keys, r)) for r in rows]

    def event_count(self) -> int:
        with self._lock, self._connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]

    def trim_events(self, max_items: int) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "DELETE FROM events WHERE id NOT IN "
                "(SELECT id FROM events ORDER BY ts DESC LIMIT ?)", (max_items,)
            )

    # --- deployer reputation ---

    def deployers(self, limit: int = 25, min_launches: int = 2) -> list[dict]:
        """Deployers we've seen ship more than one contract, worst first.

        Ordering is by FAIL count then total launches: a wallet that keeps
        shipping impersonations is exactly what a trader wants surfaced, and
        it is invisible if you only ever look at one contract at a time.
        """
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT deployer, COUNT(*) AS launches, "
                "  SUM(verdict = 'PASS') AS passes, "
                "  SUM(verdict = 'CAUTION') AS cautions, "
                "  SUM(verdict = 'FAIL') AS fails, "
                "  MAX(scanned_at) AS last_seen, "
                "  GROUP_CONCAT(ticker) AS tickers "
                "FROM scans WHERE deployer IS NOT NULL AND deployer != '' "
                "GROUP BY deployer HAVING launches >= ? "
                "ORDER BY fails DESC, launches DESC, last_seen DESC LIMIT ?",
                (min_launches, limit),
            ).fetchall()

        out = []
        for r in rows:
            tickers = [t for t in (r[6] or "").split(",") if t]
            out.append({
                "deployer": r[0],
                "launches": r[1],
                "pass": r[2] or 0,
                "caution": r[3] or 0,
                "fail": r[4] or 0,
                "last_seen": r[5],
                "tickers": tickers[:6],
            })
        return out

    def deployer_contracts(self, deployer: str, limit: int = 100) -> list[dict]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT result_json FROM scans WHERE lower(deployer) = lower(?) "
                "ORDER BY scanned_at DESC LIMIT ?",
                (deployer, limit),
            ).fetchall()
        return [json.loads(r[0]) for r in rows]

    # --- $EDGERUN price/holders history ---

    def add_token_sample(
        self,
        price: float | None,
        market_cap: float | None,
        volume_24h: float | None,
        holders: int | None,
    ) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO token_samples (ts, price, market_cap, volume_24h, holders) "
                "VALUES (?, ?, ?, ?, ?)",
                (time.time(), price, market_cap, volume_24h, holders),
            )

    def token_samples(self, since_ts: float, limit: int = 500) -> list[dict]:
        """Oldest-first, downsampled to `limit` points so a long window stays
        cheap to draw without inventing data between real samples."""
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT ts, price, market_cap, volume_24h, holders FROM token_samples "
                "WHERE ts >= ? ORDER BY ts ASC",
                (since_ts,),
            ).fetchall()

        if len(rows) > limit:
            step = len(rows) / limit
            rows = [rows[int(i * step)] for i in range(limit)]

        return [
            {"ts": r[0], "price": r[1], "market_cap": r[2], "volume_24h": r[3], "holders": r[4]}
            for r in rows
        ]

    def latest_token_sample(self) -> dict | None:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT ts, price, market_cap, volume_24h, holders FROM token_samples "
                "ORDER BY ts DESC LIMIT 1"
            ).fetchone()
        if row is None:
            return None
        return {"ts": row[0], "price": row[1], "market_cap": row[2], "volume_24h": row[3], "holders": row[4]}

    def token_sample_at_or_before(self, ts: float) -> dict | None:
        """Used for a real change-over-window figure - never extrapolated."""
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT ts, price, market_cap, volume_24h, holders FROM token_samples "
                "WHERE ts <= ? ORDER BY ts DESC LIMIT 1",
                (ts,),
            ).fetchone()
        if row is None:
            return None
        return {"ts": row[0], "price": row[1], "market_cap": row[2], "volume_24h": row[3], "holders": row[4]}

    def trim_token_samples(self, max_age_seconds: float) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM token_samples WHERE ts < ?", (time.time() - max_age_seconds,))
