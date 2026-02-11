from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient


def test_execute_continuation_preserves_original_query(monkeypatch: Any) -> None:
    """Regression test: clarification continuation must not drop original constraints.

    Scenario:
    - First /router/execute persists a chat and returns needs_clarification.
    - It stores pending_continuation.original_query.
    - Second /router/execute sends a short clarification answer.
    - The invoked agent must receive a task containing BOTH the original query and the answer.
    """

    # Import inside the test so monkeypatching works reliably.
    from grand_router_api.main import app
    from grand_router_contracts.router import RouterRouteResponse

    client = TestClient(app)

    captured: dict[str, Any] = {}

    def fake_route_hybrid(*, request: Any, force_deterministic: bool = False) -> RouterRouteResponse:
        # First turn asks for clarification but includes a route to planner so pending is stored.
        return RouterRouteResponse.model_validate(
            {
                "routes": [{"agent_id": "planner", "confidence": 0.9, "subtask": ""}],
                "needs_clarification": True,
                "clarifying_questions": ["Do you want a project plan, code changes, or both?"],
                "routing_rationale": "Ambiguous",
            }
        )

    def fake_invoke_agent(agent_id: Any, req: Any) -> Any:
        from grand_router_contracts.agent import AgentInvokeResponse, AgentStatus

        captured["agent_id"] = str(agent_id)
        captured["task"] = req.task
        captured["context"] = req.context

        return AgentInvokeResponse(
            agent_id="planner",
            status=AgentStatus.ok,
            notes=["ok"],
            artifacts=[],
            clarifying_questions=[],
        )

    # Patch the symbols used by the router endpoint module.
    import grand_router_api.api.v1.router as router_endpoint

    monkeypatch.setattr(router_endpoint, "route_hybrid", fake_route_hybrid)
    monkeypatch.setattr(router_endpoint, "invoke_agent", fake_invoke_agent)

    # Turn 1: initial query with constraints.
    original_query = (
        "Build an MVP by May 1 with a team of 3, budget $20k, stack: FastAPI + React. "
        "Need a plan and risks."
    )
    r1 = client.post(
        "/api/v1/router/execute",
        json={
            "query": original_query,
            "persist": True,
        },
    )
    assert r1.status_code == 200
    body1 = r1.json()
    assert body1["route_response"]["needs_clarification"] is True
    assert body1.get("chat_id")

    # Turn 2: clarification answer only.
    clarification = "project plan"
    r2 = client.post(
        "/api/v1/router/execute",
        json={
            "query": clarification,
            "persist": True,
            "chat_id": body1["chat_id"],
        },
    )
    assert r2.status_code == 200

    # Validate the invoked task preserves original constraints.
    task = captured.get("task") or ""
    assert "ORIGINAL USER REQUEST" in task
    assert "USER CLARIFICATION ANSWER" in task
    assert "MVP by May 1" in task
    assert "budget $20k" in task
    assert "FastAPI + React" in task
    assert "project plan" in task
