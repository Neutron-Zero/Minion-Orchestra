from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from config import config
from models import HookEvent
from services import agent_manager, task_queue, log_hook_data, read_hook_logs, clear_hook_logs, scan_claude_processes
from websocket_handlers import broadcast_agent_update, broadcast_task_update

router = APIRouter()


# ---------------------------------------------------------------------------
# Health / Config / Reset
# ---------------------------------------------------------------------------

class ConfigUpdate(BaseModel):
    cleanupInterval: int | None = None


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "agents": agent_manager.get_agent_count(),
        "taskQueue": task_queue.get_queue(),
        "cleanupInterval": config.cleanup_interval_ms,
    }


@router.post("/scan")
async def scan_processes(request: Request):
    """Scan for running Claude Code processes and register them as agents."""
    sio = request.app.state.sio
    found = scan_claude_processes(agent_manager)
    if found > 0:
        await broadcast_agent_update(sio, agent_manager)
    return {"success": True, "found": found, "total": agent_manager.get_agent_count()}


@router.post("/config")
async def update_config(body: ConfigUpdate, request: Request):
    interval = body.cleanupInterval
    if interval and 1000 <= interval <= 300000:
        old_interval = config.cleanup_interval_ms
        cleanup_service = request.app.state.cleanup_service
        if cleanup_service and cleanup_service.restart(interval):
            if old_interval != interval:
                print(f"Cleanup interval changed from {old_interval}ms to {interval}ms")
            return {"success": True, "cleanupInterval": config.cleanup_interval_ms, "message": "Cleanup interval updated"}
        return {"success": False, "message": "Failed to update cleanup interval"}
    return {"success": False, "message": "cleanupInterval must be between 1000ms (1s) and 300000ms (5min)"}


@router.post("/reset")
async def reset_queue(request: Request):
    task_queue.reset()
    sio = request.app.state.sio
    await sio.emit("task_update", task_queue.get_queue())
    return {"status": "reset", "taskQueue": task_queue.get_queue()}


# ---------------------------------------------------------------------------
# Hook Event Handlers
# ---------------------------------------------------------------------------

def _ts(timestamp: str | None) -> str:
    return timestamp or datetime.now(timezone.utc).isoformat()


def _log(timestamp: str | None, level: str, message: str, agent_id: str) -> dict:
    return {"timestamp": _ts(timestamp), "level": level, "message": message, "agentId": agent_id}


async def _handle_session_start(agent, socket_id, event, sio):
    agent.status = "idle"
    if event.timestamp:
        agent.start_time = event.timestamp
    agent.session_data = event.data
    await sio.emit("log", _log(event.timestamp, "info", f"Session started - Agent ID: {event.agentId}", event.agentId))
    if event.response:
        log_hook_data(event.eventType, event.model_dump(), event.response)


async def _handle_user_prompt_submit(agent, socket_id, event, sio):
    prompt = (event.data or {}).get("prompt", "New task")
    truncated = prompt[:100] + ("..." if len(prompt) > 100 else "")
    agent.status = "working"
    agent.current_task = truncated
    task_queue.increment("inProgress")
    await sio.emit("log", _log(event.timestamp, "info", f"User: {truncated}", event.agentId))


async def _handle_pre_tool_use(agent, socket_id, event, sio):
    data = event.data or {}
    tool_name = data.get("tool_name", "Unknown")
    tool_input = data.get("tool_input", {})
    tool_description = tool_input.get("description") if isinstance(tool_input, dict) else None
    agent_manager.update_agent_tool(event.agentId, tool_name, tool_description)

    if tool_name == "TodoWrite" and isinstance(tool_input, dict):
        todos = tool_input.get("todos", [])
        in_progress = next((t for t in todos if isinstance(t, dict) and t.get("status") == "in_progress"), None)
        if in_progress:
            active_form = in_progress.get("activeForm") or in_progress.get("content")
            agent.current_task = active_form
            agent_manager.set_agent(socket_id, agent)
            await sio.emit("log", _log(event.timestamp, "info", active_form, event.agentId))

    # Build message with file path context when available
    msg = tool_description if tool_description else f"Using {tool_name}"
    if isinstance(tool_input, dict):
        file_path = tool_input.get("file_path") or tool_input.get("path") or tool_input.get("command")
        if file_path and not tool_description:
            # Shorten to just the filename for readability
            short = file_path.split("/")[-1] if "/" in str(file_path) else str(file_path)
            msg = f"{tool_name}: {short}"
    await sio.emit("log", _log(event.timestamp, "info", msg, event.agentId))


