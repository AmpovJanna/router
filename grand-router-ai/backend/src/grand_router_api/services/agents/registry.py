from __future__ import annotations

import json
from pathlib import Path
from typing import NewType

from .registry_models import AgentRegistry, AgentRegistryEntry

try:
    from grand_router_contracts.agent import AgentId as ContractAgentId

    AgentId = ContractAgentId
except Exception:  # pragma: no cover
    AgentId = NewType("AgentId", str)


_CACHE: AgentRegistry | None = None


def _value(x: object) -> str:
    return getattr(x, "value", x)  # type: ignore[return-value]


def _repo_root() -> Path:
    """Find repo root by walking upwards until service_directory/agents.json exists."""

    start = Path(__file__).resolve()
    for parent in [start, *start.parents]:
        candidate = parent / "service_directory" / "agents.json"
        if candidate.exists():
            return parent
    raise FileNotFoundError(
        "Could not locate repo root containing 'service_directory/agents.json' when searching from: "
        + str(start)
    )


def _agents_json_path() -> Path:
    return _repo_root() / "service_directory" / "agents.json"


def resolve_entrypoint(entrypoint: str) -> tuple[str, str]:
    """Return (module_path, symbol) from 'module.path:SymbolName'."""

    if ":" not in entrypoint:
        raise ValueError("entrypoint must contain ':'")
    module_path, symbol = entrypoint.split(":", 1)
    if not module_path or not symbol:
        raise ValueError("entrypoint must be in the form 'module.path:SymbolName'")
    return module_path, symbol


def load_registry(*, force_reload: bool = False) -> AgentRegistry:
    """Load and validate the declarative agent registry JSON.

    Uses a simple module-level cache to avoid re-reading the file repeatedly.
    """

    global _CACHE
    if _CACHE is not None and not force_reload:
        return _CACHE

    path = _agents_json_path()
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError as e:
        raise FileNotFoundError(f"Agent registry JSON not found at: {path}") from e

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in agent registry at {path}: {e}") from e

    _CACHE = AgentRegistry.model_validate(data)
    return _CACHE


def list_agents() -> list[AgentRegistryEntry]:
    return list(load_registry().root)


def get_agent(agent_id: AgentId) -> AgentRegistryEntry:
    wanted = str(_value(agent_id))
    for entry in load_registry().root:
        current = str(_value(entry.agent_id))
        if current == wanted:
            return entry
    raise KeyError(f"Agent not found: {wanted}")
