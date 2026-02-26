import warnings
warnings.filterwarnings("ignore")

import logging
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

from contextlib import asynccontextmanager

import socketio
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import config
from routes import router
from services import agent_manager, task_queue, CleanupService, scan_claude_processes
from websocket_handlers import register_handlers

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*", logger=False, engineio_logger=False)

cleanup_service = CleanupService(agent_manager, task_queue, sio)


VERSION = "1.0.0"

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
    out(f"  {p}>{r} Dashboard    {w}http://localhost:4201{r}")
    out()
    out(f"{d}  -----------------------------------------------{r}")
    found = scan_claude_processes(agent_manager)
    if found:
        out(f"  {p}>{r} Found {w}{found}{r} running Claude session{'s' if found != 1 else ''}")
        out()
    out(f"{p}  Waiting for minions to connect...{r}")
    out()
    cleanup_service.start()
    yield
    cleanup_service.stop()


app = FastAPI(title="Minion Command Server", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(router)

app.state.sio = sio
app.state.agent_manager = agent_manager
app.state.task_queue = task_queue
app.state.cleanup_service = cleanup_service

register_handlers(sio, agent_manager, task_queue)

combined = socketio.ASGIApp(sio, other_asgi_app=app)

if __name__ == "__main__":
    uvicorn.run("server:combined", host="0.0.0.0", port=config.port, log_level="warning")
