from __future__ import annotations

import asyncio
import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any

import psutil
import socketio

from config import config
from models import Agent


# ---------------------------------------------------------------------------
# Hook Logger
# ---------------------------------------------------------------------------

LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
HOOK_LOG_FILE = os.path.join(LOG_DIR, "hooks.log")
os.makedirs(LOG_DIR, exist_ok=True)


def log_hook_data(event_type: str, payload: dict, response: Any = None):
    try:
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "eventType": event_type,
            "payload": payload,
            "response": response,
        }
        with open(HOOK_LOG_FILE, "a") as f:
            f.write(json.dumps(entry, default=str) + "\n")
        if config.debug:
            print(f"\nHOOK: {event_type} at {entry['timestamp']}")
    except Exception as e:
        print(f"Failed to log hook data: {e}")


def read_hook_logs(limit: int = 100) -> list[dict]:
    if not os.path.exists(HOOK_LOG_FILE):
        return []
    logs = []
    with open(HOOK_LOG_FILE, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                logs.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return logs[-limit:]


def clear_hook_logs():
    if os.path.exists(HOOK_LOG_FILE):
        with open(HOOK_LOG_FILE, "w") as f:
            f.write("")


# ---------------------------------------------------------------------------
# Process Utils
# ---------------------------------------------------------------------------

def scan_claude_processes(am: AgentManager) -> int:
    """Scan for running Claude Code processes and register them as agents."""
    # Collect PIDs already known from hook-registered agents
    known_pids = {agent.pid for agent in am.get_all_agents() if agent.pid}

    found = 0
    for proc in psutil.process_iter(["pid", "cmdline", "cwd"]):
        try:
            cmdline = proc.info.get("cmdline") or []
            cmd = " ".join(cmdline)
            if "claude" not in cmd.lower() or "hook" in cmd.lower():
                continue

            pid = proc.info["pid"]

            # Skip if a hook-registered agent already tracks this PID
            if pid in known_pids:
                continue

            agent_id = f"claude-proc-{pid}"
            existing, _ = am.find_agent_by_id(agent_id)
            if existing:
                continue

            cwd = proc.info.get("cwd") or ""
            name = os.path.basename(cwd) if cwd else f"Claude ({pid})"

            agent = am.create_agent(
                id=agent_id, socket_id=f"scan-{agent_id}",
                name=name, type="claude-code", status="idle",
                working_directory=cwd, pid=pid,
            )
            am.set_agent(f"scan-{agent_id}", agent)
            found += 1
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return found


def cleanup_dead_agents(am: AgentManager, tq: TaskQueue) -> int:
    """Remove agents whose process is no longer running."""
    removed_count = 0
    to_remove: list[str] = []

    for socket_id, agent in list(am.agents.items()):
        if not agent or not agent.id:
            to_remove.append(socket_id)
            continue

        # If agent has a PID, check if the process is still alive
        if agent.pid and not psutil.pid_exists(agent.pid):
            to_remove.append(socket_id)
            tq.decrement(agent.status)
            removed_count += 1

    for socket_id in to_remove:
        am.remove_agent(socket_id)
    return removed_count


# ---------------------------------------------------------------------------
# Agent Manager
# ---------------------------------------------------------------------------

class AgentManager:
    def __init__(self):
        self.agents: dict[str, Agent] = {}
        self.recent_logs: dict[str, dict[str, float]] = {}

    def get_all_agents(self) -> list[Agent]:
        return list(self.agents.values())

    def get_all_agents_serialized(self) -> list[dict]:
        return [a.model_dump(by_alias=True, mode="json") for a in self.agents.values()]

    def get_agent_by_socket_id(self, socket_id: str) -> Agent | None:
        return self.agents.get(socket_id)

    def find_agent_by_id(self, agent_id: str) -> tuple[Agent | None, str | None]:
        for sid, agent in self.agents.items():
            if agent.id == agent_id:
                return agent, sid
        return None, None

    def set_agent(self, socket_id: str, agent: Agent):
        self.agents[socket_id] = agent

    def remove_agent(self, socket_id: str) -> bool:
        return self.agents.pop(socket_id, None) is not None

    def remove_agent_by_id(self, agent_id: str) -> bool:
        _, socket_id = self.find_agent_by_id(agent_id)
        if socket_id:
            return self.remove_agent(socket_id)
        return False

    def clear_all_agents(self):
        self.agents.clear()

    def get_agent_count(self) -> int:
        return len(self.agents)

    def create_agent(self, **kwargs) -> Agent:
        now = datetime.now(timezone.utc)
        defaults = {
            "id": f"agent-{int(time.time() * 1000)}",
            "socket_id": f"rest-{kwargs.get('id', '')}",
            "name": "Claude Agent",
            "type": "claude-code",
            "status": "idle",
            "start_time": now,
            "last_activity": now,
        }
        defaults.update(kwargs)
        return Agent(**defaults)

    def update_agent_tool(self, agent_id: str, tool_name: str, tool_description: str | None = None) -> bool:
        agent, socket_id = self.find_agent_by_id(agent_id)
        if not agent:
            return False
        now = datetime.now(timezone.utc)
        agent.tool_calls += 1
        agent.current_tool = tool_name
        agent.current_tool_description = tool_description
        agent.last_tool_used = tool_name
        agent.last_tool_time = now
        agent.last_activity = now
        if not agent.recent_tools or agent.recent_tools[-1] != tool_name:
            agent.recent_tools.append(tool_name)
            if len(agent.recent_tools) > 5:
                agent.recent_tools.pop(0)
        self.set_agent(socket_id, agent)
        return True

    def clear_agent_tool(self, agent_id: str) -> bool:
        agent, socket_id = self.find_agent_by_id(agent_id)
        if not agent:
            return False
        agent.current_tool = None
        agent.current_tool_description = None
        agent.last_activity = datetime.now(timezone.utc)
        self.set_agent(socket_id, agent)
        return True

    def update_agent_status(self, agent_id: str, status: str) -> bool:
        agent, socket_id = self.find_agent_by_id(agent_id)
        if not agent:
            return False
        agent.status = status
        agent.last_activity = datetime.now(timezone.utc)
        if status in ("idle", "offline"):
            agent.current_task = None
            agent.current_tool = None
        self.set_agent(socket_id, agent)
        return True

    def update_agent_task(self, agent_id: str, task: str) -> bool:
        agent, socket_id = self.find_agent_by_id(agent_id)
        if not agent:
            return False
        agent.current_task = task
        agent.status = "working"
        agent.last_activity = datetime.now(timezone.utc)
        self.set_agent(socket_id, agent)
        return True

    def add_agent_log(self, agent_id: str, log_entry: dict) -> bool:
        agent, socket_id = self.find_agent_by_id(agent_id)
        if not agent:
            return False
        agent.logs.append(log_entry)
        if len(agent.logs) > 100:
            agent.logs.pop(0)
        self.set_agent(socket_id, agent)
        return True

    def is_duplicate_log(self, agent_id: str, message: str, level: str) -> bool:
        message_hash = f"{agent_id}-{message}-{level}"
        now = time.time()
        if agent_id not in self.recent_logs:
            self.recent_logs[agent_id] = {}
        agent_recent = self.recent_logs[agent_id]
        if message_hash in agent_recent and now - agent_recent[message_hash] < 5:
            return True
        agent_recent[message_hash] = now
        to_remove = [h for h, ts in agent_recent.items() if now - ts > 30]
        for h in to_remove:
            del agent_recent[h]
        return False


# ---------------------------------------------------------------------------
# Task Queue
# ---------------------------------------------------------------------------

class TaskQueue:
    def __init__(self):
        self.queue = {"pending": 0, "inProgress": 0, "completed": 0, "failed": 0}

    def get_queue(self) -> dict:
        return self.queue

    def reset(self):
        for k in self.queue:
            self.queue[k] = 0

    def update_task_status(self, old_status: str | None, new_status: str | None):
        if old_status:
            self._decrement(old_status)
        if new_status:
            self._increment(new_status)

    def increment(self, status: str):
        self._increment(status)

    def decrement(self, status: str):
        self._decrement(status)

    def _increment(self, status: str):
        key = self._normalize(status)
        if key and key in self.queue:
            self.queue[key] += 1

    def _decrement(self, status: str):
        key = self._normalize(status)
        if key and key in self.queue and self.queue[key] > 0:
            self.queue[key] -= 1

    @staticmethod
    def _normalize(status: str) -> str | None:
        return {"pending": "pending", "working": "inProgress", "in_progress": "inProgress",
                "inProgress": "inProgress", "completed": "completed", "failed": "failed"}.get(status)


# ---------------------------------------------------------------------------
# Cleanup Service
# ---------------------------------------------------------------------------

class CleanupService:
    def __init__(self, agent_manager: AgentManager, task_queue: TaskQueue, sio: socketio.AsyncServer):
        self.agent_manager = agent_manager
        self.task_queue = task_queue
        self.sio = sio
        self._task: asyncio.Task | None = None

    async def _cleanup_loop(self):
        while True:
            await asyncio.sleep(config.cleanup_interval_ms / 1000)
            removed = cleanup_dead_agents(self.agent_manager, self.task_queue)
            if removed > 0:
                await self.sio.emit("agent_update", self.agent_manager.get_all_agents_serialized())
                await self.sio.emit("task_update", self.task_queue.get_queue())

    def start(self):
        if self._task:
            self._task.cancel()
        self._task = asyncio.create_task(self._cleanup_loop())

    def stop(self):
        if self._task:
            self._task.cancel()
            self._task = None

    def restart(self, new_interval_ms: int) -> bool:
        if config.set_cleanup_interval(new_interval_ms):
            self.start()
            return True
        return False


# ---------------------------------------------------------------------------
# Singletons
# ---------------------------------------------------------------------------

agent_manager = AgentManager()
task_queue = TaskQueue()
