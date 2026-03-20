import warnings
warnings.filterwarnings("ignore")

import logging
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

import os
import sys
from contextlib import asynccontextmanager


import socketio
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from config import config
from routes import router
from services import agent_manager, task_queue, CleanupService
from websocket_handlers import register_handlers
from database import init_db, close_db, get_completed_sessions
from session_watcher import SessionWatcher
from transcript_scanner import TranscriptScanner

# Path to the pre-built Angular client
CLIENT_DIST = os.path.join(os.path.dirname(__file__), "..", "client", "dist", "minion-orchestra")

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*", logger=False, engineio_logger=False)

cleanup_service = CleanupService(agent_manager, task_queue, sio)
session_watcher = SessionWatcher(agent_manager, sio)
transcript_scanner = TranscriptScanner(sio)

VERSION = "1.9.2"

@asynccontextmanager
async def lifespan(app):
    p = "\033[38;5;135m"   # purple
    b = "\033[1m"          # bold
    d = "\033[2m"          # dim
    w = "\033[97m"         # bright white
    r = "\033[0m"          # reset
    port = config.port
    import sys
    def out(s=""):
        sys.stdout.write(s + "\n")
        sys.stdout.flush()

    import time as _time
    _startup_start = _time.monotonic()

    # Clear screen
    sys.stdout.write("\033[2J\033[H")
    sys.stdout.flush()

    pad = " " * 14
    out(f"{p}{pad}    __  ____       _                 {r}")
    out(f"{p}{pad}   /  |/  (_)___  (_)____  ___       {r}")
    out(f"{p}{pad}  / /|_/ / / __ \\/ / __ \\/ __ \\     {r}")
    out(f"{p}{pad} / /  / / / / / / / /_/ / / / /     {r}")
    out(f"{p}{pad}/_/  /_/_/_/ /_/_/\\____/_/ /_/      {r}")
    out(f"{p}{pad}   ____           __              __            {r}")
    out(f"{p}{pad}  / __ \\_________/ /_  ___  _____/ /___________ {r}")
    out(f"{p}{pad} / / / / ___/ ___/ __ \\/ _ \\/ ___/ __/ ___/ __ \\{r}")
    out(f"{p}{pad}/ /_/ / /  / /__/ / / /  __(__  ) /_/ /  / /_/ /{r}")
    out(f"{p}{pad}\\____/_/   \\___/_/ /_/\\___/____/\\__/_/   \\__,_/ {d}v{VERSION}{r}")
    out()
    line = f"{d}{'─' * 80}{r}"
    out(line)
    out(f"{p}>{r} Dashboard       {w}http://localhost:{port}{r}")
    out(f"{p}>{r} Website         {d}https://minionorchestra.com{r}")
    out(f"{p}>{r} Apache 2.0      {d}https://minionorchestra.com/license.html{r}")
    out(f"{p}>{r} GitHub          {d}https://github.com/Neutron-Zero/Minion-Orchestra{r}")
    out(f"{p}>{r} NeutronZero     {d}https://neutronzero.com{r}")
    out(line)
    out(f"{d}© 2026 Neutron Zero. All rights reserved.{r}")

    g = "\033[32m"   # green
    y = "\033[33m"   # yellow
    check = f"{g}✓{r}"
    bullet = f"{d}[ ]{r}"

    # Startup task labels — laid out in 2 columns
    tasks = [
        "Database",
        "Session history",
        "Cleanup service",
        "Session watcher",
        "Transcript scanner",
        "Discover sessions",
        "Backfill images",
        "Backfill tokens",
        "Backfill transcripts",
    ]

    col2_x = 40  # column 2 starts at this character position
    half = (len(tasks) + 1) // 2  # rows needed = ceil(n/2)

    # Build row pairs: (left_idx, right_idx or None)
    rows = []
    for i in range(half):
        right = i + half if i + half < len(tasks) else None
        rows.append((i, right))

    # Print all tasks as pending in 2 columns
    out()
    out(f"{w}Initializing...{r}")
    for left_idx, right_idx in rows:
        left = f"{bullet} {d}{tasks[left_idx]}{r}"
        if right_idx is not None:
            # Pad left column to col2_x, then add right column
            pad = max(1, col2_x - len(f"[ ] {tasks[left_idx]}"))
            right = f"{' ' * pad}{bullet} {d}{tasks[right_idx]}{r}"
            out(f"{left}{right}")
        else:
            out(left)
    out()

    # Total lines from first row to cursor (including blank line)
    num_rows = len(rows)
    task_block = num_rows + 1
    import asyncio as _aio
    _anim_task = None

    def _task_row(idx):
        """Which display row a task index is on."""
        if idx < half:
            return idx
        return idx - half

    def _task_col(idx):
        """0 = left column, 1 = right column."""
        return 0 if idx < half else 1

    def _write_at(row, col, text):
        """Write text at a specific row and column position."""
        move_up = task_block - row
        sys.stdout.write(f"\033[{move_up}A\r")
        if col == 1:
            sys.stdout.write(f"\033[{col2_x}G")
        sys.stdout.write(f"{text}\033[K\n")
        move_down = task_block - row - 1
        if move_down > 0:
            sys.stdout.write(f"\033[{move_down}B")
        sys.stdout.flush()

    def _render_row(row):
        """Re-render a full row (both columns) to avoid clearing the other column."""
        left_idx, right_idx = rows[row]
        left_text = _row_content.get(left_idx, f"{bullet} {d}{tasks[left_idx]}{r}")
        right_text = _row_content.get(right_idx, f"{bullet} {d}{tasks[right_idx]}{r}") if right_idx is not None else ""
        if right_text:
            pad = max(1, col2_x - len(f"  [ ] {tasks[left_idx]}") - 3)  # approximate
            # Use cursor positioning for right column
            move_up = task_block - row
            sys.stdout.write(f"\033[{move_up}A\r{left_text}\033[{col2_x}G{right_text}\033[K\n")
            move_down = task_block - row - 1
            if move_down > 0:
                sys.stdout.write(f"\033[{move_down}B")
        else:
            move_up = task_block - row
            sys.stdout.write(f"\033[{move_up}A\r{left_text}\033[K\n")
            move_down = task_block - row - 1
            if move_down > 0:
                sys.stdout.write(f"\033[{move_down}B")
        sys.stdout.flush()

    # Track current rendered content per task index
    _row_content = {}

    async def _animate(idx):
        frames = ["", ".", "..", "..."]
        i = 0
        row = _task_row(idx)
        col = _task_col(idx)
        while True:
            prefix = "" if col == 0 else ""
            _row_content[idx] = f"{prefix}{d}[ ]{r} {w}{tasks[idx]}{y}{frames[i % len(frames)]}{r}"
            _render_row(row)
            i += 1
            await _aio.sleep(0.3)

    async def run_task(idx, coro):
        nonlocal _anim_task
        _anim_task = _aio.ensure_future(_animate(idx))
        try:
            result = await coro
        finally:
            _anim_task.cancel()
            try:
                await _anim_task
            except _aio.CancelledError:
                pass
            _anim_task = None
        return result

    def mark_done(idx, detail=""):
        col = _task_col(idx)
        row = _task_row(idx)
        suffix = f" {d}({detail}){r}" if detail else ""
        _row_content[idx] = f"[{check}] {w}{tasks[idx]}{r}{suffix}"
        _render_row(row)

    # 0. Database
    await run_task(0, init_db())
    mark_done(0)

    # 1. Restore sessions
    import json as _json
    from datetime import datetime as _dt

    def _parse_iso(ts):
        try:
            return _dt.fromisoformat(ts.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None

    async def _restore_sessions():
        count = 0
        for s in await get_completed_sessions(100):
            aid = s["agent_id"]
            if agent_manager.find_agent_by_id(aid)[0]:
                continue
            meta = {}
            if s.get("metadata"):
                try:
                    meta = _json.loads(s["metadata"]) if isinstance(s["metadata"], str) else s["metadata"]
                except (ValueError, TypeError):
                    pass
            agent_type = meta.get("type", "claude-code")
            parent_pid = meta.get("parent_pid")
            active_duration = meta.get("active_duration", 0.0)
            agent = agent_manager.create_agent(
                id=aid, socket_id=f"db-{aid}",
                name=s.get("agent_name") or "Claude Agent",
                type=agent_type, status="offline" if s.get("status") not in ("completed", "offline") else s.get("status"),
                working_directory=s.get("working_directory") or "",
                pid=s.get("pid"), parent_pid=parent_pid,
                active_duration=active_duration,
            )
            parsed_start = _parse_iso(s.get("start_time", ""))
            if parsed_start:
                agent.start_time = parsed_start
            last_time = s.get("end_time") or s.get("start_time")
            parsed_last = _parse_iso(last_time or "")
            if parsed_last:
                agent.last_activity = parsed_last
                agent.status_changed_at = parsed_last
            agent_manager.set_agent(f"db-{aid}", agent)
            count += 1
        return count

    restored = await run_task(1, _restore_sessions())
    mark_done(1, f"{restored} sessions" if restored else "none")

    # 2. Cleanup service
    cleanup_service.start()
    mark_done(2)

    # 3. Session watcher
    session_watcher.start()
    mark_done(3)

    # 4. Transcript scanner
    transcript_scanner.start_polling()
    mark_done(4)

    # 5. Discover sessions
    await run_task(5, transcript_scanner.discover_jsonl_sessions())
    mark_done(5)

    # 6. Backfill images
    img_count = await run_task(6, transcript_scanner.backfill_images()) or 0
    mark_done(6, f"{img_count} captured" if img_count else "")

    # 7. Backfill tokens
    tok_count = await run_task(7, transcript_scanner.backfill_tokens()) or 0
    mark_done(7, f"{tok_count} updated" if tok_count else "")

    # 8. Backfill transcripts
    prog_count = await run_task(8, transcript_scanner.backfill_progress()) or 0
    mark_done(8, f"{prog_count} entries" if prog_count else "")

    startup_secs = _time.monotonic() - _startup_start

    # Overwrite "Initializing..." with time — it's (task_block + 1) lines above cursor
    init_up = task_block + 1
    sys.stdout.write(f"\033[{init_up}A\r{w}Initialized{r} {d}({startup_secs:.1f}s){r}\033[K\033[{init_up}B\r")
    sys.stdout.flush()

    # Event counter box — shared state updated by hook endpoint
    BOX_WIDTH = 80
    BOX_MAX_ROWS = 8
    BOX_COLS = 3
    col_width = (BOX_WIDTH - 4) // BOX_COLS  # inner width per column

    # Shared counter dict — hook endpoint increments this
    from collections import OrderedDict
    event_counts = OrderedDict()
    event_flash = {}  # event_type -> tick when last changed (for fade animation)
    _tick_counter = [0]  # mutable so pulse can increment
    app.state.event_counts = event_counts  # expose to routes
    app.state.event_flash = event_flash    # expose to routes

    # Print empty event box + ready line
    out(f"┌─ {w}Events{r} {'─' * (BOX_WIDTH - 11)}┐")
    for _ in range(BOX_MAX_ROWS):
        out(f"│{' ' * (BOX_WIDTH - 2)}│")
    out(f"└{'─' * (BOX_WIDTH - 2)}┘")
    out(f"{g}Ready.{r} Listening for agent events")
    out()

    # Lines from cursor to top border:
    # blank(1) + ready(1) + bottom border(1) + BOX_MAX_ROWS + top border(1)
    # = BOX_MAX_ROWS + 4
    box_block = BOX_MAX_ROWS + 4

    _last_event_count = 0

    # Fade stages for event names: hold purple 4 ticks, then fade → white over 10 steps
    _fade_name = [
        "\033[38;5;135m",  # purple (hold)
        "\033[38;5;135m",
        "\033[38;5;135m",
        "\033[38;5;135m",
        "\033[38;5;134m",  # start fading
        "\033[38;5;140m",
        "\033[38;5;141m",
        "\033[38;5;147m",
        "\033[38;5;183m",
        "\033[38;5;189m",
        "\033[38;5;195m",
        "\033[38;5;255m",  # white (at rest — 256-color to match fade)
    ]
    FADE_STEPS = len(_fade_name)

    def _render_event_box():
        """Re-render the event box contents in place."""
        items = list(event_counts.items())

        for row_idx in range(BOX_MAX_ROWS):
            # Content rows start 1 below top border
            # From cursor: blank(1) + ready(1) + bottom(1) + (BOX_MAX_ROWS - 1 - row_idx) rows below
            up = box_block - 2 - row_idx  # -2 = skip blank + ready + bottom, then count up
            # Actually: cursor is at bottom. Going up:
            # 1 = blank line, 2 = ready line, 3 = bottom border,
            # 3 + (BOX_MAX_ROWS - row_idx) = content row (row 0 is top content row)
            up = 3 + BOX_MAX_ROWS - row_idx
            sys.stdout.write(f"\033[{up}A\r│ \033[K")

            if not items:
                if row_idx == BOX_MAX_ROWS // 2:
                    msg = "Waiting for events..."
                    pad_left = (BOX_WIDTH - 4 - len(msg)) // 2
                    sys.stdout.write(f"{' ' * pad_left}{d}{msg}{r}")
            else:
                for col_idx in range(BOX_COLS):
                    item_idx = row_idx + col_idx * BOX_MAX_ROWS
                    if item_idx < len(items):
                        name, count = items[item_idx]
                        flash_age = event_flash.get(name, FADE_STEPS)
                        fade_idx = min(flash_age, FADE_STEPS - 1)
                        cn = _fade_name[fade_idx]
                        col_start = 3 + col_idx * col_width
                        sys.stdout.write(f"\033[{col_start}G{g}{count:>4} {cn}{name}{r}")

            # Place closing border at column 80
            sys.stdout.write(f"\033[{BOX_WIDTH}G│")

            # Return cursor to bottom
            sys.stdout.write(f"\033[{up}B\r")
        sys.stdout.flush()

        # Age all flash counters (1 step per tick at 0.1s = 1s total fade)
        for evt_name in list(event_flash.keys()):
            event_flash[evt_name] += 1

    # Pulse a green dot to show the server is alive + render event box
    _pulse_task = None
    async def _pulse():
        pulse_on = f"{g}●{r}"
        pulse_off = f"{d}●{r}"
        tick = 0
        PULSE_INTERVAL = 15  # ticks between pulse toggles (15 * 0.1s = 1.5s)
        while True:
            new_total = sum(event_counts.values()) if event_counts else 0
            # Always render — fades progress each tick
            _render_event_box()

            # Re-render top border with event count
            top_up = 3 + BOX_MAX_ROWS + 1
            count_str = f" {d}({new_total}){r}" if new_total > 0 else ""
            header = f"┌─ {w}Events{r}{count_str} "
            visible_header = f"┌─ Events ({new_total}) " if new_total > 0 else "┌─ Events "
            fill = "─" * max(0, BOX_WIDTH - len(visible_header) - 1)
            top_border = f"{header}{fill}┐"
            sys.stdout.write(f"\033[{top_up}A\r{top_border}\033[K\033[{top_up}B\r")

            # Pulse on the ready line (2 lines up from cursor) — toggle every PULSE_INTERVAL ticks
            dot = pulse_on if (tick // PULSE_INTERVAL) % 2 == 0 else pulse_off
            sys.stdout.write(f"\033[2A\r{dot} {g}Ready.{r} Listening for agent events\033[K\n\033[1B")
            sys.stdout.flush()
            tick += 1
            await _aio.sleep(0.1)

    _pulse_task = _aio.ensure_future(_pulse())
    _server_start_time = _time.monotonic()

    yield

    # Stop pulse
    if _pulse_task:
        _pulse_task.cancel()
        try:
            await _pulse_task
        except _aio.CancelledError:
            pass

    # Shutdown: stop background threads first, then async resources
    try:
        transcript_scanner.stop_polling()
    except Exception:
        pass
    try:
        session_watcher.stop()
    except Exception:
        pass
    try:
        cleanup_service.stop()
    except Exception:
        pass
    try:
        await close_db()
    except Exception:
        pass


app = FastAPI(title="Minion Command Server", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# API routes first (take priority over static files)
app.include_router(router)

app.state.sio = sio
app.state.agent_manager = agent_manager
app.state.task_queue = task_queue
app.state.cleanup_service = cleanup_service
app.state.session_watcher = session_watcher
app.state.transcript_scanner = transcript_scanner
app.state.own_claude_pid = None

register_handlers(sio, agent_manager, task_queue)

# Serve the pre-built Angular client
if os.path.isdir(CLIENT_DIST):
    # Catch-all for Angular client-side routing (any path that isn't an API route or static file)
    @app.get("/{path:path}")
    async def serve_angular(path: str):
        # If the path matches a real file in dist, serve it
        file_path = os.path.join(CLIENT_DIST, path)
        if path and os.path.isfile(file_path):
            return FileResponse(file_path)
        # Otherwise return index.html for Angular's router to handle
        return FileResponse(os.path.join(CLIENT_DIST, "index.html"))

combined = socketio.ASGIApp(sio, other_asgi_app=app)


if __name__ == "__main__":
    # Suppress noisy shutdown tracebacks
    logging.getLogger("uvicorn.error").disabled = True
    _main_start = __import__("time").monotonic()

    try:
        uvicorn.run(combined, host="0.0.0.0", port=config.port, log_level="warning")
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        # Session stats on shutdown
        import time as _t
        _d = "\033[2m"
        _w = "\033[97m"
        _r = "\033[0m"
        uptime = _t.monotonic() - _main_start
        h, rem = divmod(int(uptime), 3600)
        m, s = divmod(rem, 60)
        if h > 0:
            ut = f"{h}h {m}m"
        elif m > 0:
            ut = f"{m}m {s}s"
        else:
            ut = f"{s}s"
        # Count agents that had live activity (not just restored from DB)
        live_agents = sum(1 for a in agent_manager.get_all_agents() if not a.socket_id.startswith("db-"))
        print(f"\n{_d}{'─' * 80}{_r}")
        print(f"{_w}Goodbye.{_r} Uptime {_w}{ut}{_r}, {_w}{live_agents}{_r} agent{'s' if live_agents != 1 else ''} active")
        print(f"{_d}{'─' * 80}{_r}\n")
        sys.stdout.flush()
        os._exit(0)

