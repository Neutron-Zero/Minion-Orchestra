#!/usr/bin/env python3
"""
Minion Orchestra Hook for GitHub Copilot CLI

Translates Copilot CLI hook events into the Minion Orchestra HookEvent format
and sends them to the server. Copilot hooks use camelCase event names, millisecond
timestamps, and a different JSON structure than Claude Code hooks.

Copilot hook stdin format (all events include sessionId, timestamp, cwd):
  sessionStart:         { sessionId, timestamp, cwd, source, initialPrompt }
  sessionEnd:           { sessionId, timestamp, cwd, reason }
  userPromptSubmitted:  { sessionId, timestamp, cwd, prompt }
  preToolUse:           { sessionId, timestamp, cwd, toolName, toolArgs (string or dict) }
  postToolUse:          { sessionId, timestamp, cwd, toolName, toolArgs, toolResult }
  errorOccurred:        { sessionId, timestamp, cwd, error: { message, name, stack } }
"""

import json
import sys
import os
import hashlib
from urllib import request, error
from datetime import datetime, timezone

# Configuration
MINION_ORCHESTRA_URL = os.environ.get('MINION_ORCHESTRA_URL', 'http://localhost:3000')
HOOK_ENDPOINT = f"{MINION_ORCHESTRA_URL}/api/hook"

# The event type is passed as the first argument by the hooks config
# e.g. copilot_hook.py sessionStart
COPILOT_EVENT_TYPE = sys.argv[1] if len(sys.argv) > 1 else None

# Map Copilot camelCase event names to Minion Orchestra PascalCase
EVENT_MAP = {
    "sessionStart": "SessionStart",
    "sessionEnd": "SessionEnd",
    "userPromptSubmitted": "UserPromptSubmit",
    "preToolUse": "PreToolUse",
    "postToolUse": "PostToolUse",
    "errorOccurred": "PostToolUseFailure",
}

# Log directory
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(SCRIPT_DIR, '..', 'packages', 'server', 'logs')
LOG_FILE = os.path.join(LOG_DIR, 'hook-client.log')


def get_copilot_pid():
    """Get the long-lived Copilot process PID (grandparent).

    Process tree: copilot-cli -> sh -> python3 hook.py
    os.getppid() gives the ephemeral shell PID; we want the grandparent.
    """
    ppid = os.getppid()
    try:
        import psutil
        gpid = psutil.Process(ppid).ppid()
        if gpid > 1:
            return gpid
    except Exception:
        pass
    return ppid


def log_message(message):
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        with open(LOG_FILE, 'a') as f:
            f.write(f"[{timestamp}] [copilot] {message}\n")
    except Exception:
        pass


def ms_to_iso(ms_timestamp):
    """Convert millisecond timestamp to ISO 8601 string."""
    if not ms_timestamp:
        return datetime.now(timezone.utc).isoformat()
    try:
        return datetime.fromtimestamp(ms_timestamp / 1000, tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return datetime.now(timezone.utc).isoformat()


def parse_tool_args(tool_args):
    """Parse toolArgs which is a JSON string inside the JSON payload."""
    if not tool_args:
        return {}
    if isinstance(tool_args, dict):
        return tool_args
    try:
        return json.loads(tool_args)
    except (json.JSONDecodeError, TypeError):
        return {"raw": tool_args}


def translate_event(event_type, copilot_data):
    """Translate Copilot event data into Minion Orchestra's data dict format."""
    data = {
        "hook_event_name": EVENT_MAP.get(event_type, event_type),
        "cwd": copilot_data.get("cwd", ""),
        "source_tool": "copilot-cli",
        "session_id": copilot_data.get("sessionId", ""),
    }

    if event_type == "sessionStart":
        data["source"] = copilot_data.get("source", "new")
        prompt = copilot_data.get("initialPrompt")
        if prompt:
            data["prompt"] = prompt

    elif event_type == "sessionEnd":
        data["reason"] = copilot_data.get("reason", "unknown")

    elif event_type == "userPromptSubmitted":
        data["prompt"] = copilot_data.get("prompt", "")

    elif event_type == "preToolUse":
        tool_args = parse_tool_args(copilot_data.get("toolArgs"))
        data["tool_name"] = copilot_data.get("toolName", "Unknown")
        data["tool_input"] = tool_args

    elif event_type == "postToolUse":
        tool_args = parse_tool_args(copilot_data.get("toolArgs"))
        result = copilot_data.get("toolResult", {})
        data["tool_name"] = copilot_data.get("toolName", "Unknown")
        data["tool_input"] = tool_args
        if isinstance(result, dict):
            data["result_type"] = result.get("resultType", "")
            data["error"] = result.get("textResultForLlm") if result.get("resultType") == "error" else None

    elif event_type == "errorOccurred":
        err = copilot_data.get("error", {})
        data["tool_name"] = err.get("name", "Error")
        data["error"] = err.get("message", "Unknown error")
        data["is_interrupt"] = False

    return data


def send_to_minion_orchestra(payload):
    try:
        headers = {'Content-Type': 'application/json'}
        req = request.Request(
            HOOK_ENDPOINT,
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
            method='POST'
        )
        with request.urlopen(req, timeout=1) as response:
            log_message(f"Sent {payload['eventType']} - Status: {response.status}")
            return response.status == 200
    except Exception as e:
        log_message(f"Failed to send {payload.get('eventType', '?')}: {e}")
        return False


def main():
    if not COPILOT_EVENT_TYPE:
        log_message("No event type argument provided")
        json.dump({}, sys.stdout)
        return

    try:
        copilot_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        log_message(f"Failed to parse stdin: {e}")
        json.dump({}, sys.stdout)
        return

    log_message(f"Received {COPILOT_EVENT_TYPE}: {json.dumps(copilot_data)[:200]}")

    # Map event type
    mo_event_type = EVENT_MAP.get(COPILOT_EVENT_TYPE)
    if not mo_event_type:
        log_message(f"Unknown event type: {COPILOT_EVENT_TYPE}")
        json.dump({}, sys.stdout)
        return

    # Use Copilot's sessionId as the stable agent identity (each hook invocation
    # spawns a new process, so os.getppid() changes every time)
    session_id = copilot_data.get("sessionId", "")
    if session_id:
        # Deterministic hash (hashlib, not hash() which is randomized per process)
        digest = hashlib.md5(session_id.encode()).hexdigest()
        id_suffix = str(int(digest[:10], 16))[-5:]
        agent_id = f"copilot-{id_suffix}"
    else:
        agent_id = f"copilot-{str(os.getppid())[-5:]}"

    agent_name = agent_id

    # Derive cwd label (used by server for working_directory display)
    cwd = copilot_data.get("cwd", "")

    # Translate event data
    data = translate_event(COPILOT_EVENT_TYPE, copilot_data)

    # Build HookEvent payload matching our server's expected format
    copilot_pid = get_copilot_pid()
    payload = {
        "eventType": mo_event_type,
        "agentId": agent_id,
        "agentName": agent_name,
        "timestamp": ms_to_iso(copilot_data.get("timestamp")),
        "pid": copilot_pid,
        "parentPid": None,
        "data": data,
    }

    send_to_minion_orchestra(payload)

    # Always pass through (don't block Copilot)
    json.dump({}, sys.stdout)


if __name__ == '__main__':
    main()
