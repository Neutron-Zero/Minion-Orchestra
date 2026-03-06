"""
Terminal focus and quick actions module for Minion Orchestra.

Supports three terminals:
  - Terminal.app (primary)
  - iTerm2
  - tmux

Auto-detects which terminal a session is running in by walking the
parent process tree.
"""

import asyncio
from typing import Optional

import psutil


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _escape_applescript(text: str) -> str:
    """Escape a string for safe embedding inside AppleScript double-quotes."""
    text = text.replace("\\", "\\\\")
    text = text.replace('"', '\\"')
    return text


def get_tty_for_pid(pid: int) -> Optional[str]:
    """Return the TTY device path for *pid*, or None if unavailable."""
    try:
        proc = psutil.Process(pid)
        tty = proc.terminal()
        return tty
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        return None


# ---------------------------------------------------------------------------
# Terminal detection
# ---------------------------------------------------------------------------

def detect_terminal(pid: int) -> Optional[str]:
    """Walk the parent process tree and return the terminal type.

    Returns one of ``"terminal.app"``, ``"iterm2"``, ``"tmux"``, or ``None``.
    """
    try:
        proc = psutil.Process(pid)
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        return None

    visited: set[int] = set()
    current: Optional[psutil.Process] = proc

    while current is not None:
        if current.pid in visited:
            break
        visited.add(current.pid)

        try:
            name = current.name()
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            break

        lower_name = name.lower()

        if lower_name == "terminal" or lower_name == "terminal.app":
            return "terminal.app"

        if "iterm2" in lower_name or lower_name == "iterm":
            return "iterm2"

        # tmux server process is simply called "tmux"
        if lower_name == "tmux: server" or lower_name == "tmux":
            return "tmux"

        try:
            current = current.parent()
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            break

    return None


# ---------------------------------------------------------------------------
# Internal helpers — subprocess execution
# ---------------------------------------------------------------------------

