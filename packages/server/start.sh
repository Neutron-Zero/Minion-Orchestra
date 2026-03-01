#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

# Install Python deps if missing
python3 -c "import fastapi, aiosqlite, watchdog, eval_type_backport" 2>/dev/null || pip3 install -q fastapi "uvicorn[standard]" python-socketio psutil aiofiles aiosqlite watchdog eval_type_backport

cd "$DIR"
exec python3 -W ignore server.py
