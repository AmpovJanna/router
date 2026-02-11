"""Router contracts.

Routing determines which agent(s) should handle a query.

Notes:
- `route` is the pure decision step.
- `execute` can optionally route + invoke an agent in one call.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from .api_version import API_VERSION
from .agent import AgentId, AgentInvokeResponse


class RoutingMode(str, Enum):
    auto = "auto"
    forced = "forced"


class RouteItem(BaseModel):
    agent_id: AgentId
    confidence: float = Field(..., ge=0.0, le=1.0)
    subtask: str


class RouterRouteRequest(BaseModel):
    query: str
    chat_id: str | None = None
    message_id: str | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    selected_agent_id: AgentId | None = Field(
        default=None,
        description="Optional client override (e.g. user chose a specific agent).",
    )


class RouterRouteResponse(BaseModel):
    api_version: str = Field(default=API_VERSION)
    routes: list[RouteItem] = Field(default_factory=list)
    needs_clarification: bool = False
    clarifying_questions: list[str] = Field(default_factory=list)
    routing_rationale: str | None = None


class RouterExecuteRequest(BaseModel):
    query: str
    chat_id: str | None = None
    message_id: str | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    mode: RoutingMode = RoutingMode.auto
    forced_agent_id: AgentId | None = None
    persist: bool = False


class RouterExecuteResponse(BaseModel):
    api_version: str = Field(default=API_VERSION)
    route_response: RouterRouteResponse
    agent_response: AgentInvokeResponse | None = None
    chat_id: str | None = Field(
        default=None,
        description="When persist=true, the server may create/ensure a chat_id. Return it so clients can continue the same conversation.",
    )
