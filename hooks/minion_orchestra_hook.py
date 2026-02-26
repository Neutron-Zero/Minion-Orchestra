#!/usr/bin/env python3
"""
Minion Orchestra Hook for Claude Code
Automatically sends events to Minion Orchestra server
"""

import json
import sys
import os
from urllib import request, error
from datetime import datetime

# Configuration
MINION_ORCHESTRA_URL = os.environ.get('MINION_ORCHESTRA_URL', 'http://localhost:3000')
HOOK_ENDPOINT = f"{MINION_ORCHESTRA_URL}/api/hook"

# Log directory: <script_dir>/../packages/server/logs/
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(SCRIPT_DIR, '..', 'packages', 'server', 'logs')
LOG_FILE = os.path.join(LOG_DIR, 'hook-client.log')


def log_message(message):
    """Append a timestamped log line to the hook client log file."""
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        with open(LOG_FILE, 'a') as f:
            f.write(f"[{timestamp}] {message}\n")
    except Exception:
        pass


def send_to_minion_orchestra(endpoint, data):
    """Send data to Minion Orchestra server."""
    try:
        headers = {'Content-Type': 'application/json'}
        req = request.Request(
            endpoint,
            data=json.dumps(data).encode('utf-8'),
            headers=headers,
            method='POST'
        )

        with request.urlopen(req, timeout=1) as response:
            if response.status == 200:
                log_message(f"Sent to {endpoint.replace(MINION_ORCHESTRA_URL, '')} - Status: {response.status}")
            return response.status == 200
    except Exception as e:
        log_message(f"Failed to send to {endpoint.replace(MINION_ORCHESTRA_URL, '')}: {e}")
        return False


def main():
    # Read the hook event from stdin
    try:
        event_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        log_message(f"Failed to parse event data: {e}")
        return

    # Extract event information
    event_type = event_data.get('hook_event_name', 'Unknown')

    # Use parent PID as stable agent identifier -- matches the scan-registered ID
    agent_id = f"claude-proc-{os.getppid()}"

    if 'cwd' in event_data:
        agent_name = os.path.basename(event_data['cwd']) or 'Claude Agent'
    else:
        agent_name = os.uname().nodename

    # Prepare the payload
    payload = {
        'eventType': event_type,
        'agentId': agent_id,
        'agentName': agent_name,
        'timestamp': datetime.now().isoformat(),
        'pid': os.getppid(),
        'data': event_data
    }

    # Send to hook endpoint
    send_to_minion_orchestra(HOOK_ENDPOINT, payload)

    # Always pass through
    json.dump({}, sys.stdout)


if __name__ == '__main__':
    main()
