from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from config import config
from models import HookEvent
from services import agent_manager, task_queue, log_hook_data, read_hook_logs, clear_hook_logs, scan_claude_processes
from websocket_handlers import broadcast_agent_update, broadcast_task_update
from terminal_actions import focus_session, send_input
from notifications import notify
import database as db

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


async def _emit_and_store_log(sio, timestamp, level, message, agent_id, tool_name=None):
    """Emit log via Socket.IO and persist to SQLite."""
    log_entry = _log(timestamp, level, message, agent_id)
    await sio.emit("log", log_entry)
    await db.store_log(agent_id, level, message, tool_name, log_entry["timestamp"])


async def _handle_session_start(agent, socket_id, event, sio):
    agent.status = "idle"
    if event.timestamp:
        agent.start_time = event.timestamp
    agent.session_data = event.data
    await _emit_and_store_log(sio, event.timestamp, "info", f"Session started - Agent ID: {event.agentId}", event.agentId)
    if event.response:
        log_hook_data(event.eventType, event.model_dump(), event.response)


async def _handle_user_prompt_submit(agent, socket_id, event, sio):
    prompt = (event.data or {}).get("prompt", "New task")
    truncated = prompt[:100] + ("..." if len(prompt) > 100 else "")
    agent.status = "working"
    agent.current_task = truncated
    task_queue.increment("inProgress")
    await _emit_and_store_log(sio,event.timestamp, "info", f"User: {truncated}", event.agentId)


async def _handle_pre_tool_use(agent, socket_id, event, sio):
    data = event.data or {}
    tool_name = data.get("tool_name", "Unknown")
    tool_input = data.get("tool_input", {})
    tool_description = tool_input.get("description") if isinstance(tool_input, dict) else None
    agent.status = "working"
    agent_manager.update_agent_tool(event.agentId, tool_name, tool_description)

    if tool_name == "TodoWrite" and isinstance(tool_input, dict):
        todos = tool_input.get("todos", [])
        in_progress = next((t for t in todos if isinstance(t, dict) and t.get("status") == "in_progress"), None)
        if in_progress:
            active_form = in_progress.get("activeForm") or in_progress.get("content")
            agent.current_task = active_form
            agent_manager.set_agent(socket_id, agent)
            await _emit_and_store_log(sio,event.timestamp, "info", active_form, event.agentId)

    # Build message: always start with tool name
    if tool_description:
        msg = f"{tool_name}: {tool_description}"
    elif isinstance(tool_input, dict):
        file_path = tool_input.get("file_path") or tool_input.get("path") or tool_input.get("command")
        if file_path:
            short = file_path.split("/")[-1] if "/" in str(file_path) else str(file_path)
            msg = f"{tool_name}: {short}"
        else:
            msg = f"Using {tool_name}"
    else:
        msg = f"Using {tool_name}"
    await _emit_and_store_log(sio,event.timestamp, "info", msg, event.agentId)


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
    await _emit_and_store_log(sio,event.timestamp, level, msg, event.agentId)


async def _handle_subagent_start(agent, socket_id, event, sio):
    data = event.data or {}
    description = data.get("description", "Subagent Task")
    # The subagent process will self-register via its own hook events with parentPid set
    await _emit_and_store_log(sio,event.timestamp, "info", f"Subagent started: {description}", event.agentId)


async def _handle_subagent_stop(agent, socket_id, event, sio):
    # Find subagents whose parent_pid matches this agent's pid
    subagents = [a for a in agent_manager.get_all_agents()
                 if a.type == "subagent" and a.parent_pid and a.parent_pid == agent.pid]
    for sub in subagents:
        sub.status = "completed"
        sub.current_task = None
        sub.last_activity = datetime.now(timezone.utc)

        async def _remove(sid=sub.id):
            await asyncio.sleep(60)
            agent_manager.remove_agent_by_id(sid)
            await broadcast_agent_update(sio, agent_manager)
        asyncio.create_task(_remove())

    await _emit_and_store_log(sio,event.timestamp, "info", "Subagent completed", event.agentId)
    await broadcast_agent_update(sio, agent_manager)


