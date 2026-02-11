from __future__ import annotations

import json
from datetime import datetime, timezone

from grand_router_contracts.agent import (
    AgentId,
    AgentInvokeRequest,
    AgentInvokeResponse,
    AgentStatus,
)
from grand_router_contracts.artifacts import (
    NextStepsArtifact,
    PatchArtifact,
    ProjectPlanArtifact,
    RisksArtifact,
    VerificationStepsArtifact,
)
from grand_router_contracts.chat import (
    Chat,
    Message,
    MessageRole,
    RoutingMeta,
    RoutingMetaMode,
)
from grand_router_contracts.router import (
    RouteItem,
    RouterExecuteRequest,
    RouterExecuteResponse,
    RouterRouteRequest,
    RouterRouteResponse,
    RoutingMode,
)


def dump(title: str, obj) -> None:
    print(f"\n# {title}")
    if hasattr(obj, "model_dump"):
        print(json.dumps(obj.model_dump(mode="json"), indent=2, sort_keys=True))
    else:
        print(json.dumps(obj, indent=2, sort_keys=True))


def main() -> None:
    now = datetime.now(timezone.utc)

    # Artifacts (all types)
    patch = PatchArtifact(patch="diff --git a/a.txt b/a.txt\n...")
    verification = VerificationStepsArtifact(
        verification_steps=["Run unit tests", "Run smoke test"],
    )

    # Project plan is structured (not a free-form string).
    # Keep this smoke test aligned with the Planner UI artifact shape.
    from grand_router_contracts.artifacts import ProjectPlan, ProjectPlanPhase, ProjectPlanTask, TaskStatus

    project_plan = ProjectPlanArtifact(
        plan=ProjectPlan(
            projectName="Example Plan",
            currentProgress=0,
            phases=[
                ProjectPlanPhase(
                    id="p1",
                    title="Phase 1",
                    icon="search",
                    tasks=[
                        ProjectPlanTask(
                            id="t1",
                            title="Task 1",
                            description="Do X",
                            completed=False,
                            status=TaskStatus.todo,
                        )
                    ],
                )
            ],
        )
    )
    risks = RisksArtifact(risks=["May break API", "Needs migration"])
    next_steps = NextStepsArtifact(next_steps=["Deploy to staging", "Monitor logs"])

    dump("artifact.patch", patch)
    dump("artifact.verification_steps", verification)
    dump("artifact.project_plan", project_plan)
    dump("artifact.risks", risks)
    dump("artifact.next_steps", next_steps)

    # Agent invoke
    invoke_req = AgentInvokeRequest(
        agent_id=AgentId.codegen,
        task="Implement feature X",
        context={"repo": "grand-router-ai"},
        output_format="markdown",
    )
    invoke_res = AgentInvokeResponse(
        agent_id=AgentId.codegen,
        status=AgentStatus.ok,
        artifacts=[patch, verification, next_steps],
        notes=["Generated patch and verification steps"],
        clarifying_questions=[],
    )

    dump("agent.invoke.request", invoke_req)
    dump("agent.invoke.response", invoke_res)

    # Router route
    route_req = RouterRouteRequest(
        query="Please plan a new module builder project.",
        chat_id="chat_123",
        message_id="msg_1",
        context={"user": "alice"},
    )
    route_item = RouteItem(
        agent_id=AgentId.projplan,
        confidence=0.92,
        subtask="Create a project plan with milestones.",
    )
    route_res = RouterRouteResponse(
        routes=[route_item],
        needs_clarification=False,
        clarifying_questions=[],
        routing_rationale="Project planning request; route to projplan.",
    )

    dump("router.route.request", route_req)
    dump("router.route.response", route_res)

    # Router execute (route + agent response)
    exec_req = RouterExecuteRequest(
        query="Generate a patch for bug #123",
        mode=RoutingMode.auto,
        persist=False,
        context={"issue": 123},
    )
    exec_res = RouterExecuteResponse(
        route_response=RouterRouteResponse(
            routes=[
                RouteItem(
                    agent_id=AgentId.codegen,
                    confidence=0.88,
                    subtask="Generate patch for bug #123",
                )
            ],
            needs_clarification=False,
            routing_rationale="Code change requested; route to codegen.",
        ),
        agent_response=AgentInvokeResponse(
            agent_id=AgentId.codegen,
            status=AgentStatus.ok,
            artifacts=[patch, verification],
            notes=["Applied fix"],
        ),
    )

    dump("router.execute.request", exec_req)
    dump("router.execute.response", exec_res)

    # Chat + messages
    chat = Chat(
        chat_id="chat_123",
        title="Example chat",
        created_at=now,
        updated_at=now,
    )
    msg_user = Message(
        message_id="msg_1",
        chat_id=chat.chat_id,
        role=MessageRole.user,
        content="Hello",
        created_at=now,
    )
    msg_assistant = Message(
        message_id="msg_2",
        chat_id=chat.chat_id,
        role=MessageRole.assistant,
        content="Hi!",
        created_at=now,
        routing_meta=RoutingMeta(
            agent_id=AgentId.codegen,
            confidence=0.77,
            mode=RoutingMetaMode.auto,
        ),
    )

    dump("chat", chat)
    dump("message.user", msg_user)
    dump("message.assistant", msg_assistant)


if __name__ == "__main__":
    main()
