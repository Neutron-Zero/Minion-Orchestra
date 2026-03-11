"""
Filesystem session watcher for Claude Code JSONL session files.

Watches ~/.claude/projects/ for JSONL file changes to auto-discover
running Claude Code sessions without requiring hooks.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING

import psutil
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

if TYPE_CHECKING:
    import socketio
    from services import AgentManager

logger = logging.getLogger(__name__)

# How far back to read from the end of a JSONL file
TAIL_BYTES = 8 * 1024  # 8KB

# Debounce window for file change events (seconds)
DEBOUNCE_SECONDS = 0.5

# Thresholds for inferring status from timestamp age
IDLE_THRESHOLD_SECONDS = 5 * 60       # 5 minutes
OFFLINE_THRESHOLD_SECONDS = 60 * 60   # 1 hour

# Base path for Claude Code session files
CLAUDE_PROJECTS_DIR = os.path.expanduser("~/.claude/projects")


class _JsonlEventHandler(FileSystemEventHandler):
    """Watchdog handler that forwards JSONL file changes to the SessionWatcher."""

    def __init__(self, watcher: SessionWatcher):
        super().__init__()
        self._watcher = watcher

    def on_modified(self, event):
        if event.is_directory:
            return
        if event.src_path.endswith(".jsonl"):
            self._watcher._schedule_file_processing(event.src_path)

    def on_created(self, event):
        if event.is_directory:
            return
        if event.src_path.endswith(".jsonl"):
            self._watcher._schedule_file_processing(event.src_path)


class SessionWatcher:
    """
    Watches Claude Code's JSONL session files in ~/.claude/projects/
    to auto-discover running sessions.

    Uses the watchdog library to monitor file changes and parses
    the tail of JSONL files to extract session state, then registers
    or updates agents in the AgentManager.
    """

    def __init__(self, agent_manager: AgentManager, sio: socketio.AsyncServer):
        self._agent_manager = agent_manager
        self._sio = sio
        self._observer: Observer | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

        # Debounce tracking: file_path -> scheduled timestamp
        self._pending: dict[str, float] = {}
        self._debounce_lock = threading.Lock()
        self._debounce_timer: threading.Timer | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self):
        """Start watching ~/.claude/projects/ for JSONL file changes."""
        if not os.path.isdir(CLAUDE_PROJECTS_DIR):
            logger.warning(
                "Claude projects directory not found: %s  -- session watcher disabled",
                CLAUDE_PROJECTS_DIR,
            )
            return

        # Capture the running asyncio event loop so we can schedule coroutines
        # from the watchdog background thread.
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

        # Scan existing files first
        self._scan_existing()

        # Set up the watchdog observer
        handler = _JsonlEventHandler(self)
        self._observer = Observer()
        self._observer.schedule(handler, CLAUDE_PROJECTS_DIR, recursive=True)
        self._observer.daemon = True
        self._observer.start()
        logger.info("Session watcher started on %s", CLAUDE_PROJECTS_DIR)

    def stop(self):
        """Stop the filesystem observer."""
        if self._debounce_timer is not None:
            self._debounce_timer.cancel()
            self._debounce_timer = None
        if self._observer is not None:
            try:
                self._observer.stop()
                self._observer.join(timeout=2)
            except Exception:
                pass
            self._observer = None

    # ------------------------------------------------------------------
    # File event handling (called from watchdog thread)
    # ------------------------------------------------------------------

    def _schedule_file_processing(self, file_path: str):
        """
        Debounce file change events. If the same file fires multiple
        events within DEBOUNCE_SECONDS, only process once.
        """
        now = time.monotonic()
        with self._debounce_lock:
            self._pending[file_path] = now

            # Cancel any existing timer and schedule a new flush
            if self._debounce_timer is not None:
                self._debounce_timer.cancel()
            self._debounce_timer = threading.Timer(
                DEBOUNCE_SECONDS, self._flush_pending
            )
            self._debounce_timer.daemon = True
            self._debounce_timer.start()

    def _flush_pending(self):
        """Process all pending file changes (runs in timer thread)."""
        with self._debounce_lock:
            to_process = dict(self._pending)
            self._pending.clear()
            self._debounce_timer = None

        for file_path in to_process:
            self._on_file_modified(file_path)

    def _on_file_modified(self, file_path: str):
        """
        Called when a JSONL file changes. Parses session state from the
        tail of the file and feeds it into AgentManager.
        """
        try:
            state = self._parse_session_state(file_path)
            if state is None:
                return
            self._register_or_update_session(state)
        except Exception:
            logger.exception("Error processing session file: %s", file_path)

    # ------------------------------------------------------------------
    # JSONL parsing
    # ------------------------------------------------------------------

    def _parse_session_state(self, file_path: str) -> dict | None:
        """
        Read the tail of a JSONL file and extract session state.

        Returns a dict with keys:
            session_id, cwd, git_branch, status, current_tool,
            model, last_activity, agent_name
        or None if the file cannot be parsed.
        """
        lines = self._read_tail_lines(file_path)
        if not lines:
            return None

        # Parse JSON entries from the tail lines
        entries = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue

        if not entries:
            return None

        # Use the last entry with a sessionId to identify the session
        session_id = None
        cwd = None
        git_branch = None
        model = None
        slug = None

        # Walk entries to collect the most recent metadata
        for entry in entries:
            if entry.get("sessionId"):
                session_id = entry["sessionId"]
            if entry.get("cwd"):
                cwd = entry["cwd"]
            if entry.get("gitBranch"):
                git_branch = entry["gitBranch"]
            if entry.get("version"):
                model = entry.get("model") or entry.get("version")
            if entry.get("slug"):
                slug = entry["slug"]

        if not session_id:
            return None

        # Determine status from the last entry
        last_entry = entries[-1]
        status = self._derive_status(last_entry)

        # Extract current tool from the most recent PreToolUse entry
        current_tool = None
        for entry in reversed(entries):
            entry_type = entry.get("type")
            data = entry.get("data") or {}
            if entry_type == "progress":
                hook_event = data.get("hookEvent") or data.get("type", "")
                if hook_event == "PreToolUse":
                    current_tool = data.get("hookName") or data.get("tool_name")
                    break
                elif hook_event == "PostToolUse":
                    # Tool already finished; no active tool
                    break

        # Determine last_activity from timestamp of the last entry
        last_activity = last_entry.get("timestamp")

        # Derive agent name from slug, or from cwd (last folder name)
        if slug:
            agent_name = slug
        elif cwd:
            agent_name = os.path.basename(cwd.rstrip("/"))
        else:
            agent_name = f"session-{session_id[:8]}"

        return {
            "session_id": session_id,
            "cwd": cwd,
            "git_branch": git_branch,
            "status": status,
            "current_tool": current_tool,
            "model": model,
            "last_activity": last_activity,
            "agent_name": agent_name,
        }

    def _derive_status(self, last_entry: dict) -> str:
        """Derive agent status from the last JSONL entry.

        Always checks timestamp age first -- if the last entry is old, the
        session is idle or offline regardless of entry type.
        """
        # Check timestamp age first -- stale sessions are never "working"
        timestamp_str = last_entry.get("timestamp")
        if timestamp_str:
            try:
                ts = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
                age = (datetime.now(timezone.utc) - ts).total_seconds()
                if age > OFFLINE_THRESHOLD_SECONDS:
                    return "offline"
                if age > IDLE_THRESHOLD_SECONDS:
                    return "idle"
            except (ValueError, TypeError):
                pass

        entry_type = last_entry.get("type")
        data = last_entry.get("data") or {}

        if entry_type == "progress":
            hook_event = data.get("hookEvent") or data.get("type", "")
            if hook_event in ("PreToolUse", "PostToolUse", "hook_progress"):
                return "working"

        if entry_type == "user":
            return "working"

        if entry_type == "assistant":
            return "idle"

        return "idle"

    @staticmethod
    def _read_tail_lines(file_path: str) -> list[str]:
        """Read the last TAIL_BYTES of a file and return the lines."""
        try:
            file_size = os.path.getsize(file_path)
            with open(file_path, "rb") as f:
                if file_size > TAIL_BYTES:
                    f.seek(-TAIL_BYTES, os.SEEK_END)
                    # Discard the first (potentially partial) line
                    raw = f.read()
                    idx = raw.find(b"\n")
                    if idx >= 0:
                        raw = raw[idx + 1 :]
                else:
                    raw = f.read()
            return raw.decode("utf-8", errors="replace").splitlines()
        except (OSError, IOError):
            return []

    # ------------------------------------------------------------------
    # Startup scan
    # ------------------------------------------------------------------

    @staticmethod
    def _get_running_claude_cwds() -> set[str]:
        """Get working directories of all running Claude Code processes."""
        cwds: set[str] = set()
        for proc in psutil.process_iter(["pid", "cmdline", "cwd"]):
            try:
                cmdline = proc.info.get("cmdline") or []
                if not cmdline or cmdline[0].rstrip("/").split("/")[-1] != "claude":
                    continue
                cwd = proc.info.get("cwd") or ""
                if cwd:
                    cwds.add(cwd)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        return cwds

    def _scan_existing(self):
        """
        Scan JSONL files on startup to enrich agents already found by
        the process scanner. Does NOT create new agents -- only adds
        session metadata (git branch, model, session_id) to existing ones.
        """
        if not os.path.isdir(CLAUDE_PROJECTS_DIR):
            return

        # Build a cwd -> agent lookup from already-registered agents
        existing_agents = self._agent_manager.get_all_agents()
        if not existing_agents:
            return

        enriched = 0
        for project_dir in os.listdir(CLAUDE_PROJECTS_DIR):
            full_project = os.path.join(CLAUDE_PROJECTS_DIR, project_dir)
            if not os.path.isdir(full_project):
                continue
            for filename in os.listdir(full_project):
                if not filename.endswith(".jsonl"):
                    continue
                file_path = os.path.join(full_project, filename)
                try:
                    state = self._parse_session_state(file_path)
                    if not state or state["status"] == "offline":
                        continue
                    # Try to find an existing agent to enrich (by cwd match)
                    session_cwd = state.get("cwd", "")
                    for agent in existing_agents:
                        if agent.working_directory == session_cwd and not agent.session_data:
                            _, sid = self._agent_manager.find_agent_by_id(agent.id)
                            agent.session_data = {"sessionId": state["session_id"]}
                            if state.get("git_branch"):
                                agent.session_data["gitBranch"] = state["git_branch"]
                            if state.get("model"):
                                agent.session_data["model"] = state["model"]
                            if state.get("agent_name"):
                                agent.name = state["agent_name"]
                            if sid:
                                self._agent_manager.set_agent(sid, agent)
                            enriched += 1
                            break
                except Exception:
                    logger.exception("Error scanning session file: %s", file_path)

        if enriched:
            logger.info("Session watcher enriched %d agent(s) with JSONL metadata", enriched)

    # ------------------------------------------------------------------
    # Agent registration
    # ------------------------------------------------------------------

    def _register_or_update_session(self, session_state: dict):
        """
        Enrich an existing agent with JSONL metadata. Never creates new agents.
        Agent discovery is handled by the process scanner and hooks.
        """
        session_id = session_state["session_id"]
        cwd = session_state.get("cwd")

        # Parse the last_activity timestamp
        last_activity_str = session_state.get("last_activity")
        last_activity = datetime.now(timezone.utc)
        if last_activity_str:
            try:
                last_activity = datetime.fromisoformat(
                    last_activity_str.replace("Z", "+00:00")
                )
            except (ValueError, TypeError):
                pass

        # Find an existing agent to enrich -- match by session_id or cwd
        for agent in self._agent_manager.get_all_agents():
            matched = False
            if agent.session_data and (agent.session_data or {}).get("sessionId") == session_id:
                matched = True
            elif cwd and agent.working_directory == cwd and not agent.session_data:
                matched = True

            if matched:
                _, existing_sid = self._agent_manager.find_agent_by_id(agent.id)
                if not agent.session_data:
                    agent.session_data = {}
                agent.session_data["sessionId"] = session_id
                if session_state.get("git_branch"):
                    agent.session_data["gitBranch"] = session_state["git_branch"]
                if session_state.get("model"):
                    agent.session_data["model"] = session_state["model"]
                agent.last_activity = last_activity
                if existing_sid:
                    self._agent_manager.set_agent(existing_sid, agent)
                self._emit_agent_update()
                return

    def _emit_agent_update(self):
        """
        Safely emit an agent_update event from a background thread.
        Uses asyncio.run_coroutine_threadsafe to schedule the coroutine
        on the main event loop.
        """
        if self._loop is None or self._loop.is_closed():
            return

        async def _broadcast():
            try:
                await self._sio.emit(
                    "agent_update",
                    self._agent_manager.get_all_agents_serialized(),
                )
            except Exception:
                logger.exception("Error broadcasting agent update from session watcher")

        asyncio.run_coroutine_threadsafe(_broadcast(), self._loop)
