from __future__ import annotations

from dataclasses import dataclass

from grand_router_contracts.agent import AgentId
from grand_router_contracts.router import RouteItem, RouterRouteResponse

from ..agents.registry_models import AgentRegistryEntry


@dataclass(frozen=True)
class GuardrailResult:
    response: RouterRouteResponse
    changed: bool


def _value_str(x: object) -> str:
    v = getattr(x, "value", x)
    return "" if v is None else str(v)


def _enabled_agent_ids(agents: list[AgentRegistryEntry]) -> set[str]:
    return {_value_str(a.agent_id) for a in agents if a.enabled}


def clarification_response(
    *,
    questions: list[str],
    rationale: str,
    routes: list[RouteItem] | None = None,
) -> RouterRouteResponse:
    qs = [q.strip() for q in questions if q and q.strip()]
    if len(qs) > 2:
        qs = qs[:2]
    if not qs:
        qs = [
            "Could you clarify what you want to achieve?",
            "Should I route this to codegen or projplan?",
        ]

    # Keep at most one route so callers can persist pending continuation.
    kept = (routes or [])[:1]
    return RouterRouteResponse(
        routes=kept,
        needs_clarification=True,
        clarifying_questions=qs,
        routing_rationale=rationale,
    )


def _has_any(q: str, needles: set[str]) -> bool:
    return any(n in q for n in needles)


