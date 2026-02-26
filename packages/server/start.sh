#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

# Install deps if missing
python3 -c "import fastapi" 2>/dev/null || pip3 install -q fastapi "uvicorn[standard]" python-socketio psutil aiofiles

cd "$DIR"
exec python3 -W ignore server.py
