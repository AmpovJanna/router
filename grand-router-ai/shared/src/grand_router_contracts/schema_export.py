"""Schema export helpers.

This module is intentionally small and dependency-free beyond Pydantic.
It can be used by:
- backend: generate OpenAPI/JSON Schema artifacts
- frontend: consume JSON Schema for types (codegen)
- docs: publish contract schema snapshots
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel

from .agent import AgentInvokeRequest, AgentInvokeResponse
from .chat import Chat, Message
from .router import (
    RouterExecuteRequest,
    RouterExecuteResponse,
    RouterRouteRequest,
    RouterRouteResponse,
)


def export_json_schema() -> dict[str, Any]:
    """Return a single bundled JSON schema for the public contract models."""

    # Prefer a stable, explicit set of models rather than introspecting modules.
    return {
        "title": "grand-router-contracts",
        "models": {
            "RouterRouteRequest": RouterRouteRequest.model_json_schema(),
            "RouterRouteResponse": RouterRouteResponse.model_json_schema(),
            "RouterExecuteRequest": RouterExecuteRequest.model_json_schema(),
            "RouterExecuteResponse": RouterExecuteResponse.model_json_schema(),
            "AgentInvokeRequest": AgentInvokeRequest.model_json_schema(),
            "AgentInvokeResponse": AgentInvokeResponse.model_json_schema(),
            "Chat": Chat.model_json_schema(),
            "Message": Message.model_json_schema(),
        },
    }


def to_json(schema: dict[str, Any], *, indent: int = 2) -> str:
    """Serialize a schema dict to JSON."""

    return json.dumps(schema, indent=indent, sort_keys=True)


def model_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Convenience helper for exporting a single model's JSON schema."""

    return model.model_json_schema()
