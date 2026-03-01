import warnings
warnings.filterwarnings("ignore")

import logging
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

import os
from contextlib import asynccontextmanager

import socketio
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from config import config
from routes import router
from services import agent_manager, task_queue, CleanupService, scan_claude_processes
from websocket_handlers import register_handlers
from database import init_db, close_db, get_completed_sessions
from session_watcher import SessionWatcher

# Path to the pre-built Angular client
CLIENT_DIST = os.path.join(os.path.dirname(__file__), "..", "client", "dist", "minion-orchestra")

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*", logger=False, engineio_logger=False)

cleanup_service = CleanupService(agent_manager, task_queue, sio)
session_watcher = SessionWatcher(agent_manager, sio)

VERSION = "1.4.5"

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

    out()
    out(f"{p}    __  ____       _                 {r}")
    out(f"{p}   /  |/  (_)___  (_)____  ____      {r}")
    out(f"{p}  / /|_/ / / __ \\/ / __ \\/ __ \\     {r}")
    out(f"{p} / /  / / / / / / / /_/ / / / /     {r}")
    out(f"{p}/_/  /_/_/_/ /_/_/\\____/_/ /_/      {r}")
    out(f"{p}   ____           __               __           {r}")
    out(f"{p}  / __ \\_________/ /_  ___  _____/ /__________ {r}")
    out(f"{p} / / / / ___/ ___/ __ \\/ _ \\/ ___/ __/ ___/ __ \\{r}")
    out(f"{p}/ /_/ / /  / /__/ / / /  __(__  ) /_/ /  / /_/ /{r}")
    out(f"{p}\\____/_/   \\___/_/ /_/\\___/____/\\__/_/   \\__,_/ {r}")
    out()
    out(f"{d}  -----------------------------------------------{r}")
    out(f"{w}  {b}Server v{VERSION}{r}")
    out(f"{d}  -----------------------------------------------{r}")
    out()
    out(f"  {p}>{r} Dashboard    {w}http://localhost:{port}{r}")
    out()
    out(f"{d}  -----------------------------------------------{r}")
    found = scan_claude_processes(agent_manager)
    if found:
        out(f"  {p}>{r} Found {w}{found}{r} running Claude session{'s' if found != 1 else ''}")
        out()
    out(f"{p}  Waiting for minions to connect...{r}")
    out()
    await init_db()
    # Restore completed/offline agents from database
    import json as _json
    restored = 0
    for s in await get_completed_sessions(100):
        if agent_manager.find_agent_by_id(s["id"])[0]:
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
            id=s["id"], socket_id=f"db-{s['id']}",
            name=s.get("agent_name") or "Claude Agent",
            type=agent_type, status=s.get("status") or "offline",
            working_directory=s.get("working_directory") or "",
            pid=s.get("pid"), parent_pid=parent_pid,
            active_duration=active_duration,
        )
        from datetime import datetime as _dt
        if s.get("start_time"):
            try:
                agent.start_time = _dt.fromisoformat(s["start_time"])
            except (ValueError, TypeError):
                pass
        if s.get("end_time"):
            try:
                agent.last_activity = _dt.fromisoformat(s["end_time"])
                agent.status_changed_at = _dt.fromisoformat(s["end_time"])
            except (ValueError, TypeError):
                pass
        agent_manager.set_agent(f"db-{s['id']}", agent)
        restored += 1
    if restored:
        out(f"  {p}>{r} Restored {w}{restored}{r} session{'s' if restored != 1 else ''} from database")
        out()
    cleanup_service.start()
    session_watcher.start()
    yield
    # Shutdown: stop background threads first, then async resources
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
    try:
        uvicorn.run("server:combined", host="0.0.0.0", port=config.port, log_level="warning")
    except (KeyboardInterrupt, SystemExit):
        pass
