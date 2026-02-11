from __future__ import annotations

from grand_router_contracts.router import RouteItem, RouterRouteRequest, RouterRouteResponse

from ..agents.registry import list_agents
from .guardrails import apply_guardrails, clarification_response
from .llm_router import LLMRouterError, route_with_llm


def route_hybrid(*, request: RouterRouteRequest, force_deterministic: bool = False) -> RouterRouteResponse:
    """Hybrid router orchestrator.

    - Loads agent registry
    - Calls LLM router first unless force_deterministic=True
    - Parses/validates via RouterRouteResponse (inside LLM router)
    - Applies deterministic guardrails (registry+enabled membership, strong-signal conflicts)
    - Returns final RouterRouteResponse

    Deterministic mode is used by /execute when mode=forced.
    """

    agents_all = list_agents()
    agents = [a for a in agents_all if a.enabled]

    # Forced deterministic: bypass LLM completely.
    if force_deterministic:
        if request.selected_agent_id is None:
            return clarification_response(
                questions=[
                    "mode=forced requires forced_agent_id. Which agent should be forced (codegen or projplan)?"
                ],
                rationale="Forced mode requested but no agent was provided.",
            )

        seeded = RouterRouteResponse(
            routes=[
                RouteItem(
                    agent_id=request.selected_agent_id,
                    confidence=1.0,
                    subtask=request.query,
                )
            ],
            needs_clarification=False,
            clarifying_questions=[],
            routing_rationale="Forced route.",
        )

        return apply_guardrails(
            llm_response=seeded,
            query=request.query,
            request_selected_agent_id=request.selected_agent_id,
            agents=agents,
        ).response

    # Auto mode: LLM-primary.
    try:
        llm_resp = route_with_llm(request, agents)
    except LLMRouterError:
        return clarification_response(
            questions=[
                "I couldn't confidently route this request. Should I send it to codegen or projplan?"
            ],
            rationale="LLM routing failed; clarification required.",
        )
    except Exception:  # pragma: no cover
        return clarification_response(
            questions=["I couldn't route this request. Could you clarify your goal?"],
            rationale="Unexpected routing error; clarification required.",
        )

    return apply_guardrails(
        llm_response=llm_resp,
        query=request.query,
        request_selected_agent_id=request.selected_agent_id,
        agents=agents,
    ).response
