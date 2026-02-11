"""Top-level ProjPlan agent.

Phase 6: This module exports the symbol referenced by the registry entrypoint:
`grand_router_api.services.agents.projplan.agent:ProjPlanAgent`.

Behavior remains deterministic and stubbed (no real agent logic).
"""

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
    ProjectPlan,
    ProjectPlanArtifact,
    RisksArtifact,
)

from ..base import BaseAgent
from .subagents import FollowupAgent, RiskAgent, ScopeAgent, StrategyAgent, TaskAgent


def _extract_open_questions(requirements_md: str) -> list[str]:
    lines = [ln.rstrip() for ln in (requirements_md or "").splitlines()]
    out: list[str] = []
    in_section = False
    for ln in lines:
        if ln.strip().lower().startswith("## open questions"):
            in_section = True
            continue
        if in_section and ln.strip().startswith("## "):
            break
        if not in_section:
            continue
        s = ln.strip()
        if s.startswith("-") or s.startswith("*"):
            q = s.lstrip("-* ").strip()
            if q:
                out.append(q)
        if len(out) >= 5:
            break
    return out


class ProjPlanAgent(BaseAgent):
    # Expose it under the frontend-friendly id.
    agent_id: AgentId = AgentId.planner

    def invoke(self, request: AgentInvokeRequest) -> AgentInvokeResponse:
        user_query = (request.task or "").strip()
        if not user_query:
            return AgentInvokeResponse(
                agent_id=self.agent_id,
                status=AgentStatus.needs_clarification,
                artifacts=[],
                notes=["- Missing project request."],
                clarifying_questions=[
                    "What project do you want to plan? Please describe the goal and constraints."
                ],
            )

        ctx = request.context or {}

        # Follow-up mode: if we have an existing plan in memory, answer questions about it
        # and keep the same plan artifact.
        if ctx.get("last_project_plan"):
            try:
                existing_plan = ProjectPlan.model_validate(ctx.get("last_project_plan"))
                plan_json = json.dumps(
                    existing_plan.model_dump(mode="json"), ensure_ascii=False
                )
                follow = FollowupAgent().run(
                    user_message=user_query,
                    plan_json=plan_json,
                    risks=(
                        ctx.get("last_risks")
                        if isinstance(ctx.get("last_risks"), list)
                        else None
                    ),
                )

                artifacts: list[Artifact] = [ProjectPlanArtifact(plan=existing_plan)]
                if ctx.get("last_risks"):
                    artifacts.append(
                        RisksArtifact(
                            risks=[str(x) for x in (ctx.get("last_risks") or [])][:10]
                        )
                    )

                return AgentInvokeResponse(
                    agent_id=self.agent_id,
                    status=AgentStatus.ok,
                    artifacts=artifacts,
                    notes=[follow.answer_md],
                    clarifying_questions=[],
                )
            except Exception:
                # If memory payload is malformed, fall back to generating a new plan.
                pass

        # Phase 7: Multi-sub-agent planner pipeline.
        reqs = ScopeAgent().run(user_query)
        open_qs = _extract_open_questions(reqs.requirements_md)

        strat = StrategyAgent().run(reqs.requirements_md)
        json_str = TaskAgent().run(reqs.requirements_md, strat.strategy_md)

        plan_obj = ProjectPlan.model_validate(json.loads(json_str.plan_json))
        risks = RiskAgent().run(json_str.plan_json)
        risks_lines = [r.strip() for r in risks.risks_md.splitlines() if r.strip()]

        artifacts: list[Artifact] = [
            ProjectPlanArtifact(plan=plan_obj),
            RisksArtifact(risks=risks_lines[:10]),
        ]

        explanation_md = "\n".join(
            [
                "OVERVIEW",
                "This plan is organized into phases with concrete tasks you can track in the board.",
                "",
                "REQUIREMENTS / CONSTRAINTS (EXTRACTED)",
                (reqs.requirements_md.strip() or "(none)"),
                "",
                "STRATEGY",
                (strat.strategy_md.strip() or "(none)"),
                "",
                "HOW TO USE THIS PLAN",
                "- Start with Phase 1 tasks to confirm scope and constraints.",
                "- Then execute Phase 2/3 in order; keep tasks small and verifiable.",
                "- Review Risks tab before committing dates/budget.",
            ]
        )

        # If we have meaningful open questions, ask them so the user can refine the plan.
        if open_qs:
            return AgentInvokeResponse(
                agent_id=self.agent_id,
                status=AgentStatus.needs_clarification,
                artifacts=artifacts,
                notes=[explanation_md],
                clarifying_questions=open_qs[:5],
            )

        return AgentInvokeResponse(
            agent_id=self.agent_id,
            status=AgentStatus.ok,
            artifacts=artifacts,
            notes=[explanation_md],
            clarifying_questions=[],
        )