async def _handle_post_tool_use(agent, socket_id, event, sio):
    agent_manager.clear_agent_tool(event.agentId)
    data = event.data or {}
    tool = data.get("tool_name", "Unknown")
    tool_input = data.get("tool_input", {})
    success = not data.get("error")
    level = "info" if success else "error"

    suffix = ""
    if isinstance(tool_input, dict):
        file_path = tool_input.get("file_path") or tool_input.get("path")
        if file_path:
            suffix = f": {file_path.split('/')[-1]}" if "/" in str(file_path) else f": {file_path}"

    msg = f"Completed {tool}{suffix}" if success else f"Failed {tool}{suffix}: {data.get('error')}"
    await sio.emit("log", _log(event.timestamp, level, msg, event.agentId))


async def _handle_subagent_start(agent, socket_id, event, sio):
    data = event.data or {}
    description = data.get("description", "Subagent Task")
    subagent_id = f"{event.agentId}-sub-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
    subagent = agent_manager.create_agent(
        id=subagent_id, socket_id=f"hook-{subagent_id}", name=f"Subagent: {description}",
        type="subagent", status="working", current_task=description,
    )
    agent_manager.set_agent(f"hook-{subagent_id}", subagent)
    await sio.emit("log", _log(event.timestamp, "info", f"Subagent started: {description}", event.agentId))
    await broadcast_agent_update(sio, agent_manager)


async def _handle_subagent_stop(agent, socket_id, event, sio):
    prefix = f"{event.agentId}-sub-"
    subagents = [a for a in agent_manager.get_all_agents() if a.type == "subagent" and a.id.startswith(prefix)]
    for sub in subagents:
        sub.status = "completed"
        sub.current_task = None
        sub.last_activity = datetime.now(timezone.utc)

        async def _remove(sid=sub.id):
            await asyncio.sleep(5)
            agent_manager.remove_agent_by_id(sid)
            await broadcast_agent_update(sio, agent_manager)
        asyncio.create_task(_remove())

    await sio.emit("log", _log(event.timestamp, "info", "Subagent completed", event.agentId))
    await broadcast_agent_update(sio, agent_manager)


async def _handle_stop(agent, socket_id, event, sio):
    agent.status = "idle"
    agent.current_task = None
    agent.current_tool = None
    if task_queue.get_queue()["inProgress"] > 0:
        task_queue.decrement("inProgress")
    task_queue.increment("completed")
    await sio.emit("log", _log(event.timestamp, "info", "Session completed", event.agentId))


async def _handle_permission_request(agent, socket_id, event, sio):
    tool_name = (event.data or {}).get("tool_name", "Unknown")
    agent.status = "waiting"
    await sio.emit("log", _log(event.timestamp, "warning", f"Permission requested for {tool_name}", event.agentId))


async def _handle_post_tool_use_failure(agent, socket_id, event, sio):
    data = event.data or {}
    failed_tool = data.get("tool_name", "Unknown")
    fail_error = data.get("error", "Unknown error")
    is_interrupt = data.get("is_interrupt", False)
    agent_manager.clear_agent_tool(event.agentId)
    if task_queue.get_queue()["inProgress"] > 0 and is_interrupt:
        task_queue.decrement("inProgress")
        task_queue.increment("failed")
    suffix = " (interrupted)" if is_interrupt else ""
    await sio.emit("log", _log(event.timestamp, "error", f"{failed_tool} failed: {fail_error}{suffix}", event.agentId))


