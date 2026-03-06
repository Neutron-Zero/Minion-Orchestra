from __future__ import annotations

from datetime import datetime, timezone

import socketio

from services import AgentManager, TaskQueue


async def broadcast_agent_update(sio: socketio.AsyncServer, agent_manager: AgentManager):
    await sio.emit("agent_update", agent_manager.get_all_agents_serialized())


async def broadcast_task_update(sio: socketio.AsyncServer, task_queue: TaskQueue):
    await sio.emit("task_update", task_queue.get_queue())


def register_handlers(sio: socketio.AsyncServer, agent_manager: AgentManager, task_queue: TaskQueue):

    @sio.on("connect")
    async def on_connect(sid, environ):
        # Send current state to newly connected client
        await sio.emit("agent_update", agent_manager.get_all_agents_serialized(), room=sid)
        await sio.emit("task_update", task_queue.get_queue(), room=sid)

    @sio.on("subscribe")
    async def on_subscribe(sid, data):
        pass

    @sio.on("register_agent")
    async def on_register_agent(sid, data):
        for key, agent in list(agent_manager.agents.items()):
            if agent.id == data.get("id"):
                agent_manager.remove_agent(key)

        agent = agent_manager.create_agent(
            id=data.get("id", sid),
            socket_id=sid,
            name=data.get("name", "Unknown Agent"),
            type=data.get("type", "general-purpose"),
            status="idle",
        )
        agent_manager.set_agent(sid, agent)
        print(f"Agent registered: {agent.id}")

        await sio.emit("welcome", {
            "id": agent.id,
            "agents": agent_manager.get_all_agents_serialized(),
            "taskQueue": task_queue.get_queue(),
        }, room=sid)
        await broadcast_agent_update(sio, agent_manager)

    @sio.on("status_update")
    async def on_status_update(sid, data):
        agent = agent_manager.get_agent_by_socket_id(sid)
        if not agent:
            return
        old_status = agent.status
        new_status = data.get("status", agent.status)
        agent.status = new_status
        agent.last_activity = datetime.now(timezone.utc)
        if old_status != new_status:
            task_queue.update_task_status(old_status, new_status)
            await broadcast_task_update(sio, task_queue)
        agent_manager.set_agent(sid, agent)
        await broadcast_agent_update(sio, agent_manager)

    @sio.on("task_update")
    async def on_task_update(sid, data):
        agent = agent_manager.get_agent_by_socket_id(sid)
        if not agent:
            return
        agent.current_task = data.get("task")
        agent.progress = data.get("progress", 0)
        agent.last_activity = datetime.now(timezone.utc)
        if agent.current_task:
            agent.start_time = datetime.now(timezone.utc)
            agent.status = "working"
        agent_manager.set_agent(sid, agent)
        await broadcast_agent_update(sio, agent_manager)

    @sio.on("metrics_update")
    async def on_metrics_update(sid, data):
        agent = agent_manager.get_agent_by_socket_id(sid)
        if not agent:
            return
        if data.get("tokensUsed"):
            agent.tokens_used += data["tokensUsed"]
        if data.get("toolCalls"):
            agent.tool_calls += data["toolCalls"]
        if data.get("metrics"):
            for k, v in data["metrics"].items():
                if hasattr(agent.metrics, k):
                    setattr(agent.metrics, k, v)
        agent.last_activity = datetime.now(timezone.utc)
        agent_manager.set_agent(sid, agent)
        await sio.emit("metrics", {
            "id": agent.id,
            "metrics": agent.metrics.model_dump(by_alias=True, mode="json"),
            "tokensUsed": agent.tokens_used,
            "toolCalls": agent.tool_calls,
        })
        await broadcast_agent_update(sio, agent_manager)

    @sio.on("log")
    async def on_log(sid, data):
        agent = agent_manager.get_agent_by_socket_id(sid)
        if not agent:
            return
        message = data.get("message", "")
        level = data.get("level", "info")
        if agent_manager.is_duplicate_log(agent.id, message, level):
            return
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "message": message,
            "agentId": agent.id,
        }
        agent_manager.add_agent_log(agent.id, log_entry)
        await sio.emit("log", log_entry)

    @sio.on("pause_agent")
    async def on_pause_agent(sid, data):
        agent_id = data.get("id") or data.get("agentId")
        agent, socket_id = agent_manager.find_agent_by_id(agent_id)
        if agent and socket_id:
            await sio.emit("control", {"command": "pause"}, room=socket_id)
            agent_manager.update_agent_status(agent_id, "paused")
            await broadcast_agent_update(sio, agent_manager)

    @sio.on("resume_agent")
    async def on_resume_agent(sid, data):
        agent_id = data.get("id") or data.get("agentId")
        agent, socket_id = agent_manager.find_agent_by_id(agent_id)
        if agent and socket_id:
            await sio.emit("control", {"command": "resume"}, room=socket_id)
            agent_manager.update_agent_status(agent_id, "working")
            await broadcast_agent_update(sio, agent_manager)

    @sio.on("disconnect")
    async def on_disconnect(sid):
        agent = agent_manager.get_agent_by_socket_id(sid)
        if agent:
            print(f"Agent disconnected: {agent.id}")
            task_queue.decrement(agent.status)
            agent_manager.remove_agent(sid)
            await broadcast_agent_update(sio, agent_manager)
            await broadcast_task_update(sio, task_queue)
