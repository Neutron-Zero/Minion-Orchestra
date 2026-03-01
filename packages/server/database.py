"""
SQLite persistence layer for Minion Orchestra.

Uses aiosqlite for async access. Database stored at ~/.minion-orchestra/orchestra.db
with WAL journal mode for concurrent read/write performance.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import aiosqlite

# ---------------------------------------------------------------------------
# Module-level singleton connection
# ---------------------------------------------------------------------------

_db: aiosqlite.Connection | None = None

DB_DIR = Path.home() / ".minion-orchestra"
DB_PATH = DB_DIR / "orchestra.db"

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    agent_id TEXT,
    session_id TEXT,
    timestamp TEXT NOT NULL,
    message TEXT,
    metadata JSON,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_name TEXT,
    status TEXT,
    working_directory TEXT,
    start_time TEXT,
    end_time TEXT,
    pid INTEGER,
    metadata JSON
);

CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT,
    level TEXT,
    message TEXT,
    tool_name TEXT,
    timestamp TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_logs_agent ON logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
"""

# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


async def init_db() -> aiosqlite.Connection:
    """Initialise the database, creating tables and indexes if needed.

    Returns the singleton connection so callers can use it directly if
    desired, but the module-level ``_db`` is the canonical reference.
    """
    global _db

    if _db is not None:
        return _db

    # Ensure the data directory exists
    DB_DIR.mkdir(parents=True, exist_ok=True)

    _db = await aiosqlite.connect(str(DB_PATH))

    # WAL mode for better concurrent read/write performance
    await _db.execute("PRAGMA journal_mode=WAL")

    # Return rows as sqlite3.Row so we can access columns by name
    _db.row_factory = aiosqlite.Row

    await _db.executescript(_SCHEMA)
    await _db.commit()

    return _db


async def close_db() -> None:
    """Close the database connection and clear the singleton."""
    global _db

    if _db is not None:
        await _db.close()
        _db = None


def _get_db() -> aiosqlite.Connection:
    """Return the current connection or raise if not initialised."""
    if _db is None:
        raise RuntimeError("Database not initialised. Call init_db() first.")
    return _db


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _json_dumps(obj: Any) -> str | None:
    """Serialise a value to a JSON string, or return None."""
    if obj is None:
        return None
    return json.dumps(obj)


def _row_to_dict(row: aiosqlite.Row) -> dict[str, Any]:
    """Convert a sqlite3.Row to a plain dict, deserialising JSON columns."""
    d = dict(row)
    for key in ("metadata",):
        if key in d and isinstance(d[key], str):
            try:
                d[key] = json.loads(d[key])
            except (json.JSONDecodeError, TypeError):
                pass
    return d


# ---------------------------------------------------------------------------
# Write operations
# ---------------------------------------------------------------------------


