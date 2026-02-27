#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

# Install Python deps if missing
python3 -c "import fastapi, aiosqlite, watchdog" 2>/dev/null || pip3 install -q fastapi "uvicorn[standard]" python-socketio psutil aiofiles aiosqlite watchdog

cd "$DIR"
exec python3 -W ignore server.py
