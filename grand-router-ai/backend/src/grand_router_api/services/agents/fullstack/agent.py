"""FullStack agent - combines project planning with code generation."""

from __future__ import annotations

import json

from grand_router_contracts.agent import (
    AgentId,
    AgentInvokeRequest,
    AgentInvokeResponse,
    AgentStatus,
)
from grand_router_contracts.artifacts import (
    Artifact,
    PatchArtifact,
    ProjectPlan,
    ProjectPlanArtifact,
    RisksArtifact,
)

from ..base import BaseAgent
from ..codegen.agent import CodeGenAgent
from ..projplan.agent import ProjPlanAgent


class FullStackAgent(BaseAgent):
    """Orchestrates planner + codegen in sequence."""

    agent_id: AgentId = AgentId.fullstack

    def invoke(self, request: AgentInvokeRequest) -> AgentInvokeResponse:
        user_query = (request.task or "").strip()
        if not user_query:
            return AgentInvokeResponse(
                agent_id=self.agent_id,
                status=AgentStatus.needs_clarification,
                artifacts=[],
                notes=["- Missing project request."],
                clarifying_questions=[
                    "What project do you want to build? Please describe the goal and constraints."
                ],
            )

        # Step 1: Run planner
        planner_request = AgentInvokeRequest(
            agent_id=AgentId.planner,
            task=user_query,
            context=request.context,
        )
        planner_response = ProjPlanAgent().invoke(planner_request)

        if planner_response.status == AgentStatus.needs_clarification:
            # Pass through clarification
            return AgentInvokeResponse(
                agent_id=self.agent_id,
                status=AgentStatus.needs_clarification,
                artifacts=[],
                notes=planner_response.notes,
                clarifying_questions=planner_response.clarifying_questions,
            )

        # Extract plan from planner response
        plan_artifact = None
        risks_artifact = None
        for artifact in planner_response.artifacts:
            if artifact.type == "project_plan":
                plan_artifact = artifact
            elif artifact.type == "risks":
                risks_artifact = artifact

        if not plan_artifact:
            return AgentInvokeResponse(
                agent_id=self.agent_id,
                status=AgentStatus.error,
                artifacts=[],
                notes=["Planner failed to generate a plan."],
                clarifying_questions=[],
            )

        # Step 2: Run codegen with the plan
        plan = plan_artifact.plan
        phase1_tasks = []
        if plan.phases and len(plan.phases) > 0:
            phase1 = plan.phases[0]
            phase1_tasks = [task.title for task in phase1.tasks[:3]]

        codegen_task = f"""Implement the first phase of this project:

Project: {plan.projectName}

Phase 1 tasks:
{chr(10).join(f"- {t}" for t in phase1_tasks)}

Generate the initial project structure and implementation for these tasks.
"""

        codegen_request = AgentInvokeRequest(
            agent_id=AgentId.codegen,
            task=codegen_task,
            context={
                "project_plan": plan.model_dump(mode="json"),
                **(request.context or {}),
            },
        )
        codegen_response = CodeGenAgent().invoke(codegen_request)

        # Combine artifacts from both
        all_artifacts: list[Artifact] = [plan_artifact]
        if risks_artifact:
            all_artifacts.append(risks_artifact)

        # Add codegen artifacts (patches, etc.)
        for artifact in codegen_response.artifacts:
            if artifact.type != "project_plan":  # Don't duplicate plan
                all_artifacts.append(artifact)

        # Combine notes into a clear, readable summary
        phase_names = [p.name for p in plan.phases[:3]]
        phase_list = "\n".join(
            [f"- **Phase {i + 1}:** {name}" for i, name in enumerate(phase_names)]
        )

        notes = [
            f"# ✅ Project Complete: {plan.projectName}\n\n",
            "I've created both a detailed project roadmap and started implementing the code for you.\n\n",
            f"## 📋 Project Roadmap ({len(plan.phases)} phases)\n\n",
            f"{phase_list}",
            "\n\n## 💻 Code Generated\n\n",
            f"Implemented Phase 1 with {len([a for a in codegen_response.artifacts if a.type == 'patch'])} code file(s).",
            " The initial project structure is ready to use.",
            "\n\n## 🎯 What's Next?\n\n",
            "- Review the roadmap in the Planner view (phases & tasks)",
            "- Check the generated code in the chat sidebar",
            "- Ask me to implement Phase 2 when you're ready",
        ]

        if codegen_response.notes:
            notes.extend(["\n\n### Additional Notes:\n"] + codegen_response.notes)

        return AgentInvokeResponse(
            agent_id=self.agent_id,
            status=AgentStatus.ok,
            artifacts=all_artifacts,
            notes=notes,
            clarifying_questions=[],
        )