async def _handle_session_end(agent, socket_id, event, sio):
    reason = (event.data or {}).get("reason", "unknown")
    agent.status = "offline"
    agent.current_task = None
    agent.current_tool = None
    if task_queue.get_queue()["inProgress"] > 0:
        task_queue.decrement("inProgress")
    await sio.emit("log", _log(event.timestamp, "info", f"Session ended ({reason})", event.agentId))

    async def _remove():
        await asyncio.sleep(10)
        agent_manager.remove_agent_by_id(event.agentId)
        await broadcast_agent_update(sio, agent_manager)
    asyncio.create_task(_remove())


async def _handle_pre_compact(agent, socket_id, event, sio):
    await sio.emit("log", _log(event.timestamp, "debug", "Compacting context...", event.agentId))


async def _handle_notification(agent, socket_id, event, sio):
    data = event.data or {}
    await sio.emit("log", _log(event.timestamp, data.get("level", "info"), data.get("message", "Notification"), event.agentId))


async def _handle_teammate_idle(agent, socket_id, event, sio):
    data = event.data or {}
    teammate = data.get("teammate_name", "Unknown")
    team = data.get("team_name", "")
    await sio.emit("log", _log(event.timestamp, "info", f"Teammate idle: {teammate}{f' ({team})' if team else ''}", event.agentId))


async def _handle_task_completed(agent, socket_id, event, sio):
    subject = (event.data or {}).get("task_subject", "Unknown task")
    task_queue.increment("completed")
    if task_queue.get_queue()["inProgress"] > 0:
        task_queue.decrement("inProgress")
    await sio.emit("log", _log(event.timestamp, "info", f"Task completed: {subject}", event.agentId))


async def _handle_config_change(agent, socket_id, event, sio):
    data = event.data or {}
    source = data.get("source", "unknown")
    fp = data.get("file_path", "")
    await sio.emit("log", _log(event.timestamp, "debug", f"Config changed: {source}{f' ({fp})' if fp else ''}", event.agentId))


async def _handle_worktree_create(agent, socket_id, event, sio):
    name = (event.data or {}).get("name", "unnamed")
    await sio.emit("log", _log(event.timestamp, "info", f"Worktree created: {name}", event.agentId))


async def _handle_worktree_remove(agent, socket_id, event, sio):
    wt_path = (event.data or {}).get("worktree_path", "unknown")
    await sio.emit("log", _log(event.timestamp, "info", f"Worktree removed: {wt_path}", event.agentId))


async def _handle_default(agent, socket_id, event, sio):
    data_str = json.dumps(event.data or {}, default=str)[:100]
    await sio.emit("log", _log(event.timestamp, "debug", f"{event.eventType}: {data_str}", event.agentId))


EVENT_HANDLERS = {
    "SessionStart": _handle_session_start, "UserPromptSubmit": _handle_user_prompt_submit,
    "PreToolUse": _handle_pre_tool_use, "PostToolUse": _handle_post_tool_use,
    "SubagentStart": _handle_subagent_start, "SubagentStop": _handle_subagent_stop,
    "Stop": _handle_stop, "PermissionRequest": _handle_permission_request,
    "PostToolUseFailure": _handle_post_tool_use_failure, "SessionEnd": _handle_session_end,
    "PreCompact": _handle_pre_compact, "Notification": _handle_notification,
    "TeammateIdle": _handle_teammate_idle, "TaskCompleted": _handle_task_completed,
    "ConfigChange": _handle_config_change, "WorktreeCreate": _handle_worktree_create,
    "WorktreeRemove": _handle_worktree_remove,
}


# ---------------------------------------------------------------------------
# Hook Endpoint
# ---------------------------------------------------------------------------

