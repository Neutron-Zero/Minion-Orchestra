"""
SQLite persistence layer for Minion Orchestra.

Uses aiosqlite for async access. Database stored at ~/.minion-orchestra/orchestra.db
with WAL journal mode for concurrent read/write performance.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

import aiosqlite


def _uuid() -> str:
    return str(uuid.uuid4())

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
    id TEXT PRIMARY KEY,
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
    agent_id TEXT NOT NULL UNIQUE,
    agent_name TEXT,
    status TEXT,
    working_directory TEXT,
    start_time TEXT,
    end_time TEXT,
    pid INTEGER,
    metadata JSON
);

CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    level TEXT,
    message TEXT,
    tool_name TEXT,
    timestamp TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS transcript_entries (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    content TEXT,
    tool_name TEXT,
    tool_input TEXT,
    tool_use_id TEXT,
    timestamp TEXT NOT NULL,
    line_number INTEGER NOT NULL,
    metadata JSON
);

CREATE TABLE IF NOT EXISTS transcript_scan_state (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL,
    jsonl_path TEXT NOT NULL,
    last_line_number INTEGER NOT NULL DEFAULT 0,
    last_file_size INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_logs_agent ON logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_transcript_agent ON transcript_entries(agent_id);
CREATE INDEX IF NOT EXISTS idx_transcript_session ON transcript_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_transcript_agent_line ON transcript_entries(agent_id, line_number);
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

    # Check if migration is needed (old integer PKs)
    await _migrate_to_uuid(_db)

    await _db.executescript(_SCHEMA)
    await _db.commit()

    return _db


async def _table_exists(db: aiosqlite.Connection, name: str) -> bool:
    cur = await db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    )
    return await cur.fetchone() is not None


async def _migrate_to_uuid(db: aiosqlite.Connection) -> None:
    """Migrate tables from INTEGER AUTOINCREMENT PKs to TEXT UUID PKs."""
    # Check if events table exists and has integer PK
    cursor = await db.execute("PRAGMA table_info(events)")
    columns = await cursor.fetchall()
    if not columns:
        return  # fresh DB, no migration needed

    # Check if events.id is INTEGER (old schema)
    id_col = next((c for c in columns if c[1] == "id"), None)
    if id_col is None or id_col[2].upper() != "INTEGER":
        # Check if sessions needs agent_id column (old schema had id=agent_id)
        cursor = await db.execute("PRAGMA table_info(sessions)")
        sess_cols = await cursor.fetchall()
        has_agent_id = any(c[1] == "agent_id" for c in sess_cols)
        if has_agent_id:
            return  # already migrated
        # sessions needs migration: old schema used id as agent_id
        if await _table_exists(db, "sessions"):
            await _migrate_sessions(db)
        if await _table_exists(db, "transcript_scan_state"):
            await _migrate_scan_state(db)
        await db.commit()
        return

    print("  Migrating database to UUID primary keys...")

    # Migrate events
    if await _table_exists(db, "events"):
        await db.executescript("""
            ALTER TABLE events RENAME TO _events_old;
            CREATE TABLE events (
                id TEXT PRIMARY KEY, event_type TEXT NOT NULL, agent_id TEXT,
                session_id TEXT, timestamp TEXT NOT NULL, message TEXT,
                metadata JSON, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
        """)
        cursor = await db.execute("SELECT * FROM _events_old")
        rows = await cursor.fetchall()
        for r in rows:
            await db.execute(
                "INSERT INTO events (id, event_type, agent_id, session_id, timestamp, message, metadata, created_at) VALUES (?,?,?,?,?,?,?,?)",
                (_uuid(), r[1], r[2], r[3], r[4], r[5], r[6], r[7]),
            )
        await db.execute("DROP TABLE _events_old")

    # Migrate logs
    if await _table_exists(db, "logs"):
        await db.executescript("""
            ALTER TABLE logs RENAME TO _logs_old;
            CREATE TABLE logs (
                id TEXT PRIMARY KEY, agent_id TEXT, level TEXT, message TEXT,
                tool_name TEXT, timestamp TEXT NOT NULL,
                created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
        """)
        cursor = await db.execute("SELECT * FROM _logs_old")
        rows = await cursor.fetchall()
        for r in rows:
            await db.execute(
                "INSERT INTO logs (id, agent_id, level, message, tool_name, timestamp, created_at) VALUES (?,?,?,?,?,?,?)",
                (_uuid(), r[1], r[2], r[3], r[4], r[5], r[6]),
            )
        await db.execute("DROP TABLE _logs_old")

    # Migrate transcript_entries
    if await _table_exists(db, "transcript_entries"):
        await db.executescript("""
            ALTER TABLE transcript_entries RENAME TO _te_old;
            CREATE TABLE transcript_entries (
                id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, session_id TEXT NOT NULL,
                entry_type TEXT NOT NULL, content TEXT, tool_name TEXT, tool_input TEXT,
                tool_use_id TEXT, timestamp TEXT NOT NULL, line_number INTEGER NOT NULL, metadata JSON
            );
        """)
        cursor = await db.execute("SELECT * FROM _te_old")
        rows = await cursor.fetchall()
        for r in rows:
            await db.execute(
                "INSERT INTO transcript_entries (id, agent_id, session_id, entry_type, content, tool_name, tool_input, tool_use_id, timestamp, line_number, metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (_uuid(), r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10]),
            )
        await db.execute("DROP TABLE _te_old")

    # Migrate sessions (old: id was the agent_id)
    if await _table_exists(db, "sessions"):
        await _migrate_sessions(db)

    # Migrate transcript_scan_state (old: agent_id was the PK)
    if await _table_exists(db, "transcript_scan_state"):
        await _migrate_scan_state(db)

    await db.commit()
    print("  Migration complete.")


async def _migrate_sessions(db: aiosqlite.Connection) -> None:
    """Migrate sessions: old id (agent_id) → new UUID id + agent_id column."""
    await db.executescript("""
        ALTER TABLE sessions RENAME TO _sessions_old;
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY, agent_id TEXT NOT NULL UNIQUE, agent_name TEXT,
            status TEXT, working_directory TEXT, start_time TEXT, end_time TEXT,
            pid INTEGER, metadata JSON
        );
    """)
    cursor = await db.execute("SELECT * FROM _sessions_old")
    rows = await cursor.fetchall()
    col_names = [desc[0] for desc in cursor.description]
    for r in rows:
        rd = dict(zip(col_names, r))
        old_id = rd["id"]
        await db.execute(
            "INSERT INTO sessions (id, agent_id, agent_name, status, working_directory, start_time, end_time, pid, metadata) VALUES (?,?,?,?,?,?,?,?,?)",
            (_uuid(), old_id, rd.get("agent_name"), rd.get("status"), rd.get("working_directory"),
             rd.get("start_time"), rd.get("end_time"), rd.get("pid"), rd.get("metadata")),
        )
    await db.execute("DROP TABLE _sessions_old")


async def _migrate_scan_state(db: aiosqlite.Connection) -> None:
    """Migrate transcript_scan_state: agent_id PK → UUID id + agent_id unique."""
    await db.executescript("""
        ALTER TABLE transcript_scan_state RENAME TO _tss_old;
        CREATE TABLE transcript_scan_state (
            id TEXT PRIMARY KEY, agent_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL,
            jsonl_path TEXT NOT NULL, last_line_number INTEGER NOT NULL DEFAULT 0,
            last_file_size INTEGER NOT NULL DEFAULT 0
        );
    """)
    cursor = await db.execute("SELECT * FROM _tss_old")
    rows = await cursor.fetchall()
    col_names = [desc[0] for desc in cursor.description]
    for r in rows:
        rd = dict(zip(col_names, r))
        await db.execute(
            "INSERT INTO transcript_scan_state (id, agent_id, session_id, jsonl_path, last_line_number, last_file_size) VALUES (?,?,?,?,?,?)",
            (_uuid(), rd["agent_id"], rd["session_id"], rd["jsonl_path"], rd["last_line_number"], rd["last_file_size"]),
        )
    await db.execute("DROP TABLE _tss_old")


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
) -> str:
    """Insert an event row and return its UUID id."""
    db = _get_db()
    row_id = _uuid()
    await db.execute(
        """
        INSERT INTO events (id, event_type, agent_id, session_id, timestamp, message, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (row_id, event_type, agent_id, session_id, timestamp, message, _json_dumps(metadata)),
    )
    await db.commit()
    return row_id


async def store_log(
    agent_id: str | None,
    level: str | None,
    message: str | None,
    tool_name: str | None,
    timestamp: str,
) -> str:
    """Insert a log row and return its UUID id."""
    db = _get_db()
    row_id = _uuid()
    await db.execute(
        """
        INSERT INTO logs (id, agent_id, level, message, tool_name, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (row_id, agent_id, level, message, tool_name, timestamp),
    )
    await db.commit()
    return row_id


async def store_session(
    agent_id: str,
    agent_name: str | None = None,
    status: str | None = None,
    working_directory: str | None = None,
    start_time: str | None = None,
    pid: int | None = None,
    metadata: Any = None,
) -> None:
    """Upsert a session row (insert or update on conflict by agent_id)."""
    db = _get_db()
    await db.execute(
        """
        INSERT INTO sessions (id, agent_id, agent_name, status, working_directory, start_time, pid, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(agent_id) DO UPDATE SET
            agent_name       = COALESCE(excluded.agent_name, sessions.agent_name),
            status           = COALESCE(excluded.status, sessions.status),
            working_directory = COALESCE(excluded.working_directory, sessions.working_directory),
            start_time       = COALESCE(excluded.start_time, sessions.start_time),
            pid              = COALESCE(excluded.pid, sessions.pid),
            metadata         = COALESCE(excluded.metadata, sessions.metadata)
        """,
        (_uuid(), agent_id, agent_name, status, working_directory, start_time, pid, _json_dumps(metadata)),
    )
    await db.commit()


async def update_session_status(
    agent_id: str,
    status: str,
    end_time: str | None = None,
) -> None:
    """Update the status (and optionally end_time) of an existing session."""
    db = _get_db()
    if end_time is not None:
        await db.execute(
            "UPDATE sessions SET status = ?, end_time = ? WHERE agent_id = ?",
            (status, end_time, agent_id),
        )
    else:
        await db.execute(
            "UPDATE sessions SET status = ? WHERE agent_id = ?",
            (status, agent_id),
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


# ---------------------------------------------------------------------------
# Transcript operations
# ---------------------------------------------------------------------------


async def store_transcript_entries_batch(entries: list[dict[str, Any]]) -> int:
    """Bulk insert transcript entries. Returns count inserted."""
    if not entries:
        return 0
    db = _get_db()
    await db.executemany(
        """
        INSERT INTO transcript_entries
            (id, agent_id, session_id, entry_type, content, tool_name, tool_input, tool_use_id, timestamp, line_number, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                e.get("id") or _uuid(), e["agent_id"], e["session_id"], e["entry_type"], e.get("content"),
                e.get("tool_name"), e.get("tool_input"), e.get("tool_use_id"),
                e["timestamp"], e["line_number"], _json_dumps(e.get("metadata")),
            )
            for e in entries
        ],
    )
    await db.commit()
    return len(entries)


async def get_transcript_entries(
    agent_id: str,
    limit: int = 500,
    offset: int = 0,
    start_line: int | None = None,
) -> list[dict[str, Any]]:
    """Query transcript entries for an agent, returned in chronological order.

    If *start_line* is provided, returns entries starting from that line_number
    (inclusive) with the given limit.  Otherwise falls back to returning the
    most recent *limit* entries (for initial load / tail behaviour).
    """
    db = _get_db()
    if start_line is not None:
        cursor = await db.execute(
            "SELECT * FROM transcript_entries WHERE agent_id = ? AND line_number >= ? ORDER BY line_number ASC LIMIT ?",
            (agent_id, start_line, limit),
        )
    else:
        cursor = await db.execute(
            "SELECT * FROM (SELECT * FROM transcript_entries WHERE agent_id = ? ORDER BY line_number DESC LIMIT ? OFFSET ?) sub ORDER BY line_number ASC",
            (agent_id, limit, offset),
        )
    rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_transcript_count(agent_id: str) -> int:
    """Return total number of transcript entries for an agent."""
    db = _get_db()
    cursor = await db.execute(
        "SELECT COUNT(*) FROM transcript_entries WHERE agent_id = ?",
        (agent_id,),
    )
    row = await cursor.fetchone()
    return row[0] if row else 0


async def get_transcript_line_for_timestamp(agent_id: str, timestamp: str) -> int | None:
    """Find the line_number of the closest user entry at or before the given timestamp."""
    db = _get_db()
    cursor = await db.execute(
        "SELECT line_number FROM transcript_entries WHERE agent_id = ? AND entry_type = 'user' AND timestamp <= ? ORDER BY timestamp DESC LIMIT 1",
        (agent_id, timestamp),
    )
    row = await cursor.fetchone()
    return row[0] if row else None


async def get_transcript_entries_before(
    agent_id: str, before_line: int, limit: int = 100,
) -> list[dict[str, Any]]:
    """Return entries with line_number < before_line, in ascending order."""
    db = _get_db()
    cursor = await db.execute(
        "SELECT * FROM (SELECT * FROM transcript_entries WHERE agent_id = ? AND line_number < ? ORDER BY line_number DESC LIMIT ?) sub ORDER BY line_number ASC",
        (agent_id, before_line, limit),
    )
    rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_transcript_entry_by_id(entry_id: str) -> dict[str, Any] | None:
    """Fetch a single transcript entry by its UUID."""
    db = _get_db()
    cursor = await db.execute(
        "SELECT * FROM transcript_entries WHERE id = ?",
        (entry_id,),
    )
    row = await cursor.fetchone()
    return _row_to_dict(row) if row else None


async def get_unchecked_image_entries() -> list[dict[str, Any]]:
    """Return transcript entries with image references that haven't been checked yet."""
    db = _get_db()
    cursor = await db.execute(
        "SELECT * FROM transcript_entries "
        "WHERE content LIKE '%[Image: source:%' "
        "AND (metadata IS NULL OR metadata NOT LIKE '%image_data%')"
    )
    rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


async def update_transcript_entry_metadata(entry_id: str, metadata: Any) -> None:
    """Update the metadata JSON of a transcript entry."""
    db = _get_db()
    await db.execute(
        "UPDATE transcript_entries SET metadata = ? WHERE id = ?",
        (_json_dumps(metadata), entry_id),
    )
    await db.commit()


async def get_transcript_scan_state(agent_id: str) -> dict[str, Any] | None:
    """Get the JSONL scan state for an agent."""
    db = _get_db()
    cursor = await db.execute(
        "SELECT * FROM transcript_scan_state WHERE agent_id = ?",
        (agent_id,),
    )
    row = await cursor.fetchone()
    return dict(row) if row else None


async def upsert_transcript_scan_state(
    agent_id: str,
    session_id: str,
    jsonl_path: str,
    last_line_number: int,
    last_file_size: int,
) -> None:
    """Upsert the JSONL scan progress for an agent."""
    db = _get_db()
    await db.execute(
        """
        INSERT INTO transcript_scan_state (id, agent_id, session_id, jsonl_path, last_line_number, last_file_size)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(agent_id) DO UPDATE SET
            session_id = excluded.session_id,
            jsonl_path = excluded.jsonl_path,
            last_line_number = excluded.last_line_number,
            last_file_size = excluded.last_file_size
        """,
        (_uuid(), agent_id, session_id, jsonl_path, last_line_number, last_file_size),
    )
    await db.commit()
