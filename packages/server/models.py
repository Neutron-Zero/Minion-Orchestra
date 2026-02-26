from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


def to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(w.capitalize() for w in parts[1:])


class AgentMetrics(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    cpu_usage: float = 0
    memory_usage: float = 0
    requests_per_second: float = 0
    average_response_time: float = 0


class Agent(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str
    socket_id: str
    name: str = "Claude Agent"
    type: str = "claude-code"
    status: str = "idle"
    current_task: str | None = None
    current_tool: str | None = None
    current_tool_description: str | None = None
    start_time: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_activity: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    progress: int = 0
    tokens_used: int = 0
    tool_calls: int = 0
    logs: list[dict[str, Any]] = Field(default_factory=list)
    metrics: AgentMetrics = Field(default_factory=AgentMetrics)
    recent_tools: list[str] = Field(default_factory=list)
    last_tool_used: str | None = None
    last_tool_time: datetime | None = None
    pid: int | None = None
    session_data: dict[str, Any] | None = None
    working_directory: str | None = None


class HookEvent(BaseModel):
    eventType: str
    agentId: str
    agentName: str | None = None
    timestamp: str | None = None
    pid: int | None = None
    data: dict[str, Any] | None = None
    response: dict[str, Any] | None = None