@router.post("/api/hook")
async def hook_endpoint(event: HookEvent, request: Request):
    try:
        sio = request.app.state.sio
        log_hook_data(event.eventType, event.model_dump())

        agent, socket_id = agent_manager.find_agent_by_id(event.agentId)
        cwd = (event.data or {}).get("cwd", "")

        if not agent:
            agent = agent_manager.create_agent(
                id=event.agentId, socket_id=f"hook-{event.agentId}",
                name=event.agentName or "Claude Agent", type="claude-code", status="idle",
                working_directory=cwd, pid=event.pid,
            )
            agent_manager.set_agent(f"hook-{event.agentId}", agent)
            socket_id = f"hook-{event.agentId}"
        else:
            if cwd and not agent.working_directory:
                agent.working_directory = cwd
            if event.pid and not agent.pid:
                agent.pid = event.pid
            if event.agentName and agent.name != event.agentName:
                agent.name = event.agentName

        handler = EVENT_HANDLERS.get(event.eventType, _handle_default)
        await handler(agent, socket_id, event, sio)

        agent.last_activity = datetime.now(timezone.utc)
        agent_manager.set_agent(socket_id, agent)
        await broadcast_agent_update(sio, agent_manager)
        await broadcast_task_update(sio, task_queue)

        return {"success": True, "eventType": event.eventType, "agentId": event.agentId}
    except Exception as e:
        print(f"Error in /api/hook: {e}")
        return {"success": False, "error": str(e)}


@router.get("/api/hooks/logs")
async def get_hook_logs(limit: int = 100):
    return {"logs": read_hook_logs(limit)}


@router.delete("/api/hooks/logs")
async def delete_hook_logs():
    clear_hook_logs()
    return {"success": True, "message": "Hook logs cleared"}


# ---------------------------------------------------------------------------
# Agent Endpoint
# ---------------------------------------------------------------------------

@router.post("/api/agent")
async def agent_endpoint(request: Request):
    try:
        sio = request.app.state.sio
        body: dict[str, Any] = await request.json()

        if body.get("type") == "disconnect":
            target_id = body.get("agentId")
            agent, _ = agent_manager.find_agent_by_id(target_id)
            if agent:
                task_queue.decrement(agent.status)
            agent_manager.remove_agent_by_id(target_id)
            await broadcast_agent_update(sio, agent_manager)
            await broadcast_task_update(sio, task_queue)
            return {"success": True}

        if body.get("type") == "clear-all":
            agent_manager.clear_all_agents()
            task_queue.reset()
            await broadcast_agent_update(sio, agent_manager)
            await broadcast_task_update(sio, task_queue)
            return {"success": True}

        # Try hook event
        hook_event_name = None
        if isinstance(body.get("data"), dict):
            hook_event_name = body["data"].get("hook_event_name")
        if not hook_event_name:
            hook_event_name = body.get("type")

        agent_id = body.get("agentId") or body.get("id")

        if hook_event_name and agent_id:
            agent, sid = agent_manager.find_agent_by_id(agent_id)
            if agent:
                data = body.get("data", {})
                if hook_event_name == "PreToolUse":
                    tool_input = data.get("tool_input", {})
                    tool_desc = tool_input.get("description") if isinstance(tool_input, dict) else None
                    tool_name = data.get("tool_name")
                    if tool_name:
                        agent_manager.update_agent_tool(agent.id, tool_name, tool_desc)
                        await sio.emit("log", _log(None, "info", tool_desc or f"Using {tool_name}", agent.id))
                    await broadcast_agent_update(sio, agent_manager)
                elif hook_event_name == "PostToolUse":
                    agent_manager.clear_agent_tool(agent.id)
                    await broadcast_agent_update(sio, agent_manager)
                elif hook_event_name == "UserPromptSubmit":
                    prompt = data.get("prompt", "New prompt received")
                    truncated = prompt[:100] + ("..." if len(prompt) > 100 else "")
                    agent_manager.update_agent_task(agent.id, truncated)
                    await sio.emit("log", _log(None, "info", f"User prompt: {prompt[:50]}{'...' if len(prompt) > 50 else ''}", agent.id))
                    await broadcast_agent_update(sio, agent_manager)
                elif hook_event_name in ("Stop", "SubagentStop"):
                    agent_manager.update_agent_status(agent.id, "completed")
                    agent_manager.clear_agent_tool(agent.id)
                    msg = "Subagent completed task" if hook_event_name == "SubagentStop" else "Task completed"
                    await sio.emit("log", _log(None, "info", msg, agent.id))
                    await broadcast_agent_update(sio, agent_manager)
                return {"success": True}

        # Regular agent update
        agent_id = body.get("id")
        if not agent_id:
            return {"success": False, "error": "Missing agent id"}

        agent, socket_id = agent_manager.find_agent_by_id(agent_id)
        if not agent:
            agent = agent_manager.create_agent(
                id=agent_id, socket_id=f"rest-{agent_id}",
                name=body.get("name", "Claude Agent"), type=body.get("type", "claude-code"),
                status=body.get("status", "idle"), current_tool=body.get("currentTool"),
            )
            agent_manager.set_agent(f"rest-{agent_id}", agent)
        else:
            if body.get("name"):
                agent.name = body["name"]
            if body.get("status"):
                agent.status = body["status"]
            agent.last_activity = datetime.now(timezone.utc)
            if body.get("currentTool") is not None:
                agent.current_tool = body["currentTool"]
            if agent.status == "idle":
                agent.current_task = None
                agent.current_tool = None
            agent_manager.set_agent(socket_id, agent)

        await broadcast_agent_update(sio, agent_manager)
        return {"success": True}
    except Exception as e:
        print(f"Error in /api/agent: {e}")
        return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Task Endpoint
