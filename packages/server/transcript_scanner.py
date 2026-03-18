"""
Transcript scanner -- reads JSONL session files incrementally from Claude Code
and Copilot CLI, parses conversation entries, stores to SQLite, and broadcasts
via Socket.IO.

Triggered on each hook event to capture new transcript lines since last scan.
"""

from __future__ import annotations

import asyncio
import base64
import gzip
import json
import os
import re
import uuid
from typing import Any

import socketio

from database import (
    batch_update_transcript_tokens,
    get_all_scan_states,
    get_entries_needing_backfill,
    get_transcript_scan_state,
    get_unchecked_image_entries,
    store_session,
    store_transcript_entries_batch,
    update_session_tokens,
    update_transcript_entry_metadata,
    upsert_transcript_scan_state,
)

CLAUDE_PROJECTS_DIR = os.path.expanduser("~/.claude/projects")
COPILOT_SESSION_DIR = os.path.expanduser("~/.copilot/session-state")
MAX_INITIAL_ENTRIES = 1000
POLL_INTERVAL = 0.5  # seconds


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
        # Tracked agents for periodic polling: agent_id -> {session_id, working_directory, source_tool}
        self._tracked: dict[str, dict[str, str]] = {}
        self._poll_task: asyncio.Task | None = None

    def track_agent(self, agent_id: str, session_id: str, working_directory: str, source_tool: str = "claude-code"):
        """Register an agent for periodic transcript polling."""
        self._tracked[agent_id] = {
            "session_id": session_id,
            "working_directory": working_directory,
            "source_tool": source_tool,
        }

    def untrack_agent(self, agent_id: str):
        """Stop polling an agent's transcript."""
        self._tracked.pop(agent_id, None)

    def start_polling(self):
        """Start the periodic transcript poll loop."""
        if self._poll_task is None or self._poll_task.done():
            self._poll_task = asyncio.ensure_future(self._poll_loop())

    def stop_polling(self):
        """Stop the periodic poll loop."""
        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()

    async def backfill_images(self):
        """One-time scan of existing entries to capture images before temp files disappear."""
        entries = await get_unchecked_image_entries()
        if not entries:
            return
        captured = 0
        for entry in entries:
            content = entry.get("content", "")
            meta = entry.get("metadata") or {}
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except (json.JSONDecodeError, TypeError):
                    meta = {}
            image_meta = self._capture_image_from_text(content)
            if image_meta:
                meta.update(image_meta)
                captured += 1
            else:
                meta["image_data"] = ""
                meta["image_type"] = ""
            await update_transcript_entry_metadata(entry["id"], meta)
        if captured:
            print(f"  Image backfill: captured {captured} image(s) from {len(entries)} entries")

    async def backfill_tokens(self):
        """One-time backfill: read JSONL files for entries missing raw_entry/token data."""
        scan_states = await get_all_scan_states()
        if not scan_states:
            return

        total_updated = 0
        agents_updated = 0
        for state in scan_states:
            agent_id = state["agent_id"]
            jsonl_path = state.get("jsonl_path", "")
            entries = await get_entries_needing_backfill(agent_id)
            if not entries:
                continue

            # Read the JSONL file
            if not jsonl_path or not os.path.isfile(jsonl_path):
                continue

            try:
                with open(jsonl_path, "r", encoding="utf-8", errors="replace") as f:
                    lines = f.readlines()
            except (OSError, IOError):
                continue

            # Build line_number -> raw_line map
            line_map: dict[int, str] = {}
            for i, line in enumerate(lines, 1):
                line_map[i] = line.strip()

            # Group entries by line_number to assign tokens to first entry only
            from collections import defaultdict
            by_line: dict[int, list[dict]] = defaultdict(list)
            for entry in entries:
                by_line[entry["line_number"]].append(entry)

            updates: list[tuple] = []
            for line_num, line_entries in by_line.items():
                raw_line = line_map.get(line_num, "")
                if not raw_line:
                    continue

                # Extract model/tokens from assistant lines
                model = None
                input_tokens = 0
                output_tokens = 0
                cache_read_tokens = 0
                cache_write_tokens = 0

                try:
                    data = json.loads(raw_line)
                    if data.get("type") == "assistant":
                        message = data.get("message", {})
                        model = message.get("model") or data.get("model")
                        usage = message.get("usage") or {}
                        input_tokens = usage.get("input_tokens", 0)
                        output_tokens = usage.get("output_tokens", 0)
                        cache_read_tokens = usage.get("cache_read_input_tokens", 0) or usage.get("cache_read_tokens", 0)
                        cache_write_tokens = usage.get("cache_creation_input_tokens", 0) or usage.get("cache_write_tokens", 0)
                except (json.JSONDecodeError, TypeError):
                    pass

                first = True
                for entry in line_entries:
                    updates.append((
                        raw_line,
                        model,
                        input_tokens if first else 0,
                        output_tokens if first else 0,
                        cache_read_tokens if first else 0,
                        cache_write_tokens if first else 0,
                        entry["id"],
                    ))
                    first = False

            if updates:
                await batch_update_transcript_tokens(updates)
                await update_session_tokens(agent_id)
                total_updated += len(updates)
                agents_updated += 1

        if total_updated:
            print(f"  Token backfill: updated {total_updated} entries across {agents_updated} agent(s)")

    async def discover_jsonl_sessions(self):
        """Walk ~/.claude/projects/*/*.jsonl and scan any files not already in the DB."""
        if not os.path.isdir(CLAUDE_PROJECTS_DIR):
            return

        # Get all already-known scan states keyed by jsonl_path
        known_states = await get_all_scan_states()
        known_paths = {s.get("jsonl_path", "") for s in known_states}

        discovered = 0
        for project_dir in os.listdir(CLAUDE_PROJECTS_DIR):
            project_path = os.path.join(CLAUDE_PROJECTS_DIR, project_dir)
            if not os.path.isdir(project_path):
                continue
            # Decode working directory from folder name: "-Users-..." -> "/Users/..."
            working_directory = project_dir.replace("-", "/", 1) if project_dir.startswith("-") else project_dir
            # All dashes after the leading one are also path separators
            working_directory = "/" + project_dir[1:].replace("-", "/") if project_dir.startswith("-") else project_dir

            for fname in os.listdir(project_path):
                if not fname.endswith(".jsonl"):
                    continue
                jsonl_path = os.path.join(project_path, fname)
                if jsonl_path in known_paths:
                    continue

                session_id = fname.replace(".jsonl", "")
                # Use session_id as agent_id for discovered sessions
                agent_id = session_id

                # Extract metadata from first few lines
                agent_name = "Claude Agent"
                start_time = None
                cwd = None
                try:
                    with open(jsonl_path, "r", encoding="utf-8", errors="replace") as f:
                        for i, line in enumerate(f):
                            if i > 10:
                                break
                            try:
                                obj = json.loads(line)
                                if obj.get("cwd") and not cwd:
                                    cwd = obj["cwd"]
                                if obj.get("timestamp") and not start_time:
                                    start_time = obj["timestamp"]
                            except (json.JSONDecodeError, TypeError):
                                continue
                except (OSError, IOError):
                    continue

                effective_cwd = cwd or working_directory

                # Create a session record
                await store_session(
                    agent_id=agent_id,
                    agent_name=agent_name,
                    status="completed",
                    working_directory=effective_cwd,
                    start_time=start_time,
                )

                # Scan the full file
                try:
                    count = await self.scan_agent(agent_id, session_id, effective_cwd)
                    if count > 0:
                        discovered += 1
                except Exception as e:
                    print(f"  Discovery scan error for {session_id}: {e}")

        if discovered:
            print(f"  Discovered and scanned {discovered} JSONL session(s) from disk")

    async def _poll_loop(self):
        """Periodically scan all tracked agents for new transcript entries."""
        while True:
            try:
                await asyncio.sleep(POLL_INTERVAL)
                for agent_id, info in list(self._tracked.items()):
                    try:
                        await self.scan_agent(
                            agent_id, info["session_id"],
                            info["working_directory"], info["source_tool"],
                        )
                    except Exception:
                        pass
            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(1)

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

        has_tokens = False
        if entries:
            has_tokens = any(e.get("input_tokens", 0) > 0 or e.get("output_tokens", 0) > 0 for e in entries)
            await store_transcript_entries_batch(entries)

            # Broadcast new entries (exclude raw_entry from socket payload)
            for entry in entries:
                payload = {k: v for k, v in entry.items() if k != "raw_entry"}
                await self._sio.emit("transcript", {
                    "agent_id": agent_id,
                    "session_id": session_id,
                    **payload,
                })

            if has_tokens:
                await update_session_tokens(agent_id)

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
            entries = TranscriptScanner._parse_user(data, agent_id, session_id, line_number, timestamp)
        elif entry_type == "assistant":
            entries = TranscriptScanner._parse_assistant(data, agent_id, session_id, line_number, timestamp)
        else:
            # Skip: progress, system, file-history-snapshot, queue-operation, summary, etc.
            return []

        # Stamp raw_entry on all entries from this line
        for e in entries:
            e["raw_entry"] = raw_line
        return entries

    @staticmethod
    def _make_entry(
        agent_id: str, session_id: str, entry_type: str, line_number: int,
        timestamp: str, content: str | None = None, tool_name: str | None = None,
        tool_input: str | None = None, tool_use_id: str | None = None,
        metadata: Any = None, raw_entry: str | None = None, model: str | None = None,
        input_tokens: int = 0, output_tokens: int = 0,
        cache_read_tokens: int = 0, cache_write_tokens: int = 0,
    ) -> dict[str, Any]:
        return {
            "id": str(uuid.uuid4()),
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
            "raw_entry": raw_entry,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_read_tokens": cache_read_tokens,
            "cache_write_tokens": cache_write_tokens,
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
                # If this contains an image reference, capture the image and keep the full text
                image_meta = TranscriptScanner._capture_image_from_text(content)
                entries.append(TranscriptScanner._make_entry(
                    agent_id, session_id, "user", line_number, timestamp,
                    content=content,
                    metadata=image_meta,
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
                elif btype == "image":
                    pass
                elif btype == "text":
                    text = block.get("text", "").strip()
                    if not text:
                        continue
                    image_meta = TranscriptScanner._capture_image_from_text(text)
                    entries.append(TranscriptScanner._make_entry(
                        agent_id, session_id, "user", line_number, timestamp,
                        content=text,
                        metadata=image_meta,
                    ))
        return entries

    @staticmethod
    def _parse_assistant(
        data: dict, agent_id: str, session_id: str, line_number: int, timestamp: str
    ) -> list[dict[str, Any]]:
        message = data.get("message", {})
        content = message.get("content", "")
        entries: list[dict[str, Any]] = []

        # Extract model and token usage from the message envelope
        model = message.get("model") or data.get("model")
        usage = message.get("usage") or {}
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)
        cache_read_tokens = usage.get("cache_read_input_tokens", 0) or usage.get("cache_read_tokens", 0)
        cache_write_tokens = usage.get("cache_creation_input_tokens", 0) or usage.get("cache_write_tokens", 0)

        # First entry per line gets the token counts (prevents double-counting)
        first_entry = True

        if isinstance(content, str):
            if content.strip():
                entries.append(TranscriptScanner._make_entry(
                    agent_id, session_id, "assistant", line_number, timestamp,
                    content=content, model=model,
                    input_tokens=input_tokens if first_entry else 0,
                    output_tokens=output_tokens if first_entry else 0,
                    cache_read_tokens=cache_read_tokens if first_entry else 0,
                    cache_write_tokens=cache_write_tokens if first_entry else 0,
                ))
                first_entry = False
        elif isinstance(content, list):
            for block in content:
                btype = block.get("type", "")
                if btype == "text":
                    text = block.get("text", "").strip()
                    if text:
                        entries.append(TranscriptScanner._make_entry(
                            agent_id, session_id, "assistant", line_number, timestamp,
                            content=text, model=model,
                            input_tokens=input_tokens if first_entry else 0,
                            output_tokens=output_tokens if first_entry else 0,
                            cache_read_tokens=cache_read_tokens if first_entry else 0,
                            cache_write_tokens=cache_write_tokens if first_entry else 0,
                        ))
                        first_entry = False
                elif btype == "thinking":
                    text = block.get("thinking", "").strip()
                    if text:
                        entries.append(TranscriptScanner._make_entry(
                            agent_id, session_id, "assistant", line_number, timestamp,
                            content=text, model=model,
                            metadata={"is_thinking": True},
                            input_tokens=input_tokens if first_entry else 0,
                            output_tokens=output_tokens if first_entry else 0,
                            cache_read_tokens=cache_read_tokens if first_entry else 0,
                            cache_write_tokens=cache_write_tokens if first_entry else 0,
                        ))
                        first_entry = False
                elif btype == "tool_use":
                    tool_input_str = json.dumps(block.get("input", {}))
                    entries.append(TranscriptScanner._make_entry(
                        agent_id, session_id, "tool_use", line_number, timestamp,
                        tool_name=block.get("name"),
                        tool_input=tool_input_str,
                        tool_use_id=block.get("id"),
                        model=model,
                        input_tokens=input_tokens if first_entry else 0,
                        output_tokens=output_tokens if first_entry else 0,
                        cache_read_tokens=cache_read_tokens if first_entry else 0,
                        cache_write_tokens=cache_write_tokens if first_entry else 0,
                    ))
                    first_entry = False
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
    # Image capture helpers
    # ------------------------------------------------------------------

    _IMAGE_PATH_RE = re.compile(r'\[Image:\s*source:\s*(.+?)\]')
    _IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff'}

    @staticmethod
    def _capture_image_file(file_path: str) -> dict[str, Any] | None:
        """Read an image file, gzip compress, base64 encode. Returns metadata dict or None."""
        if not file_path or not os.path.isfile(file_path):
            return None
        ext = os.path.splitext(file_path)[1].lower()
        if ext not in TranscriptScanner._IMAGE_EXTENSIONS:
            return None
        try:
            with open(file_path, "rb") as f:
                raw = f.read()
            if not raw or len(raw) > 20_000_000:  # skip files > 20MB
                return None
            compressed = gzip.compress(raw, compresslevel=6)
            encoded = base64.b64encode(compressed).decode("ascii")
            image_type = {
                '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png',
                '.gif': 'gif', '.webp': 'webp', '.bmp': 'bmp', '.tiff': 'tiff',
            }.get(ext, 'png')
            return {"image_data": encoded, "image_type": image_type}
        except (OSError, IOError):
            return None

    @staticmethod
    def _capture_image_from_text(text: str) -> dict[str, Any] | None:
        """Check if text contains an [Image: source: ...] reference and capture it."""
        match = TranscriptScanner._IMAGE_PATH_RE.search(text)
        if not match:
            return None
        return TranscriptScanner._capture_image_file(match.group(1).strip())

    @staticmethod
    def _capture_image_from_source(source: dict) -> dict[str, Any] | None:
        """Capture image from an image block's source dict."""
        if source.get("type") == "base64":
            # Already base64 — gzip compress and store
            data = source.get("data", "")
            media_type = source.get("media_type", "image/png")
            if not data:
                return None
            try:
                raw = base64.b64decode(data)
                compressed = gzip.compress(raw, compresslevel=6)
                encoded = base64.b64encode(compressed).decode("ascii")
                image_type = media_type.split("/")[-1] if "/" in media_type else "png"
                return {"image_data": encoded, "image_type": image_type}
            except Exception:
                return None
        # File path source
        file_path = source.get("file_path") or source.get("url") or ""
        return TranscriptScanner._capture_image_file(file_path)

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

        entries: list[dict[str, Any]] = []

        if entry_type == "user.message":
            content = payload.get("content", "")
            if content.strip():
                entries = [mk(agent_id, session_id, "user", line_number, timestamp, content=content)]

        elif entry_type == "assistant.message":
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

        elif entry_type == "tool.execution_complete":
            result = payload.get("result", {})
            if isinstance(result, dict):
                text = result.get("content") or result.get("detailedContent") or ""
            else:
                text = str(result) if result else ""
            entries = [mk(
                agent_id, session_id, "tool_result", line_number, timestamp,
                content=text,
                tool_use_id=payload.get("toolCallId"),
                metadata={"success": payload.get("success", True)},
            )]

        # Stamp raw_entry on all entries from this line
        for e in entries:
            e["raw_entry"] = raw_line
        return entries
