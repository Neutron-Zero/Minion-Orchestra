"""
Transcript scanner -- reads JSONL session files incrementally from Claude Code
and Copilot CLI, parses conversation entries, stores to SQLite, and broadcasts
via Socket.IO.

Triggered on each hook event to capture new transcript lines since last scan.
"""

from __future__ import annotations

import json
import os
from typing import Any

import socketio

from database import (
    get_transcript_scan_state,
    store_transcript_entries_batch,
    upsert_transcript_scan_state,
)

CLAUDE_PROJECTS_DIR = os.path.expanduser("~/.claude/projects")
COPILOT_SESSION_DIR = os.path.expanduser("~/.copilot/session-state")
MAX_INITIAL_ENTRIES = 1000


def resolve_jsonl_path(
    working_directory: str, session_id: str, source_tool: str = "claude-code"
) -> str | None:
    """Compute the JSONL file path for a session."""
    if not session_id:
        return None
    if source_tool == "copilot-cli":
        return os.path.join(COPILOT_SESSION_DIR, session_id, "events.jsonl")
    if not working_directory:
        return None
    encoded_cwd = working_directory.replace("/", "-")
    return os.path.join(CLAUDE_PROJECTS_DIR, encoded_cwd, f"{session_id}.jsonl")


class TranscriptScanner:
    def __init__(self, sio: socketio.AsyncServer):
        self._sio = sio
        # In-memory cache to avoid DB reads on every hook
        self._cache: dict[str, dict[str, Any]] = {}

    async def scan_agent(
        self, agent_id: str, session_id: str, working_directory: str,
        source_tool: str = "claude-code",
    ) -> int:
        """Scan an agent's JSONL file for new transcript entries.

        Returns count of new entries stored.
        """
        jsonl_path = resolve_jsonl_path(working_directory, session_id, source_tool)
        if not jsonl_path or not os.path.isfile(jsonl_path):
            return 0

        # Get scan state (cache first, then DB)
        state = self._cache.get(agent_id)
        if state is None:
            state = await get_transcript_scan_state(agent_id)

        current_size = os.path.getsize(jsonl_path)

        # Quick check: file hasn't grown
        if state and current_size <= state.get("last_file_size", 0):
            return 0

        # Session changed? Reset state.
        if state and state.get("session_id") != session_id:
            state = None

        last_size = state["last_file_size"] if state else 0
        last_line = state["last_line_number"] if state else 0

        # Read new complete lines and get actual byte position consumed
        new_lines, new_byte_offset = self._read_new_lines(jsonl_path, last_size)
        if not new_lines:
            return 0

        # Parse into transcript entries
        parser = self._parse_copilot_line if source_tool == "copilot-cli" else self._parse_line
        entries: list[dict[str, Any]] = []
        line_number = last_line
        for raw_line in new_lines:
            line_number += 1
            parsed = parser(raw_line, agent_id, session_id, line_number)
            entries.extend(parsed)

        # Cap initial backfill
        is_initial = state is None
        if is_initial and len(entries) > MAX_INITIAL_ENTRIES:
            entries = entries[-MAX_INITIAL_ENTRIES:]

        if entries:
            await store_transcript_entries_batch(entries)

            # Broadcast new entries
            for entry in entries:
                await self._sio.emit("transcript", {
                    "agent_id": agent_id,
                    "session_id": session_id,
                    **entry,
                })

        # Update scan state with actual byte position consumed
        await upsert_transcript_scan_state(
            agent_id, session_id, jsonl_path, line_number, new_byte_offset,
        )
        self._cache[agent_id] = {
            "session_id": session_id,
            "last_line_number": line_number,
            "last_file_size": new_byte_offset,
        }

        return len(entries)

    @staticmethod
    def _read_new_lines(path: str, byte_offset: int) -> tuple[list[str], int]:
        """Read complete lines from byte_offset forward.

        Returns (lines, new_byte_offset) where new_byte_offset is the file
        position immediately after the last complete line consumed.  This
        avoids the old bug where the first new line was always skipped, and
        also handles the edge case of a partially-written trailing line.
        """
        try:
            with open(path, "rb") as f:
                if byte_offset > 0:
                    f.seek(byte_offset)
                raw = f.read()
            if not raw:
                return [], byte_offset
            # Only process up to the last newline so we never consume a
            # partially-written trailing line.
            last_nl = raw.rfind(b"\n")
            if last_nl == -1:
                # No complete line available yet
                return [], byte_offset
            complete = raw[: last_nl + 1]
            lines = complete.decode("utf-8", errors="replace").splitlines()
            new_offset = byte_offset + last_nl + 1
            return lines, new_offset
        except (OSError, IOError):
            return [], byte_offset

    @staticmethod
    def _parse_line(
        raw_line: str, agent_id: str, session_id: str, line_number: int
    ) -> list[dict[str, Any]]:
        """Parse a single JSONL line into zero or more transcript entries."""
        raw_line = raw_line.strip()
        if not raw_line:
            return []
        try:
            data = json.loads(raw_line)
        except json.JSONDecodeError:
            return []

        entry_type = data.get("type")
        timestamp = data.get("timestamp", "")

        if entry_type == "user":
            return TranscriptScanner._parse_user(data, agent_id, session_id, line_number, timestamp)
        elif entry_type == "assistant":
            return TranscriptScanner._parse_assistant(data, agent_id, session_id, line_number, timestamp)
        # Skip: progress, system, file-history-snapshot, queue-operation, summary, etc.
        return []

    @staticmethod
    def _make_entry(
        agent_id: str, session_id: str, entry_type: str, line_number: int,
        timestamp: str, content: str | None = None, tool_name: str | None = None,
        tool_input: str | None = None, tool_use_id: str | None = None,
        metadata: Any = None,
    ) -> dict[str, Any]:
        return {
            "agent_id": agent_id,
            "session_id": session_id,
            "entry_type": entry_type,
            "content": content,
            "tool_name": tool_name,
            "tool_input": tool_input,
            "tool_use_id": tool_use_id,
            "timestamp": timestamp,
            "line_number": line_number,
            "metadata": metadata,
        }

    @staticmethod
    def _parse_user(
        data: dict, agent_id: str, session_id: str, line_number: int, timestamp: str
    ) -> list[dict[str, Any]]:
        message = data.get("message", {})
        content = message.get("content", "")
        entries: list[dict[str, Any]] = []

        if isinstance(content, str):
            if content.strip():
                entries.append(TranscriptScanner._make_entry(
                    agent_id, session_id, "user", line_number, timestamp,
                    content=content,
                ))
        elif isinstance(content, list):
            for block in content:
                btype = block.get("type", "")
                if btype == "tool_result":
                    text = TranscriptScanner._extract_tool_result_text(block.get("content", ""))
                    entries.append(TranscriptScanner._make_entry(
                        agent_id, session_id, "tool_result", line_number, timestamp,
                        content=text,
                        tool_use_id=block.get("tool_use_id"),
                        metadata={"is_error": block.get("is_error", False)} if block.get("is_error") else None,
                    ))
                elif btype == "text":
                    text = block.get("text", "").strip()
                    if text:
                        entries.append(TranscriptScanner._make_entry(
                            agent_id, session_id, "user", line_number, timestamp,
                            content=text,
                        ))
        return entries

    @staticmethod
    def _parse_assistant(
        data: dict, agent_id: str, session_id: str, line_number: int, timestamp: str
    ) -> list[dict[str, Any]]:
        message = data.get("message", {})
        content = message.get("content", "")
        entries: list[dict[str, Any]] = []

        if isinstance(content, str):
            if content.strip():
                entries.append(TranscriptScanner._make_entry(
                    agent_id, session_id, "assistant", line_number, timestamp,
                    content=content,
                ))
        elif isinstance(content, list):
            for block in content:
                btype = block.get("type", "")
                if btype == "text":
                    text = block.get("text", "").strip()
                    if text:
                        entries.append(TranscriptScanner._make_entry(
                            agent_id, session_id, "assistant", line_number, timestamp,
                            content=text,
                        ))
                elif btype == "thinking":
                    text = block.get("thinking", "").strip()
                    if text:
                        entries.append(TranscriptScanner._make_entry(
                            agent_id, session_id, "assistant", line_number, timestamp,
                            content=text,
                            metadata={"is_thinking": True},
                        ))
                elif btype == "tool_use":
                    tool_input_str = json.dumps(block.get("input", {}))
                    entries.append(TranscriptScanner._make_entry(
                        agent_id, session_id, "tool_use", line_number, timestamp,
                        tool_name=block.get("name"),
                        tool_input=tool_input_str,
                        tool_use_id=block.get("id"),
                    ))
        return entries

    @staticmethod
    def _extract_tool_result_text(content: Any) -> str:
        """Extract displayable text from a tool_result content block."""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    parts.append(item.get("text", ""))
                elif isinstance(item, str):
                    parts.append(item)
            return "\n".join(parts)
        return str(content) if content else ""

    # ------------------------------------------------------------------
    # Copilot CLI JSONL parser
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_copilot_line(
        raw_line: str, agent_id: str, session_id: str, line_number: int
    ) -> list[dict[str, Any]]:
        """Parse a single Copilot events.jsonl line."""
        raw_line = raw_line.strip()
        if not raw_line:
            return []
        try:
            data = json.loads(raw_line)
        except json.JSONDecodeError:
            return []

        entry_type = data.get("type", "")
        timestamp = data.get("timestamp", "")
        payload = data.get("data", {})
        mk = TranscriptScanner._make_entry

        if entry_type == "user.message":
            content = payload.get("content", "")
            if content.strip():
                return [mk(agent_id, session_id, "user", line_number, timestamp, content=content)]

        elif entry_type == "assistant.message":
            entries: list[dict[str, Any]] = []
            # Thinking / reasoning
            reasoning = payload.get("reasoningText", "")
            if reasoning.strip():
                entries.append(mk(
                    agent_id, session_id, "assistant", line_number, timestamp,
                    content=reasoning, metadata={"is_thinking": True},
                ))
            # Text content
            content = payload.get("content", "")
            if content.strip():
                entries.append(mk(
                    agent_id, session_id, "assistant", line_number, timestamp,
                    content=content,
                ))
            # Tool requests
            for tool_req in payload.get("toolRequests", []):
                entries.append(mk(
                    agent_id, session_id, "tool_use", line_number, timestamp,
                    tool_name=tool_req.get("name"),
                    tool_input=json.dumps(tool_req.get("arguments", {})),
                    tool_use_id=tool_req.get("toolCallId"),
                ))
            return entries

        elif entry_type == "tool.execution_complete":
            result = payload.get("result", {})
            if isinstance(result, dict):
                text = result.get("content") or result.get("detailedContent") or ""
            else:
                text = str(result) if result else ""
            return [mk(
                agent_id, session_id, "tool_result", line_number, timestamp,
                content=text,
                tool_use_id=payload.get("toolCallId"),
                metadata={"success": payload.get("success", True)},
            )]

        # Skip: session.start, assistant.turn_start, assistant.turn_end,
        # tool.execution_start, etc.
        return []
