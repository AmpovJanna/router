"""Shared deterministic stub agent invocation.

This module centralizes the stubbed agent behavior so API endpoints can call it
without endpoint-to-endpoint imports/calls.

Constraints:
- No real agent logic.
- Deterministic artifacts per agent_id.
"""

from __future__ import annotations

from typing import Any

from grand_router_contracts.agent import AgentId, AgentInvokeResponse, AgentStatus
from grand_router_contracts.artifacts import (
    Artifact,
    NextStepsArtifact,
    PatchArtifact,
    ProjectPlan,
    ProjectPlanArtifact,
    ProjectPlanPhase,
    ProjectPlanTask,
    RisksArtifact,
    TaskStatus,
    VerificationStepsArtifact,
)


def _stub_artifacts_for_agent(*, agent_id: AgentId, task: str) -> list[Artifact]:
    """Return deterministic stub artifacts per agent.

    Keep behavior identical to the previous in-endpoint implementation.
    """

    if agent_id == AgentId.codegen:
        return [
            PatchArtifact(
                patch=(
                    "*** Begin Patch\n"
                    "*** Update File: README.md\n"
                    "@@\n"
                    f"- TODO: {task}\n"
                    "+ TODO: Implemented deterministic stub\n"
                    "*** End Patch\n"
                )
            ),
            VerificationStepsArtifact(
                verification_steps=[
                    "Run unit tests",
                    "Run linters",
                    "Smoke test the API",
                ]
            ),
        ]

    if agent_id in {AgentId.projplan, AgentId.planner}:
        plan = ProjectPlan(
            projectName="Stub Project Plan",
            currentProgress=0,
            phases=[
                ProjectPlanPhase(
                    id="phase-1",
                    title="Requirements",
                    icon="search",
                    tasks=[
                        ProjectPlanTask(
                            id="task-1",
                            title="Gather requirements",
                            description="Clarify scope, constraints, and success metrics.",
                            completed=False,
                            status=TaskStatus.todo,
                        ),
                        ProjectPlanTask(
                            id="task-2",
                            title="Define milestones",
                            description="Break work into phases with deliverables and dates.",
                            completed=False,
                            status=TaskStatus.todo,
                        ),
                    ],
                ),
                ProjectPlanPhase(
                    id="phase-2",
                    title="Implementation",
                    icon="code",
                    tasks=[
                        ProjectPlanTask(
                            id="task-3",
                            title="Build skeleton",
                            description="Create the minimal project structure and core flows.",
                            completed=False,
                            status=TaskStatus.todo,
                        )
                    ],
                ),
                ProjectPlanPhase(
                    id="phase-3",
                    title="Integration & Testing",
                    icon="rocket",
                    tasks=[
                        ProjectPlanTask(
                            id="task-4",
                            title="Test and validate",
                            description="Run unit/integration tests and validate acceptance criteria.",
                            completed=False,
                            status=TaskStatus.todo,
                        )
                    ],
                ),
            ],
        )

        artifacts: list[Artifact] = [
            ProjectPlanArtifact(plan=plan),
            RisksArtifact(
                risks=["Scope creep", "Contract drift", "Missing test coverage"]
            ),
            NextStepsArtifact(
                next_steps=[
                    "Validate contracts",
                    "Add end-to-end tests",
                    "Document deployment",
                ]
            ),
        ]
        return artifacts

    return []


def invoke_stub_agent(
    agent_id: AgentId,
    task: str,
    context: dict[str, Any] | None = None,
) -> AgentInvokeResponse:
    """Invoke a deterministic stub agent.

    Args:
        agent_id: Which stub agent to invoke.
        task: The task/query to execute.
        context: Optional context bag (accepted for parity; currently unused).

    Returns:
        AgentInvokeResponse: Contract response.
    """

    _ = context or {}

    return AgentInvokeResponse(
        agent_id=agent_id,
        status=AgentStatus.ok,
        artifacts=_stub_artifacts_for_agent(agent_id=agent_id, task=task),
        notes=["Deterministic stub response (no real agent logic)."],
        clarifying_questions=[],
    )
