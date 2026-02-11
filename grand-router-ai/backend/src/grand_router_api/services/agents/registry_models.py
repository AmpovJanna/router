from __future__ import annotations

from typing import NewType

from pydantic import BaseModel, Field, RootModel, field_validator, model_validator

try:
    # Prefer shared contracts type if available in runtime environment.
    from grand_router_contracts.agent import AgentId as ContractAgentId

    AgentId = ContractAgentId
except Exception:  # pragma: no cover
    # Fallback to a local type so this module can still load in isolation.
    AgentId = NewType("AgentId", str)


class AgentRegistryEntry(BaseModel):
    agent_id: AgentId
    name: str
    description: str
    keywords: list[str]
    entrypoint: str
    version: str | None = None
    enabled: bool = True

    @field_validator("entrypoint")
    @classmethod
    def validate_entrypoint_has_colon(cls, v: str) -> str:
        if ":" not in v:
            raise ValueError("entrypoint must be in the form 'module.path:SymbolName'")
        module_path, symbol = v.split(":", 1)
        if not module_path or not symbol:
            raise ValueError("entrypoint must be in the form 'module.path:SymbolName'")
        return v

    @field_validator("keywords")
    @classmethod
    def normalize_keywords(cls, v: list[str]) -> list[str]:
        # Normalize for routing stability: strip, lowercase, drop empties, dedupe.
        normalized: list[str] = []
        seen: set[str] = set()
        for kw in v:
            nkw = kw.strip().lower()
            if not nkw:
                continue
            if nkw in seen:
                continue
            seen.add(nkw)
            normalized.append(nkw)
        if not normalized:
            raise ValueError("keywords must contain at least one non-empty keyword")
        return normalized


class AgentRegistry(RootModel[list[AgentRegistryEntry]]):
    root: list[AgentRegistryEntry] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_unique_agent_ids(self) -> "AgentRegistry":
        seen: set[str] = set()
        for entry in self.root:
            key = str(entry.agent_id)
            if key in seen:
                raise ValueError(f"Duplicate agent_id in registry: {key}")
            seen.add(key)
        return self