def apply_guardrails(
    *,
    llm_response: RouterRouteResponse,
    query: str,
    request_selected_agent_id: AgentId | None,
    agents: list[AgentRegistryEntry],
) -> GuardrailResult:
    """Deterministically validate/correct an LLM-produced RouterRouteResponse.

    Guarantees:
    - Always returns a valid RouterRouteResponse.
    - Ensures agent_id exists in registry AND is enabled.
    - Enforces selected_agent_id override semantics.
    - Detects strong-signal conflicts (code vs planning) and asks for clarification.

    Note: This is NOT a rules-only router; it only corrects/normalizes/blocks invalid or contradictory output.
    """

    enabled_ids = _enabled_agent_ids(agents)
    q = (query or "").lower()

    # Strong signals that the user wants code changes / debugging / refactoring.
    # Keep this list pragmatic: it should catch common intents without being overly broad.
    # NOTE: do NOT treat pure tech-stack mentions (python/node/npm/etc) as coding intent,
    # otherwise planning requests that mention a stack will spuriously trigger clarification.
    code_signals = {
        "stack trace",
        "traceback",
        "exception",
        "error",
        "bug",
        "debug",
        "fix",
        "refactor",
        "patch",
        "unit test",
        "failing test",
        "compile",
        "build",
        "failing",
    }

    # Strong signals that the user wants project planning / PM artifacts.
    # We treat explicit plan/roadmap/timeline phrasing as a decisive planning intent even
    # if the query mentions tech stack constraints.
    plan_signals = {
        "project plan",
        "execution plan",
        "detailed execution plan",
        "mvp plan",
        "plan",
        "planning",
        "timeline",
        "roadmap",
        "milestone",
        "milestones",
        "requirements",
        "dependencies",
        "raid",
        "raci",
        "status update",
    }

    # Stronger coding intent requires action verbs and (ideally) concrete artifacts.
    code_action_verbs = {
        "implement",
        "code",
        "write code",
        "change code",
        "modify",
        "edit",
        "update",
        "add",
        "remove",
        "delete",
        "create",
        "fix",
        "debug",
        "refactor",
        "optimize",
        "migrate",
    }
    code_artifacts = {
        ".py",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        "fastapi",
        "react",
        "openai api",
        "endpoint",
        "/api",
        "router",
        "function",
        "class",
        "file ",
        "diff",
        "pr",
        "commit",
        "stack trace",
        "traceback",
        "exception",
        "error:",
    }

    has_code = _has_any(q, code_signals)
    has_plan = _has_any(q, plan_signals)
    has_code_action = _has_any(q, code_action_verbs)
    has_code_artifact = _has_any(q, code_artifacts)

    # Prefer projplan for unambiguous planning requests.
    # Only treat as "both" when there's clear code intent (action verb) AND concrete artifacts.
    if has_plan and has_code and (not (has_code_action and has_code_artifact)):
        has_code = False

    if has_code and has_plan:
        guess_routes = llm_response.routes[:1] if llm_response.routes else []
        fixed = clarification_response(
            questions=[
                "Do you want a project plan, code changes, or both?",
                "If one: should I route this to codegen or projplan?",
            ],
            rationale="Request contains both planning and coding signals.",
            routes=guess_routes,
        )
        return GuardrailResult(response=fixed, changed=True)

    # If LLM requests clarification, enforce consistent shape.
    if llm_response.needs_clarification:
        fixed = clarification_response(
            questions=llm_response.clarifying_questions,
            rationale=llm_response.routing_rationale or "Clarification required.",
            routes=(llm_response.routes[:1] if llm_response.routes else []),
        )
        return GuardrailResult(response=fixed, changed=True)

    # If client selected an agent, we must honor it, but only if enabled.
    if request_selected_agent_id is not None:
        wanted = _value_str(request_selected_agent_id)
        if wanted not in enabled_ids:
            fixed = clarification_response(
                questions=[
                    f"Selected agent_id '{wanted}' is not available. Which agent should be used?"
                ],
                rationale="selected_agent_id was provided but is not enabled/available.",
            )
            return GuardrailResult(response=fixed, changed=True)

        subtask = llm_response.routes[0].subtask if llm_response.routes else query
        fixed = RouterRouteResponse(
            routes=[
                RouteItem(
                    agent_id=request_selected_agent_id, confidence=0.95, subtask=subtask
                )
            ],
            needs_clarification=False,
            clarifying_questions=[],
            routing_rationale=llm_response.routing_rationale
            or "Client selected agent.",
        )
        return GuardrailResult(response=fixed, changed=True)

    # No selection: validate routes.
    if not llm_response.routes:
        fixed = clarification_response(
            questions=["Which agent should handle this request?"],
            rationale=llm_response.routing_rationale or "No routes returned.",
        )
        return GuardrailResult(response=fixed, changed=True)

    primary = llm_response.routes[0]
    primary_id = _value_str(primary.agent_id)

    if primary_id not in enabled_ids:
        fixed = clarification_response(
            questions=[
                "I couldn't match this request to an available agent. Should I route it to codegen or projplan?"
            ],
            rationale=f"LLM returned unknown/disabled agent_id: {primary_id}",
        )
        return GuardrailResult(response=fixed, changed=True)

    # Strong-signal conflict handling.
    # Policy (per product requirement):
    # - If the user intent is clearly coding/debug/fix/refactor, route to codegen.
    # - If the user intent is clearly planning/PM, route to projplan.
    # - If both are present, ask for clarification.

    # Treat planner/projplan as synonyms for compatibility.
    if has_code and primary_id in {
        _value_str(AgentId.projplan),
        _value_str(AgentId.planner),
    }:
        fixed = RouterRouteResponse(
            routes=[
                RouteItem(
                    agent_id=AgentId.codegen,
                    confidence=max(primary.confidence, 0.95),
                    subtask=primary.subtask or "",
                )
            ],
            needs_clarification=False,
            clarifying_questions=[],
            routing_rationale="Guardrail override: coding/debugging signals detected; routing to codegen.",
        )
        return GuardrailResult(response=fixed, changed=True)

    if has_plan and primary_id == _value_str(AgentId.codegen):
        fixed = RouterRouteResponse(
            # Prefer canonical frontend planner id.
            routes=[
                RouteItem(
                    agent_id=AgentId.planner,
                    confidence=max(primary.confidence, 0.95),
                    subtask=primary.subtask or "",
                )
            ],
            needs_clarification=False,
            clarifying_questions=[],
            routing_rationale="Guardrail override: planning signals detected; routing to planner.",
        )
        return GuardrailResult(response=fixed, changed=True)

    # Normalize to single-route response for stability.
    conf = primary.confidence
    if conf < 0.0:
        conf = 0.0
    if conf > 1.0:
        conf = 1.0

    normalized = RouterRouteResponse(
        routes=[
            RouteItem(
                agent_id=primary.agent_id,
                confidence=conf,
                subtask=primary.subtask or "",
            )
        ],
        needs_clarification=False,
        clarifying_questions=[],
        routing_rationale=llm_response.routing_rationale,
    )

    return GuardrailResult(response=normalized, changed=True)
