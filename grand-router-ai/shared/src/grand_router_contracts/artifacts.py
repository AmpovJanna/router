"""Artifact models.

Artifacts are the primary structured output from agents.

Design goals:
- Minimal but extensible.
- Uses a discriminated union (Pydantic v2) keyed by the `type` field.
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


class ArtifactType(str, Enum):
    patch = "patch"
    verification_steps = "verification_steps"
    project_plan = "project_plan"
    risks = "risks"
    next_steps = "next_steps"


class ArtifactBase(BaseModel):
    type: ArtifactType


class PatchArtifact(ArtifactBase):
    type: Literal[ArtifactType.patch] = ArtifactType.patch
    patch: str = Field(..., description="Unified diff or patch text")


class VerificationStepsArtifact(ArtifactBase):
    type: Literal[ArtifactType.verification_steps] = ArtifactType.verification_steps
    verification_steps: list[str] = Field(..., description="Steps to verify the change")


# ---- Project planner (structured) ----


class TaskStatus(str, Enum):
    """UI-aligned task state.

    Must match `TaskStatus` in the Planner UI exactly.
    """

    todo = "todo"
    doing = "doing"
    done = "done"


class ProjectPlanTask(BaseModel):
    """Single actionable work item displayed in the Plan view and Task Board."""

    id: str
    title: str
    description: str

    # `completed` is a legacy / convenience flag still read by the UI.
    completed: bool

    # Canonical state.
    status: TaskStatus


class ProjectPlanPhase(BaseModel):
    """Phase groups tasks and provides a label + icon."""

    id: str
    title: str

    # Material Symbols icon name (e.g. "search", "palette", "code", "rocket").
    icon: str

    tasks: list[ProjectPlanTask]


class ProjectPlan(BaseModel):
    """Root object expected by the Planner UI."""

    projectName: str
    currentProgress: int = Field(..., ge=0, le=100, description="0-100")
    phases: list[ProjectPlanPhase]


class ProjectPlanArtifact(ArtifactBase):
    type: Literal[ArtifactType.project_plan] = ArtifactType.project_plan

    # IMPORTANT: This must match the Planner UI `ProjectPlan` schema.
    plan: ProjectPlan


class RisksArtifact(ArtifactBase):
    type: Literal[ArtifactType.risks] = ArtifactType.risks
    risks: list[str] = Field(..., description="Known risks")


class NextStepsArtifact(ArtifactBase):
    type: Literal[ArtifactType.next_steps] = ArtifactType.next_steps
    next_steps: list[str] = Field(..., description="Recommended next actions")


Artifact = Annotated[
    Union[
        PatchArtifact,
        VerificationStepsArtifact,
        ProjectPlanArtifact,
        RisksArtifact,
        NextStepsArtifact,
    ],
    Field(discriminator="type"),
]