async def _handle_stop(agent, socket_id, event, sio):
    # Subagents complete; parent agents cycle back to idle
    agent.status = "completed" if agent.type == "subagent" else "idle"
    agent.current_task = None
    agent.current_tool = None
    if task_queue.get_queue()["inProgress"] > 0:
        task_queue.decrement("inProgress")
    task_queue.increment("completed")
    await _emit_and_store_log(sio,event.timestamp, "info", "Session completed", event.agentId)


async def _handle_permission_request(agent, socket_id, event, sio):
    tool_name = (event.data or {}).get("tool_name", "Unknown")
    agent.status = "waiting"
    await _emit_and_store_log(sio,event.timestamp, "warning", f"Permission requested for {tool_name}", event.agentId)


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
    await _emit_and_store_log(sio,event.timestamp, "error", f"{failed_tool} failed: {fail_error}{suffix}", event.agentId)


async def _handle_session_end(agent, socket_id, event, sio):
    reason = (event.data or {}).get("reason", "unknown")
    agent.status = "offline"
    agent.current_task = None
    agent.current_tool = None
    if task_queue.get_queue()["inProgress"] > 0:
        task_queue.decrement("inProgress")
    await _emit_and_store_log(sio, event.timestamp, "info", f"Session ended ({reason})", event.agentId)
    await db.update_session_status(event.agentId, "offline", end_time=_ts(event.timestamp))

    async def _remove():
        await asyncio.sleep(60)
        agent_manager.remove_agent_by_id(event.agentId)
        await broadcast_agent_update(sio, agent_manager)
    asyncio.create_task(_remove())


async def _handle_pre_compact(agent, socket_id, event, sio):
    await _emit_and_store_log(sio,event.timestamp, "debug", "Compacting context...", event.agentId)


async def _handle_notification(agent, socket_id, event, sio):
    data = event.data or {}
    await _emit_and_store_log(sio,event.timestamp, data.get("level", "info"), data.get("message", "Notification"), event.agentId)


async def _handle_teammate_idle(agent, socket_id, event, sio):
    data = event.data or {}
    teammate = data.get("teammate_name", "Unknown")
    team = data.get("team_name", "")
    await _emit_and_store_log(sio,event.timestamp, "info", f"Teammate idle: {teammate}{f' ({team})' if team else ''}", event.agentId)


async def _handle_task_completed(agent, socket_id, event, sio):
    subject = (event.data or {}).get("task_subject", "Unknown task")
    task_queue.increment("completed")
    if task_queue.get_queue()["inProgress"] > 0:
        task_queue.decrement("inProgress")
    await _emit_and_store_log(sio,event.timestamp, "info", f"Task completed: {subject}", event.agentId)


async def _handle_config_change(agent, socket_id, event, sio):
    data = event.data or {}
    source = data.get("source", "unknown")
    fp = data.get("file_path", "")
    await _emit_and_store_log(sio,event.timestamp, "debug", f"Config changed: {source}{f' ({fp})' if fp else ''}", event.agentId)


async def _handle_worktree_create(agent, socket_id, event, sio):
    name = (event.data or {}).get("name", "unnamed")
    await _emit_and_store_log(sio,event.timestamp, "info", f"Worktree created: {name}", event.agentId)


async def _handle_worktree_remove(agent, socket_id, event, sio):
    wt_path = (event.data or {}).get("worktree_path", "unknown")
    await _emit_and_store_log(sio,event.timestamp, "info", f"Worktree removed: {wt_path}", event.agentId)


