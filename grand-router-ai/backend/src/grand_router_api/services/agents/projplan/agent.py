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
from .subagents import (
    EditAgent,
    FollowupAgent,
    RiskAgent,
    ScopeAgent,
    StrategyAgent,
    TaskAgent,
)


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


def _is_edit_request(message: str) -> bool:
    """Detect if user wants to modify the existing plan."""
    edit_keywords = [
        "add",
        "remove",
        "delete",
        "change",
        "rename",
        "move",
        "reorder",
        "rearrange",
        "update",
        "modify",
        "edit",
        "insert",
        "replace",
        "swap",
        "put",
        "shift",
        "add a task",
        "add a phase",
        "new task",
        "new phase",
        "remove task",
        "remove phase",
        "delete task",
        "delete phase",
        "change the name",
        "rename task",
        "rename phase",
    ]
    msg_lower = message.lower()
    return any(kw in msg_lower for kw in edit_keywords)


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

                # Check if user wants to edit/modify the plan
                if _is_edit_request(user_query):
                    edit_result = EditAgent().run(
                        user_message=user_query,
                        plan_json=plan_json,
                    )
                    edited_plan = ProjectPlan.model_validate(
                        json.loads(edit_result.plan_json)
                    )
                    risks = RiskAgent().run(edit_result.plan_json)
                    risks_lines = [
                        r.strip() for r in risks.risks_md.splitlines() if r.strip()
                    ]

                    artifacts: list[Artifact] = [
                        ProjectPlanArtifact(plan=edited_plan),
                        RisksArtifact(risks=risks_lines[:10]),
                    ]

                    return AgentInvokeResponse(
                        agent_id=self.agent_id,
                        status=AgentStatus.ok,
                        artifacts=artifacts,
                        notes=["Plan updated based on your request."],
                        clarifying_questions=[],
                    )

                # Otherwise, just answer questions about the existing plan
                follow = FollowupAgent().run(
                    user_message=user_query,
                    plan_json=plan_json,
                    risks=(
                        ctx.get("last_risks")
                        if isinstance(ctx.get("last_risks"), list)
                        else None
                    ),
                )

                artifacts = [ProjectPlanArtifact(plan=existing_plan)]
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

        # Keep notes human-readable and UI-friendly. Avoid dumping internal sub-agent markdown.
        # The actual plan is rendered from artifacts in the Planner UI.
        phases = getattr(plan_obj, "phases", []) or []
        phase_titles = [str(getattr(p, "title", "")).strip() for p in phases]
        phase_titles = [t for t in phase_titles if t]

        total_tasks = 0
        p1_tasks: list[str] = []
        for idx, ph in enumerate(phases):
            tasks = getattr(ph, "tasks", []) or []
            total_tasks += len(tasks)
            if idx == 0:
                p1_tasks = [str(getattr(t, "title", "")).strip() for t in tasks][:5]
                p1_tasks = [t for t in p1_tasks if t]

        proj_name = str(getattr(plan_obj, "projectName", "")).strip() or "Project"

        explanation_lines: list[str] = [
            f"{proj_name} plan is ready.",
            "",
            "OVERVIEW",
            f"- {len(phases)} phases, {total_tasks} tasks",
            "- You can edit tasks and track progress in the workspace",
        ]

        if phase_titles:
            explanation_lines += [
                "",
                "PHASES",
                *[f"- {t}" for t in phase_titles[:6]],
            ]

        if p1_tasks:
            explanation_lines += [
                "",
                "START HERE (PHASE 1)",
                *[f"- {t}" for t in p1_tasks],
            ]

        if risks_lines:
            explanation_lines += [
                "",
                "TOP RISKS",
                *[f"- {r}" for r in risks_lines[:3]],
            ]

        explanation_lines += [
            "",
            "NEXT STEPS",
            "- Confirm scope + constraints (update anything missing)",
            "- Pick a realistic timeline (or share deadline and team size)",
            "- Start executing Phase 1 tasks",
        ]

        explanation_md = "\n".join(explanation_lines).strip()

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