# ---------------------------------------------------------------------------

@router.post("/api/task")
async def task_endpoint(request: Request):
    try:
        sio = request.app.state.sio
        body: dict[str, Any] = await request.json()

        agent_id = body.get("agentId")
        task = body.get("task")
        status = body.get("status")

        if not agent_id:
            print(f"POST /api/task missing agentId. Body: {body}")
            return {"success": False, "error": "Missing agentId"}

        agent, socket_id = agent_manager.find_agent_by_id(agent_id)
        if not agent:
            agent_name = "Claude Agent"
            if task:
                agent_name = f"Claude: {task[:50]}{'...' if len(task) > 50 else ''}"
            agent = agent_manager.create_agent(
                id=agent_id, socket_id=f"rest-{agent_id}", name=agent_name,
                type="claude-code", status=status or "working", current_task=task,
            )
            agent_manager.set_agent(f"rest-{agent_id}", agent)
        else:
            agent.current_task = task
            agent.status = status or "working"
            agent.last_activity = datetime.now(timezone.utc)
            agent_manager.set_agent(socket_id, agent)

        if status == "working":
            task_queue.increment("inProgress")
        elif status == "completed":
            task_queue.increment("completed")
            task_queue.decrement("inProgress")
        elif status == "failed":
            task_queue.increment("failed")
            task_queue.decrement("inProgress")

        await broadcast_agent_update(sio, agent_manager)
        await broadcast_task_update(sio, task_queue)
        return {"success": True}
    except Exception as e:
        print(f"Error in /api/task: {e}")
        return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Log Endpoint
# ---------------------------------------------------------------------------

@router.post("/api/log")
async def log_endpoint(request: Request):
    try:
        sio = request.app.state.sio
        body: dict[str, Any] = await request.json()

        agent_id = body.get("agentId")
        level = body.get("level", "info")
        message = body.get("message", "")
        timestamp = body.get("timestamp")

        agent, socket_id = agent_manager.find_agent_by_id(agent_id)
        if not agent:
            agent = agent_manager.create_agent(
                id=agent_id, socket_id=f"rest-{agent_id}",
                name="Claude Agent", type="claude-code", status="working",
            )
            agent_manager.set_agent(f"rest-{agent_id}", agent)
            socket_id = f"rest-{agent_id}"

        if message:
            if "Using tool:" in message:
                agent.tool_calls += 1
                agent.status = "working"
            elif "completed" in message:
                agent.status = "completed"
            elif "error" in message:
                agent.status = "failed"
            elif "prompt" in message:
                agent.status = "working"
            elif "Claude is wa" in message:
                agent.status = "idle"
                agent.current_task = "Waiting for input"

        log_entry = {
            "timestamp": timestamp or datetime.now(timezone.utc).isoformat(),
            "level": level,
            "message": message,
            "agentId": agent.id,
        }
        agent_manager.add_agent_log(agent.id, log_entry)
        await sio.emit("log", log_entry)
        return {"success": True}
    except Exception as e:
        print(f"Error in /api/log: {e}")
        return {"success": False, "error": str(e)}