async def _handle_default(agent, socket_id, event, sio):
    data_str = json.dumps(event.data or {}, default=str)[:100]
    await _emit_and_store_log(sio,event.timestamp, "debug", f"{event.eventType}: {data_str}", event.agentId)


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

        # Ignore hooks from the Claude session that launched this server
        own_pid = getattr(request.app.state, "own_claude_pid", None)
        if own_pid and event.pid == own_pid:
            return {"success": True, "skipped": True, "reason": "own session"}

        log_hook_data(event.eventType, event.model_dump())

        agent, socket_id = agent_manager.find_agent_by_id(event.agentId)
        cwd = (event.data or {}).get("cwd", "")

        if not agent:
            # Determine if this is a subagent by checking if parentPid matches a known agent
            agent_type = "claude-code"
            if event.parentPid:
                parent_agent, _ = agent_manager.find_agent_by_pid(event.parentPid)
                if parent_agent:
                    agent_type = "subagent"

            agent = agent_manager.create_agent(
                id=event.agentId, socket_id=f"hook-{event.agentId}",
                name=event.agentName or "Claude Agent", type=agent_type, status="idle",
                working_directory=cwd, pid=event.pid, parent_pid=event.parentPid,
            )
            agent_manager.set_agent(f"hook-{event.agentId}", agent)
            socket_id = f"hook-{event.agentId}"
        else:
            if cwd and not agent.working_directory:
                agent.working_directory = cwd
            if event.pid and not agent.pid:
                agent.pid = event.pid
            if event.parentPid and not agent.parent_pid:
                agent.parent_pid = event.parentPid
            if event.agentName and agent.name != event.agentName:
                agent.name = event.agentName

        handler = EVENT_HANDLERS.get(event.eventType, _handle_default)
        await handler(agent, socket_id, event, sio)

        agent.last_activity = datetime.now(timezone.utc)
        agent_manager.set_agent(socket_id, agent)
        await broadcast_agent_update(sio, agent_manager)
        await broadcast_task_update(sio, task_queue)

        # Store event in database
        prompt_msg = None
        if event.eventType == "UserPromptSubmit":
            prompt_msg = (event.data or {}).get("prompt", "")
        await db.store_event(
            event_type=event.eventType, agent_id=event.agentId,
            session_id=event.agentId, timestamp=_ts(event.timestamp),
            message=prompt_msg, metadata=event.data,
        )

        # Upsert session in database (every hook event keeps session record current)
        await db.store_session(
            id=event.agentId, agent_name=agent.name, status=agent.status,
            working_directory=agent.working_directory,
            start_time=agent.start_time.isoformat() if agent.start_time else _ts(event.timestamp),
            pid=agent.pid, metadata=agent.session_data,
        )

        # Fire native notifications for key events
        _folder = os.path.basename(agent.working_directory) if agent.working_directory else ""
        _task = agent.current_task or ""
        if event.eventType == "PermissionRequest":
            tool = (event.data or {}).get("tool_name", "tool")
            await notify("permission_request", event.agentId, agent.name,
                         f"Permission requested for {tool}", folder=_folder, task=_task)
        elif agent.status in ("waiting", "awaiting-permission"):
            await notify("waiting", event.agentId, agent.name,
                         "Waiting for input", folder=_folder, task=_task)
        elif event.eventType == "Stop":
            await notify("completed", event.agentId, agent.name,
                         "Task completed", folder=_folder, task=_task)
        elif event.eventType == "PostToolUseFailure":
            tool = (event.data or {}).get("tool_name", "unknown")
            await notify("failed", event.agentId, agent.name,
                         f"Tool failed: {tool}", folder=_folder, task=_task)

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
                        await _emit_and_store_log(sio,None, "info", tool_desc or f"Using {tool_name}", agent.id)
                    await broadcast_agent_update(sio, agent_manager)
                elif hook_event_name == "PostToolUse":
                    agent_manager.clear_agent_tool(agent.id)
                    await broadcast_agent_update(sio, agent_manager)
                elif hook_event_name == "UserPromptSubmit":
                    prompt = data.get("prompt", "New prompt received")
                    truncated = prompt[:100] + ("..." if len(prompt) > 100 else "")
                    agent_manager.update_agent_task(agent.id, truncated)
                    await _emit_and_store_log(sio,None, "info", f"User prompt: {prompt[:50]}{'...' if len(prompt) > 50 else ''}", agent.id)
                    await broadcast_agent_update(sio, agent_manager)
                elif hook_event_name in ("Stop", "SubagentStop"):
                    agent_manager.update_agent_status(agent.id, "completed")
                    agent_manager.clear_agent_tool(agent.id)
                    msg = "Subagent completed task" if hook_event_name == "SubagentStop" else "Task completed"
                    await _emit_and_store_log(sio,None, "info", msg, agent.id)
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
        await db.store_log(agent.id, level, message, None, log_entry["timestamp"])
        return {"success": True}
    except Exception as e:
        print(f"Error in /api/log: {e}")
        return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Terminal Action Endpoints
