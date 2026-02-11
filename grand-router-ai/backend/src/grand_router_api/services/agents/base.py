from __future__ import annotations

from typing import Protocol, runtime_checkable

from grand_router_contracts.agent import AgentId, AgentInvokeRequest, AgentInvokeResponse


@runtime_checkable
class BaseAgent(Protocol):
    """Stable interface for dynamically loaded agents.

    Implementations are discovered via the declarative registry in
    `service_directory/agents.json` and loaded by
    `grand_router_api.services.agents.runner.invoke_agent`.

    Agents must be instantiable with a zero-argument constructor.
    """

    agent_id: AgentId

    def invoke(self, request: AgentInvokeRequest) -> AgentInvokeResponse:
        ...