async def _run_applescript(script: str) -> tuple[str, str, int]:
    """Execute an AppleScript string asynchronously via ``osascript``.

    Returns ``(stdout, stderr, returncode)``.
    """
    proc = await asyncio.create_subprocess_exec(
        "osascript", "-e", script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return (
        stdout.decode("utf-8", errors="replace").strip(),
        stderr.decode("utf-8", errors="replace").strip(),
        proc.returncode,
    )


async def _run_command(*args: str) -> tuple[str, str, int]:
    """Run an arbitrary command asynchronously.

    Returns ``(stdout, stderr, returncode)``.
    """
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return (
        stdout.decode("utf-8", errors="replace").strip(),
        stderr.decode("utf-8", errors="replace").strip(),
        proc.returncode,
    )


# ---------------------------------------------------------------------------
# Terminal.app
# ---------------------------------------------------------------------------

async def _focus_terminal_app(pid: int) -> dict:
    tty = get_tty_for_pid(pid)
    if tty is None:
        return {"success": False, "terminal": "terminal.app", "error": f"Could not determine TTY for PID {pid}"}

    safe_tty = _escape_applescript(tty)
    script = (
        'tell application "Terminal"\n'
        "    activate\n"
        "    set windowList to every window\n"
        "    repeat with w in windowList\n"
        "        repeat with t in every tab of w\n"
        f'            if tty of t contains "{safe_tty}" then\n'
        "                set selected tab of w to t\n"
        "                set index of w to 1\n"
        "                return\n"
        "            end if\n"
        "        end repeat\n"
        "    end repeat\n"
        "end tell"
    )

    _stdout, stderr, rc = await _run_applescript(script)
    if rc != 0:
        return {"success": False, "terminal": "terminal.app", "error": stderr or f"osascript exited with code {rc}"}
    return {"success": True, "terminal": "terminal.app", "error": None}


async def _send_input_terminal_app(pid: int, text: str) -> dict:
    tty = get_tty_for_pid(pid)
    if tty is None:
        return {"success": False, "terminal": "terminal.app", "error": f"Could not determine TTY for PID {pid}"}

    safe_tty = _escape_applescript(tty)
    safe_text = _escape_applescript(text)
    script = (
        'tell application "Terminal"\n'
        "    repeat with w in every window\n"
        "        repeat with t in every tab of w\n"
        f'            if tty of t contains "{safe_tty}" then\n'
        f'                do script "{safe_text}" in t\n'
        "                return\n"
        "            end if\n"
        "        end repeat\n"
        "    end repeat\n"
        "end tell"
    )

    _stdout, stderr, rc = await _run_applescript(script)
    if rc != 0:
        return {"success": False, "terminal": "terminal.app", "error": stderr or f"osascript exited with code {rc}"}
    return {"success": True, "terminal": "terminal.app", "error": None}


# ---------------------------------------------------------------------------
# iTerm2
# ---------------------------------------------------------------------------

async def _focus_iterm2(pid: int) -> dict:
    tty = get_tty_for_pid(pid)
    if tty is None:
        return {"success": False, "terminal": "iterm2", "error": f"Could not determine TTY for PID {pid}"}

    safe_tty = _escape_applescript(tty)
    script = (
        'tell application "iTerm2"\n'
        "    activate\n"
        "    repeat with w in every window\n"
        "        repeat with t in every tab of w\n"
        "            repeat with s in every session of t\n"
        f'                if tty of s contains "{safe_tty}" then\n'
        "                    select t\n"
        "                    select s\n"
        "                    return\n"
        "                end if\n"
        "            end repeat\n"
        "        end repeat\n"
        "    end repeat\n"
        "end tell"
    )

    _stdout, stderr, rc = await _run_applescript(script)
    if rc != 0:
        return {"success": False, "terminal": "iterm2", "error": stderr or f"osascript exited with code {rc}"}
    return {"success": True, "terminal": "iterm2", "error": None}


async def _send_input_iterm2(pid: int, text: str) -> dict:
    tty = get_tty_for_pid(pid)
    if tty is None:
        return {"success": False, "terminal": "iterm2", "error": f"Could not determine TTY for PID {pid}"}

    safe_tty = _escape_applescript(tty)
    safe_text = _escape_applescript(text)
    script = (
        'tell application "iTerm2"\n'
        "    repeat with w in every window\n"
        "        repeat with t in every tab of w\n"
        "            repeat with s in every session of t\n"
        f'                if tty of s contains "{safe_tty}" then\n'
        f'                    tell s to write text "{safe_text}"\n'
        "                    return\n"
        "                end if\n"
        "            end repeat\n"
        "        end repeat\n"
        "    end repeat\n"
        "end tell"
    )

    _stdout, stderr, rc = await _run_applescript(script)
    if rc != 0:
        return {"success": False, "terminal": "iterm2", "error": stderr or f"osascript exited with code {rc}"}
    return {"success": True, "terminal": "iterm2", "error": None}


# ---------------------------------------------------------------------------
# tmux
# ---------------------------------------------------------------------------

async def _find_tmux_pane(pid: int) -> Optional[dict]:
    """Locate the tmux pane that owns *pid* (or one of its ancestors).

    Returns a dict ``{"session": ..., "window": ..., "pane": ...}`` or
    ``None`` if the pane could not be found.
    """
    stdout, _stderr, rc = await _run_command(
        "tmux", "list-panes", "-a", "-F",
        "#{pane_pid} #{session_name} #{window_index} #{pane_index}",
    )
    if rc != 0 or not stdout:
        return None

    # Build a mapping from pane-PID to pane info.
    pane_pids: dict[int, dict] = {}
    for line in stdout.splitlines():
        parts = line.split()
        if len(parts) != 4:
            continue
        try:
            pane_pid = int(parts[0])
        except ValueError:
            continue
        pane_pids[pane_pid] = {
            "session": parts[1],
            "window": parts[2],
            "pane": parts[3],
        }

    # Walk from the given PID upward through parents to find a matching
    # tmux pane PID.
    try:
        proc = psutil.Process(pid)
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        return None

    visited: set[int] = set()
    current: Optional[psutil.Process] = proc

    while current is not None:
        if current.pid in visited:
            break
        visited.add(current.pid)

        if current.pid in pane_pids:
            return pane_pids[current.pid]

        try:
            current = current.parent()
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            break

    return None


async def _focus_tmux(pid: int) -> dict:
    pane_info = await _find_tmux_pane(pid)
    if pane_info is None:
        return {"success": False, "terminal": "tmux", "error": f"Could not find tmux pane for PID {pid}"}

    session = pane_info["session"]
    window = pane_info["window"]
    pane = pane_info["pane"]

    # Select the window, then the pane.
    _stdout1, stderr1, rc1 = await _run_command(
        "tmux", "select-window", "-t", f"{session}:{window}",
    )
    if rc1 != 0:
        return {"success": False, "terminal": "tmux", "error": stderr1 or f"tmux select-window failed (exit {rc1})"}

    _stdout2, stderr2, rc2 = await _run_command(
        "tmux", "select-pane", "-t", f"{session}:{window}.{pane}",
    )
    if rc2 != 0:
        return {"success": False, "terminal": "tmux", "error": stderr2 or f"tmux select-pane failed (exit {rc2})"}

    return {"success": True, "terminal": "tmux", "error": None}


async def _send_input_tmux(pid: int, text: str) -> dict:
    pane_info = await _find_tmux_pane(pid)
    if pane_info is None:
        return {"success": False, "terminal": "tmux", "error": f"Could not find tmux pane for PID {pid}"}

    session = pane_info["session"]
    window = pane_info["window"]
    pane = pane_info["pane"]

    target = f"{session}:{window}.{pane}"
    _stdout, stderr, rc = await _run_command(
        "tmux", "send-keys", "-t", target, text, "Enter",
    )
    if rc != 0:
        return {"success": False, "terminal": "tmux", "error": stderr or f"tmux send-keys failed (exit {rc})"}

    return {"success": True, "terminal": "tmux", "error": None}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_FOCUS_DISPATCH = {
    "terminal.app": _focus_terminal_app,
    "iterm2": _focus_iterm2,
    "tmux": _focus_tmux,
}

_SEND_INPUT_DISPATCH = {
    "terminal.app": _send_input_terminal_app,
    "iterm2": _send_input_iterm2,
    "tmux": _send_input_tmux,
}


async def focus_session(pid: int, terminal_type: Optional[str] = None) -> dict:
    """Bring the terminal window/pane containing *pid* to the foreground.

    If *terminal_type* is ``None`` it will be auto-detected by walking the
    parent process tree.

    Returns ``{"success": bool, "terminal": str|None, "error": str|None}``.
    """
    if terminal_type is None:
        terminal_type = detect_terminal(pid)

    if terminal_type is None:
        return {"success": False, "terminal": None, "error": f"Could not detect terminal type for PID {pid}"}

    handler = _FOCUS_DISPATCH.get(terminal_type)
    if handler is None:
        return {"success": False, "terminal": terminal_type, "error": f"Unsupported terminal type: {terminal_type}"}

    try:
        return await handler(pid)
    except Exception as exc:
        return {"success": False, "terminal": terminal_type, "error": str(exc)}


async def send_input(pid: int, text: str, terminal_type: Optional[str] = None) -> dict:
    """Send *text* as input to the terminal pane where *pid* is running.

    If *terminal_type* is ``None`` it will be auto-detected by walking the
    parent process tree.

    Returns ``{"success": bool, "terminal": str|None, "error": str|None}``.
    """
    if terminal_type is None:
        terminal_type = detect_terminal(pid)

    if terminal_type is None:
        return {"success": False, "terminal": None, "error": f"Could not detect terminal type for PID {pid}"}

    handler = _SEND_INPUT_DISPATCH.get(terminal_type)
    if handler is None:
        return {"success": False, "terminal": terminal_type, "error": f"Unsupported terminal type: {terminal_type}"}

    try:
        return await handler(pid, text)
    except Exception as exc:
        return {"success": False, "terminal": terminal_type, "error": str(exc)}