# ---------------------------------------------------------------------------

@router.post("/api/actions/focus")
async def action_focus(request: Request):
    try:
        body: dict[str, Any] = await request.json()
        agent_id = body.get("agentId")
        agent, _ = agent_manager.find_agent_by_id(agent_id)
        if not agent or not agent.pid:
            return {"success": False, "error": "Agent not found or no PID"}
        result = await focus_session(agent.pid)
        return result
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/actions/input")
async def action_input(request: Request):
    try:
        body: dict[str, Any] = await request.json()
        agent_id = body.get("agentId")
        text = body.get("text", "")
        agent, _ = agent_manager.find_agent_by_id(agent_id)
        if not agent or not agent.pid:
            return {"success": False, "error": "Agent not found or no PID"}
        result = await send_input(agent.pid, text)
        return result
    except Exception as e:
        return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Config Endpoint (extended)
# ---------------------------------------------------------------------------

@router.get("/api/config")
async def get_config():
    return {"success": True, "config": config.to_dict()}


@router.patch("/api/config")
async def patch_config(request: Request):
    try:
        body: dict[str, Any] = await request.json()
        for section in ("notifications", "session_watcher", "terminal"):
            if section in body and isinstance(body[section], dict):
                setter = getattr(config, f"set_{section}_pref", None)
                if setter:
                    for key, value in body[section].items():
                        setter(key, value)
        return {"success": True, "config": config.to_dict()}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Prompt History Endpoint
# ---------------------------------------------------------------------------

@router.get("/api/prompts")
async def get_prompts(search: str | None = None, project: str | None = None,
                      since: str | None = None, until: str | None = None, limit: int = 100):
    try:
        prompts = await db.get_prompts(search=search, project=project, since=since, until=until, limit=limit)
        return {"success": True, "prompts": prompts}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Insights Endpoints
# ---------------------------------------------------------------------------

@router.get("/api/insights/daily")
async def insights_daily(days: int = 30):
    try:
        events = await db.get_events(limit=10000, since=None)
        # Aggregate by day
        daily: dict[str, int] = {}
        for event in events:
            day = event.get("timestamp", "")[:10]
            if day:
                daily[day] = daily.get(day, 0) + 1
        sorted_days = sorted(daily.items())[-days:]
        return {"success": True, "daily": [{"date": d, "count": c} for d, c in sorted_days]}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/insights/models")
async def insights_models():
    try:
        # Get CLI versions from running processes
        import psutil as _psutil
        versions: dict[str, int] = {}
        for proc in _psutil.process_iter(["pid", "cmdline", "name"]):
            try:
                cmdline = proc.info.get("cmdline") or []
                if cmdline and cmdline[0].rstrip("/").split("/")[-1] == "claude":
                    ver = proc.info.get("name", "unknown")
                    versions[f"Claude {ver}"] = versions.get(f"Claude {ver}", 0) + 1
            except (_psutil.NoSuchProcess, _psutil.AccessDenied):
                pass
        if not versions:
            versions["unknown"] = 0
        return {"success": True, "models": [{"model": m, "count": c} for m, c in versions.items()]}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/insights/heatmap")
