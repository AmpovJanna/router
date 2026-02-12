"""Agent invocation contracts.

These models are used for calling a specific agent and returning structured artifacts.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from .api_version import API_VERSION
from .artifacts import Artifact


class AgentId(str, Enum):
    codegen = "codegen"

    # Project planner agent (preferred id for frontend semantics)
    planner = "planner"

    # Backward-compat alias for older clients / registry entries
    projplan = "projplan"

    # Internal UX agent: rewrites agent output for sidebar readability.
    chatwriter = "chatwriter"

    # Q&A assistant for code context (avoids running full codegen pipeline).
    codechat = "codechat"

    # Q&A assistant for an existing project plan (planner follow-ups without regenerating plan).
    planchat = "planchat"

    # Full-stack: combines planning + code generation in sequence.
    fullstack = "fullstack"


class AgentStatus(str, Enum):
    ok = "ok"
    error = "error"
    needs_clarification = "needs_clarification"


class AgentInvokeRequest(BaseModel):
    agent_id: AgentId
    task: str
    context: dict[str, Any] = Field(default_factory=dict)
    output_format: str | None = Field(
        default=None,
        description="Optional hint (kept as string for forward-compatibility).",
    )


class AgentInvokeResponse(BaseModel):
    api_version: str = Field(default=API_VERSION)
    agent_id: AgentId
    status: AgentStatus
    artifacts: list[Artifact] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    clarifying_questions: list[str] = Field(default_factory=list)
