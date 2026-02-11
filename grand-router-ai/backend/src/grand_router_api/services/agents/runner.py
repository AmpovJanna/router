"""Dynamic agent invocation.

Phase 6: agents are loaded from the declarative registry entries in
`service_directory/agents.json`.

Runner responsibilities:
- registry lookup + enabled check
- parse entrypoint `module:Symbol`
- import module via importlib
- resolve symbol
- instantiate agent with no args
- validate it conforms to BaseAgent
- validate agent_id matches
- invoke agent

This module intentionally raises clean exceptions suitable for mapping to HTTP
errors by API layers.
"""

from __future__ import annotations

import importlib
import logging
from dataclasses import dataclass
from typing import Any

from grand_router_contracts.agent import AgentId, AgentInvokeRequest, AgentInvokeResponse

from .base import BaseAgent
from .registry import get_agent, resolve_entrypoint
from .registry_models import AgentRegistryEntry

logger = logging.getLogger(__name__)


@dataclass
class AgentInvokeError(RuntimeError):
    code: str
    message: str = ""

    def __post_init__(self) -> None:
        # Ensure the base RuntimeError args contains the message for standard error behavior.
        super().__init__(self.message)

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.code}: {self.message}".strip()


def _ensure_agent_enabled(agent_id: AgentId) -> AgentRegistryEntry:
    try:
        entry = get_agent(agent_id)
    except KeyError as e:
        raise AgentInvokeError("not_found", str(e)) from e

    if not entry.enabled:
        raise AgentInvokeError("disabled", f"Agent disabled: {agent_id}")

    return entry


def invoke_agent(agent_id: AgentId, request: AgentInvokeRequest) -> AgentInvokeResponse:
    if request.agent_id != agent_id:
        raise AgentInvokeError(
            "bad_request",
            "agent_id mismatch between path and body",
        )

    logger.info("agent.invoke start agent_id=%s", agent_id)

    entry = _ensure_agent_enabled(agent_id)

    try:
        module_path, symbol = resolve_entrypoint(entry.entrypoint)
    except Exception as e:
        raise AgentInvokeError(
            "bad_entrypoint",
            f"Invalid entrypoint for {agent_id}: {entry.entrypoint}",
        ) from e

    try:
        module = importlib.import_module(module_path)
    except Exception as e:
        raise AgentInvokeError(
            "import_error",
            f"Failed to import module '{module_path}' for agent {agent_id}",
        ) from e

    try:
        target: Any = getattr(module, symbol)
    except AttributeError as e:
        raise AgentInvokeError(
            "symbol_not_found",
            f"Symbol '{symbol}' not found in module '{module_path}' for agent {agent_id}",
        ) from e

    try:
        agent_obj = target()
    except Exception as e:
        raise AgentInvokeError(
            "instantiate_error",
            f"Failed to instantiate '{module_path}:{symbol}' for agent {agent_id} (expected no-arg constructor)",
        ) from e

    if not isinstance(agent_obj, BaseAgent):
        raise AgentInvokeError(
            "type_error",
            f"Loaded object does not conform to BaseAgent: {module_path}:{symbol}",
        )

    if agent_obj.agent_id != agent_id:
        raise AgentInvokeError(
            "agent_id_mismatch",
            f"Loaded agent_id {agent_obj.agent_id} does not match requested {agent_id}",
        )

    try:
        resp = agent_obj.invoke(request)
        logger.info("agent.invoke end agent_id=%s status=%s", agent_id, getattr(resp, "status", None))
        return resp
    except AgentInvokeError:
        logger.info("agent.invoke end agent_id=%s status=error(AgentInvokeError)", agent_id)
        raise
    except Exception as e:
        logger.exception("agent.invoke end agent_id=%s status=error(unhandled)", agent_id)
        raise AgentInvokeError("invoke_error", f"Agent invocation failed for {agent_id}") from e
