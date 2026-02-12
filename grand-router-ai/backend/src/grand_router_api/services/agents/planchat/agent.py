"""PlanChat agent.

Purpose:
- Answer questions about an existing project plan (phases/tasks/risks) in a chat thread.
- Avoid regenerating a new plan.

The plan is provided via context.last_project_plan (JSON) and optional context.last_risks.
"""

from __future__ import annotations

import json
from typing import Any

from grand_router_contracts.agent import (
    AgentId,
    AgentInvokeRequest,
    AgentInvokeResponse,
    AgentStatus,
)
from grand_router_contracts.artifacts import ProjectPlan

from ..base import BaseAgent
from .prompting import build_prompt


class PlanChatAgent(BaseAgent):
    agent_id: AgentId = AgentId.planchat

    def invoke(self, request: AgentInvokeRequest) -> AgentInvokeResponse:
        question = (request.task or "").strip()
        if not question:
            return AgentInvokeResponse(
                agent_id=self.agent_id,
                status=AgentStatus.needs_clarification,
                artifacts=[],
                notes=["- Missing question."],
                clarifying_questions=["What do you want to know about the plan?"],
            )

        ctx: dict[str, Any] = request.context or {}
        raw_plan = ctx.get("last_project_plan")
        if not raw_plan:
            return AgentInvokeResponse(
                agent_id=self.agent_id,
                status=AgentStatus.needs_clarification,
                artifacts=[],
                notes=[
                    "I can answer plan questions once a plan exists in this chat.",
                    "Generate a plan first (or paste your plan JSON), then ask follow-ups here.",
                ],
                clarifying_questions=[
                    "Do you want me to generate an initial project plan for your idea?",
                ],
            )

        try:
            plan = ProjectPlan.model_validate(raw_plan)
        except Exception:
            return AgentInvokeResponse(
                agent_id=self.agent_id,
                status=AgentStatus.needs_clarification,
                artifacts=[],
                notes=["The saved plan context is present but invalid/corrupted."],
                clarifying_questions=[
                    "Please regenerate the plan (or paste the current plan JSON) so I can answer accurately.",
                ],
            )

        risks = ctx.get("last_risks")
        risks_list = risks if isinstance(risks, list) else []

        prompt = build_prompt(
            user_message=question,
            plan_json=json.dumps(plan.model_dump(mode="json"), ensure_ascii=False),
            risks=risks_list,
        )

        return AgentInvokeResponse(
            agent_id=self.agent_id,
            status=AgentStatus.ok,
            artifacts=[],
            notes=[prompt],
            clarifying_questions=[],
        )