async def insights_heatmap():
    try:
        events = await db.get_events(limit=50000)
        heatmap: dict[str, int] = {}
        for event in events:
            ts = event.get("timestamp", "")
            if len(ts) >= 13:
                day_hour = ts[:13]  # "2026-02-27T14"
                heatmap[day_hour] = heatmap.get(day_hour, 0) + 1
        return {"success": True, "heatmap": [{"key": k, "count": v} for k, v in sorted(heatmap.items())]}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Plans Endpoint
# ---------------------------------------------------------------------------

@router.get("/api/plans")
async def get_plans():
    import glob
    import os
    plans_dir = os.path.expanduser("~/.claude/plans")
    results = []
    for plan_file in glob.glob(os.path.join(plans_dir, "*.md")):
        try:
            with open(plan_file, "r") as f:
                content = f.read()
            stat = os.stat(plan_file)
            results.append({
                "path": plan_file,
                "name": os.path.basename(plan_file),
                "content": content,
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "size": stat.st_size,
            })
        except Exception:
            pass
    results.sort(key=lambda p: p["modified"], reverse=True)
    return {"success": True, "plans": results}


# ---------------------------------------------------------------------------
# Logs Query Endpoint
# ---------------------------------------------------------------------------

@router.get("/api/logs")
async def get_logs(search: str | None = None, agent_id: str | None = None,
                   level: str | None = None, since: str | None = None,
                   until: str | None = None, limit: int = 200, offset: int = 0):
    try:
        logs = await db.get_logs(limit=limit, agent_id=agent_id, level=level, since=since)
        # Apply search filter in Python (SQLite doesn't have great full-text for this)
        if search:
            term = search.lower()
            logs = [l for l in logs if term in (l.get("message", "") or "").lower()]
        if until:
            logs = [l for l in logs if l.get("timestamp", "") <= until]
        # Apply offset for pagination
        logs = logs[offset:offset + limit]
        return {"success": True, "logs": logs, "count": len(logs)}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Agent Detail Endpoint
# ---------------------------------------------------------------------------

@router.get("/api/agents/{agent_id}")
async def get_agent_detail(agent_id: str):
    try:
        # Try live agent first
        agent, _ = agent_manager.find_agent_by_id(agent_id)
        agent_data = None
        if agent:
            agent_data = agent.model_dump(by_alias=True, mode="json")

        # Get from DB if not live
        if not agent_data:
            sessions = await db.get_sessions()
            for s in sessions:
                if s.get("id") == agent_id:
                    agent_data = s
                    break

        # Get logs for this agent
        logs = await db.get_logs(limit=500, agent_id=agent_id)

        # Get events for this agent
        events = await db.get_events(limit=200, agent_id=agent_id)

        return {
            "success": True,
            "agent": agent_data,
            "logs": logs,
            "events": events,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# History Endpoint (all sessions)
# ---------------------------------------------------------------------------

@router.get("/api/history")
async def get_history(search: str | None = None, status: str | None = None,
                      cwd: str | None = None, since: str | None = None,
                      until: str | None = None, limit: int = 50, offset: int = 0):
    try:
        sessions = await db.get_sessions(status=status)

        # Apply filters
        if search:
            term = search.lower()
            sessions = [s for s in sessions if
                        term in (s.get("agent_name", "") or "").lower() or
                        term in (s.get("working_directory", "") or "").lower() or
                        term in (s.get("id", "") or "").lower()]
        if cwd:
            sessions = [s for s in sessions if cwd.lower() in (s.get("working_directory", "") or "").lower()]
        if since:
            sessions = [s for s in sessions if (s.get("start_time", "") or "") >= since]
        if until:
            sessions = [s for s in sessions if (s.get("start_time", "") or "") <= until]

        # Sort newest first
        sessions.sort(key=lambda s: s.get("start_time", "") or "", reverse=True)

        total = len(sessions)
        sessions = sessions[offset:offset + limit]

        return {"success": True, "sessions": sessions, "total": total}
    except Exception as e:
        return {"success": False, "error": str(e)}