async def store_event(
    event_type: str,
    agent_id: str | None,
    session_id: str | None,
    timestamp: str,
    message: str | None = None,
    metadata: Any = None,
) -> int:
    """Insert an event row and return its id."""
    db = _get_db()
    cursor = await db.execute(
        """
        INSERT INTO events (event_type, agent_id, session_id, timestamp, message, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (event_type, agent_id, session_id, timestamp, message, _json_dumps(metadata)),
    )
    await db.commit()
    return cursor.lastrowid  # type: ignore[return-value]


async def store_log(
    agent_id: str | None,
    level: str | None,
    message: str | None,
    tool_name: str | None,
    timestamp: str,
) -> int:
    """Insert a log row and return its id."""
    db = _get_db()
    cursor = await db.execute(
        """
        INSERT INTO logs (agent_id, level, message, tool_name, timestamp)
        VALUES (?, ?, ?, ?, ?)
        """,
        (agent_id, level, message, tool_name, timestamp),
    )
    await db.commit()
    return cursor.lastrowid  # type: ignore[return-value]


async def store_session(
    id: str,
    agent_name: str | None = None,
    status: str | None = None,
    working_directory: str | None = None,
    start_time: str | None = None,
    pid: int | None = None,
    metadata: Any = None,
) -> None:
    """Upsert a session row (insert or update on conflict)."""
    db = _get_db()
    await db.execute(
        """
        INSERT INTO sessions (id, agent_name, status, working_directory, start_time, pid, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            agent_name       = COALESCE(excluded.agent_name, sessions.agent_name),
            status           = COALESCE(excluded.status, sessions.status),
            working_directory = COALESCE(excluded.working_directory, sessions.working_directory),
            start_time       = COALESCE(excluded.start_time, sessions.start_time),
            pid              = COALESCE(excluded.pid, sessions.pid),
            metadata         = COALESCE(excluded.metadata, sessions.metadata)
        """,
        (id, agent_name, status, working_directory, start_time, pid, _json_dumps(metadata)),
    )
    await db.commit()


async def update_session_status(
    id: str,
    status: str,
    end_time: str | None = None,
) -> None:
    """Update the status (and optionally end_time) of an existing session."""
    db = _get_db()
    if end_time is not None:
        await db.execute(
            "UPDATE sessions SET status = ?, end_time = ? WHERE id = ?",
            (status, end_time, id),
        )
    else:
        await db.execute(
            "UPDATE sessions SET status = ? WHERE id = ?",
            (status, id),
        )
    await db.commit()


# ---------------------------------------------------------------------------
# Read operations
# ---------------------------------------------------------------------------


async def get_events(
    limit: int = 100,
    event_type: str | None = None,
    agent_id: str | None = None,
    since: str | None = None,
) -> list[dict[str, Any]]:
    """Query events with optional filters, ordered newest-first."""
    db = _get_db()
    clauses: list[str] = []
    params: list[Any] = []

    if event_type is not None:
        clauses.append("event_type = ?")
        params.append(event_type)
    if agent_id is not None:
        clauses.append("agent_id = ?")
        params.append(agent_id)
    if since is not None:
        clauses.append("timestamp >= ?")
        params.append(since)

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    query = f"SELECT * FROM events{where} ORDER BY timestamp DESC LIMIT ?"
    params.append(limit)

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_logs(
    limit: int = 100,
    agent_id: str | None = None,
    level: str | None = None,
    since: str | None = None,
) -> list[dict[str, Any]]:
    """Query logs with optional filters, ordered newest-first."""
    db = _get_db()
    clauses: list[str] = []
    params: list[Any] = []

    if agent_id is not None:
        clauses.append("agent_id = ?")
        params.append(agent_id)
    if level is not None:
        clauses.append("level = ?")
        params.append(level)
    if since is not None:
        clauses.append("timestamp >= ?")
        params.append(since)

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    query = f"SELECT * FROM logs{where} ORDER BY timestamp DESC LIMIT ?"
    params.append(limit)

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_sessions(
    status: str | None = None,
) -> list[dict[str, Any]]:
    """Query sessions, optionally filtered by status."""
    db = _get_db()
    if status is not None:
        cursor = await db.execute(
            "SELECT * FROM sessions WHERE status = ? ORDER BY start_time DESC",
            (status,),
        )
    else:
        cursor = await db.execute(
            "SELECT * FROM sessions ORDER BY start_time DESC",
        )
    rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_completed_sessions(limit: int = 100) -> list[dict[str, Any]]:
    """Return the most recent completed/offline sessions for restoring on startup."""
    db = _get_db()
    cursor = await db.execute(
        "SELECT * FROM sessions WHERE status IN ('completed', 'offline') "
        "ORDER BY start_time DESC LIMIT ?",
        (limit,),
    )
    rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_prompts(
    search: str | None = None,
    project: str | None = None,
    since: str | None = None,
    until: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Query UserPromptSubmit events for prompt history.

    Parameters
    ----------
    search : str, optional
        Substring match against the event message.
    project : str, optional
        Filter by session_id (used as project identifier).
    since : str, optional
        ISO-8601 lower bound for timestamp (inclusive).
    until : str, optional
        ISO-8601 upper bound for timestamp (inclusive).
    limit : int
        Maximum number of rows to return.
    """
    db = _get_db()
    clauses: list[str] = ["event_type = 'UserPromptSubmit'"]
    params: list[Any] = []

    if search is not None:
        clauses.append("message LIKE ?")
        params.append(f"%{search}%")
    if project is not None:
        clauses.append("session_id = ?")
        params.append(project)
    if since is not None:
        clauses.append("timestamp >= ?")
        params.append(since)
    if until is not None:
        clauses.append("timestamp <= ?")
        params.append(until)

    where = " WHERE " + " AND ".join(clauses)
    query = f"SELECT * FROM events{where} ORDER BY timestamp DESC LIMIT ?"
    params.append(limit)

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]
