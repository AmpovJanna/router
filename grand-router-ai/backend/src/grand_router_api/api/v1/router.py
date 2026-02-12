"""Router endpoints (v1): /router/route and /router/execute."""

from __future__ import annotations

from datetime import datetime
import logging

from fastapi import APIRouter, HTTPException

from grand_router_contracts.agent import AgentInvokeResponse, AgentStatus
from grand_router_contracts.chat import (
    MessageRole,
    PendingContinuation,
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

from grand_router_contracts.agent import AgentInvokeRequest

from ...services.agents.runner import AgentInvokeError, invoke_agent
from ...services.persistence.file_store import FileChatStore
from ...services.routing.hybrid_router import route_hybrid

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/router", tags=["router"])

_store = FileChatStore()


# Legacy deterministic stub routing logic lived here in earlier phases.


@router.post("/route", response_model=RouterRouteResponse)
def route(req: RouterRouteRequest) -> RouterRouteResponse:
    # Phase 5: LLM-primary routing with deterministic guardrails.
    return route_hybrid(request=req, force_deterministic=False)


def _ensure_chat_id_for_persist(*, chat_id: str | None, query: str) -> str:
    if chat_id:
        # If provided but not found -> 404
        try:
            _store.get_chat(chat_id)
        except KeyError as e:
            raise HTTPException(
                status_code=404, detail=f"Chat not found: {chat_id}"
            ) from e
        return chat_id

    # If missing -> auto-create
    title = (query or "New chat")[:40]
    return _store.create_chat(title).chat_id


@router.post("/execute", response_model=RouterExecuteResponse)
def execute(req: RouterExecuteRequest) -> RouterExecuteResponse:
    logger.info(
        "router.execute received chat_id=%s mode=%s forced_agent_id=%s",
        req.chat_id,
        req.mode,
        getattr(req, "forced_agent_id", None),
    )

    # IMPORTANT:
    # In persist=true mode, we must ensure a stable chat_id before we can reliably
    # perform multi-turn behaviors like clarification continuations.
    #
    # Previously, when the frontend started a new chat (chat_id=None), /execute would:
    # - return needs_clarification
    # - auto-create a chat_id internally for persistence
    # - BUT it did not return that chat_id to the client
    # Result: the follow-up answer was sent with chat_id=None again, so the backend
    # never saw pending_continuation and the clarification question repeated endlessly.
    ensured_chat_id: str | None = None
    if req.persist:
        ensured_chat_id = _ensure_chat_id_for_persist(
            chat_id=req.chat_id, query=req.query
        )

    # Auto-continue path: if a chat has a pending continuation, treat this user message
    # as the clarification answer and re-invoke the pending agent with a combined task.
    #
    # IMPORTANT:
    # - Users sometimes answer with extremely short strings ("project plan", "both", etc).
    # - The invoked agent MUST still see the full original query (constraints, stack, dates...)
    #   plus the clarification answer. Otherwise the planner's scope step will claim no
    #   constraints were provided.
    if req.persist and ensured_chat_id:
        try:
            chat = _store.get_chat(ensured_chat_id)
        except KeyError as e:
            raise HTTPException(
                status_code=404, detail=f"Chat not found: {ensured_chat_id}"
            ) from e

        pending = getattr(chat, "pending_continuation", None)
        if pending is not None:
            original = (pending.original_query or "").strip()
            clarification = (req.query or "").strip()

            # Defensive merge: never allow the combined task to collapse to the short
            # clarification answer.
            if not original:
                original = "(missing original_query in pending continuation)"

            combined_task = (
                "\n\n".join(
                    [
                        "ORIGINAL USER REQUEST:\n" + original,
                        "USER CLARIFICATION ANSWER:\n" + clarification,
                    ]
                ).strip()
                + "\n"
            )

            combined_context: dict = {**(pending.context_snapshot or {})}
            if req.context:
                # Shallow-merge; request context wins.
                combined_context.update(req.context)

            logger.info(
                "router.execute continuation invoking agent_id=%s original_len=%s clarification_len=%s ctx_keys=%s",
                pending.agent_id,
                len(original),
                len(clarification),
                sorted(list(combined_context.keys())),
            )

            try:
                agent_response = invoke_agent(
                    pending.agent_id,
                    AgentInvokeRequest(
                        agent_id=pending.agent_id,
                        task=combined_task,
                        context=combined_context,
                    ),
                )
            except AgentInvokeError as e:
                if e.code == "not_found":
                    raise HTTPException(status_code=404, detail=str(e)) from e
                if e.code in {"disabled", "bad_request", "agent_id_mismatch"}:
                    raise HTTPException(status_code=400, detail=str(e)) from e
                raise HTTPException(status_code=500, detail=str(e)) from e

            # Persist messages + clear pending.
            chat_id = ensured_chat_id

            _store.create_message(
                chat_id=chat_id,
                role=MessageRole.user,
                content=req.query,
                routing_meta=None,
                artifacts=[],
            )

            routing_meta = RoutingMeta(
                agent_id=pending.agent_id, confidence=1.0, mode=RoutingMetaMode.forced
            )
            assistant_content = (
                "\n".join(agent_response.notes)
                if agent_response.notes
                else "(no notes)"
            )
            _store.create_message(
                chat_id=chat_id,
                role=MessageRole.assistant,
                content=assistant_content,
                routing_meta=routing_meta,
                artifacts=agent_response.artifacts,
            )

            _store.set_pending_continuation(chat_id, None)

            # Provide a minimal route_response for UI compatibility.
            route_response = RouterRouteResponse(
                routes=[
                    RouteItem(
                        agent_id=pending.agent_id,
                        confidence=1.0,
                        subtask="continuation",
                    )
                ],
                needs_clarification=False,
                clarifying_questions=[],
                routing_rationale="Auto-continued from pending clarification.",
            )
            return RouterExecuteResponse(
                route_response=route_response,
                agent_response=agent_response,
                chat_id=ensured_chat_id,
            )

    # Always compute a route_response, respecting mode + forced_agent_id.
    selected_agent_id = req.forced_agent_id if req.mode == RoutingMode.forced else None
    route_response = route_hybrid(
        request=RouterRouteRequest(
            query=req.query,
            chat_id=ensured_chat_id or req.chat_id,
            message_id=req.message_id,
            context=req.context,
            selected_agent_id=selected_agent_id,
        ),
        force_deterministic=(req.mode == RoutingMode.forced),
    )

    chosen_agent = route_response.routes[0].agent_id if route_response.routes else None
    logger.info(
        "router.execute routing_result needs_clarification=%s chosen_agent=%s",
        route_response.needs_clarification,
        chosen_agent,
    )

    # Clarification path: no agent invocation.
    if route_response.needs_clarification:
        agent_response: AgentInvokeResponse | None = None

        if req.persist and ensured_chat_id:
            chat_id = ensured_chat_id

            # Persist user message (no routing_meta, artifacts=[])
            _store.create_message(
                chat_id=chat_id,
                role=MessageRole.user,
                content=req.query,
                routing_meta=None,
                artifacts=[],
            )

            # Persist assistant clarifying question(s).
            # If we have a best-guess route, persist it so the UI doesn't show "Routed to: (missing)".
            clarifying_text = (
                "\n".join(route_response.clarifying_questions)
                or "Please clarify your request."
            )

            routing_meta = None
            if route_response.routes:
                primary = route_response.routes[0]
                routing_meta = RoutingMeta(
                    agent_id=primary.agent_id,
                    confidence=primary.confidence,
                    mode=RoutingMetaMode.auto,
                )
            _store.create_message(
                chat_id=chat_id,
                role=MessageRole.assistant,
                content=clarifying_text,
                routing_meta=routing_meta,
                artifacts=[],
                suggested_replies=list(route_response.clarifying_questions or []),
            )

            # If we have a best-guess route, persist it for UI history icons.
            if route_response.routes:
                best = route_response.routes[0].agent_id
                _store.set_routed_agent_id(chat_id, getattr(best, "value", str(best)))

            # Persist pending continuation so the next user message in this chat continues.
            # Even if routes=[] (pure clarification), we still have a chat_id now; the
            # next user message will re-route in the same chat (preserving history).
            if route_response.routes:
                pending = PendingContinuation(
                    agent_id=route_response.routes[0].agent_id,
                    original_query=req.query,
                    context_snapshot=req.context or {},
                )
                _store.set_pending_continuation(chat_id, pending)

        return RouterExecuteResponse(
            route_response=route_response,
            agent_response=agent_response,
            chat_id=ensured_chat_id,
        )

    def _augment_context_with_chat_memory(*, chat_id: str, base_context: dict) -> dict:
        try:
            msgs = _store.list_messages(chat_id)
        except KeyError:
            return base_context

        history = []
        for m in msgs[-20:]:
            created_at = getattr(m, "created_at", None)
            if isinstance(created_at, datetime):
                created_at = created_at.isoformat()
            history.append(
                {
                    "role": m.role,
                    "content": m.content,
                    "created_at": created_at,
                    "routing_meta": (
                        m.routing_meta.model_dump(mode="json")
                        if m.routing_meta
                        else None
                    ),
                }
            )

        # Prefer the most recent persisted artifacts, including planner state updates stored as
        # `system` messages.
        last_plan = None
        last_risks = None
        last_patch = None
        last_snippet = None
        last_notes = None

        for m in reversed(msgs):
            arts = getattr(m, "artifacts", None) or []
            if not arts:
                continue

            for a in arts:
                at = getattr(a, "type", None)

                if at == "project_plan" and last_plan is None:
                    last_plan = getattr(a, "plan", None)
                if at == "risks" and last_risks is None:
                    last_risks = getattr(a, "risks", None)

                # Codegen-style artifacts.
                if at == "patch" and last_patch is None:
                    last_patch = getattr(a, "patch", None)

                # NOTE: snippet is not currently part of shared backend contracts, but the UI reads it.
                # Keep enrichment resilient for forward/backward compatibility.
                if at == "snippet" and last_snippet is None:
                    last_snippet = getattr(a, "snippet", None)

                if at == "notes" and last_notes is None:
                    last_notes = getattr(a, "notes", None)

            if (
                last_plan is not None
                and last_risks is not None
                and last_patch is not None
                and (last_snippet is not None or last_notes is not None)
            ):
                break

        enriched = dict(base_context or {})
        enriched.setdefault("chat_history", history)
        if last_plan is not None:
            enriched.setdefault(
                "last_project_plan",
                getattr(last_plan, "model_dump", lambda **_: last_plan)(mode="json"),
            )
        if last_risks is not None:
            enriched.setdefault(
                "last_risks",
                list(last_risks) if isinstance(last_risks, list) else last_risks,
            )

        if last_patch is not None:
            enriched.setdefault("last_patch", last_patch)
        if last_snippet is not None:
            enriched.setdefault("last_snippet", last_snippet)
        if last_notes is not None:
            enriched.setdefault("last_notes", last_notes)

        return enriched

    # Routed successfully: invoke chosen agent.
    agent_response = None
    if route_response.routes:
        chosen = route_response.routes[0].agent_id

        ctx = req.context or {}
        chat_id_for_mem = ensured_chat_id or req.chat_id
        if chat_id_for_mem:
            ctx = _augment_context_with_chat_memory(
                chat_id=chat_id_for_mem, base_context=ctx
            )

        logger.info(
            "router.execute invoke agent=%s ctx_keys=%s last_patch_chars=%s last_snippet_chars=%s",
            chosen,
            sorted(list((ctx or {}).keys())),
            len(str((ctx or {}).get("last_patch") or "")),
            len(str((ctx or {}).get("last_snippet") or "")),
        )

        try:
            agent_response = invoke_agent(
                chosen,
                AgentInvokeRequest(agent_id=chosen, task=req.query, context=ctx),
            )
        except AgentInvokeError as e:
            if e.code == "not_found":
                raise HTTPException(status_code=404, detail=str(e)) from e
            if e.code in {"disabled", "bad_request", "agent_id_mismatch"}:
                raise HTTPException(status_code=400, detail=str(e)) from e
            raise HTTPException(status_code=500, detail=str(e)) from e

    if req.persist:
        # IMPORTANT: never create a new chat_id after ensured_chat_id was allocated.
        # Otherwise the client will continue on a different chat and lose the pending continuation.
        chat_id = ensured_chat_id or _ensure_chat_id_for_persist(
            chat_id=req.chat_id, query=req.query
        )

        # Persist user message (no routing_meta, artifacts=[])
        _store.create_message(
            chat_id=chat_id,
            role=MessageRole.user,
            content=req.query,
            routing_meta=None,
            artifacts=[],
        )

        # Agent-level clarification path: agent responded with questions.
        if (
            (agent_response is not None)
            and getattr(agent_response, "status", None)
            == AgentStatus.needs_clarification
            and route_response.routes
        ):
            primary = route_response.routes[0]

            # Persist chosen agent for UI history icons.
            _store.set_routed_agent_id(
                chat_id, getattr(primary.agent_id, "value", str(primary.agent_id))
            )

            clarifying_text = (
                "\n".join(agent_response.clarifying_questions)
                or "Please clarify your request."
            )
            _store.create_message(
                chat_id=chat_id,
                role=MessageRole.assistant,
                content=clarifying_text,
                routing_meta=RoutingMeta(
                    agent_id=primary.agent_id,
                    confidence=primary.confidence,
                    mode=RoutingMetaMode.auto,
                ),
                artifacts=agent_response.artifacts,
                suggested_replies=list(agent_response.clarifying_questions or []),
            )

            pending = PendingContinuation(
                agent_id=primary.agent_id,
                original_query=req.query,
                context_snapshot=req.context or {},
            )
            _store.set_pending_continuation(chat_id, pending)

            agent_route_response = RouterRouteResponse(
                routes=route_response.routes,
                needs_clarification=True,
                clarifying_questions=list(agent_response.clarifying_questions or []),
                routing_rationale="Agent requires clarification.",
            )
            return RouterExecuteResponse(
                route_response=agent_route_response,
                agent_response=agent_response,
                chat_id=chat_id,
            )

        # Persist assistant message only when we actually have an agent_response.
        if (agent_response is not None) and route_response.routes:
            primary = route_response.routes[0]

            # Persist chosen agent for UI history icons.
            _store.set_routed_agent_id(
                chat_id, getattr(primary.agent_id, "value", str(primary.agent_id))
            )
            routing_meta = RoutingMeta(
                agent_id=primary.agent_id,
                confidence=primary.confidence,
                mode=(
                    RoutingMetaMode.forced
                    if req.mode == RoutingMode.forced
                    else RoutingMetaMode.auto
                ),
            )
            summary = (
                f"Routed to {primary.agent_id} (confidence {primary.confidence:.2f})."
            )

            # Persist the agent's explanation when available; otherwise fall back to the routing summary.
            #
            # IMPORTANT:
            # - The codegen UI expects structured reporter headings in assistant message.content.
            # - The planner UI does NOT; it renders artifacts (plan/risks) in [`components/Workspace.tsx`](grand-router-ai/frontend/unified-ai-specialist/components/Workspace.tsx:2).
            #
            # Previously we wrapped *all* non-structured content into a codegen-style template
            # (KEY POINTS ACHIEVED / WHAT CHANGED / WHY / ...). That caused planner chats to show
            # confusing boilerplate in the sidebar (the user screenshot).
            raw_content = (
                "\n".join(agent_response.notes) if agent_response.notes else summary
            )

            if primary.agent_id == "planner":
                # Keep planner sidebar messages short and human.
                assistant_content = raw_content.strip() or "Generated a project plan."
            else:
                has_headings = any(
                    h in raw_content
                    for h in [
                        "KEY POINTS ACHIEVED",
                        "WHAT CHANGED (BY FILE)",
                        "WHY / ROOT CAUSE",
                        "DESIGN NOTES (SOLID / PATTERNS)",
                        "TEST SCENARIOS",
                    ]
                )

                if has_headings:
                    assistant_content = raw_content
                else:
                    assistant_content = "\n".join(
                        [
                            "KEY POINTS ACHIEVED",
                            raw_content.strip() or "Not applicable.",
                            "",
                            "WHAT CHANGED (BY FILE)",
                            "Not applicable.",
                            "",
                            "WHY / ROOT CAUSE",
                            "Not applicable.",
                            "",
                            "DESIGN NOTES (SOLID / PATTERNS)",
                            "Not applicable.",
                            "",
                            "TEST SCENARIOS",
                            "Not applicable.",
                        ]
                    )

            _store.create_message(
                chat_id=chat_id,
                role=MessageRole.assistant,
                content=assistant_content,
                routing_meta=routing_meta,
                artifacts=agent_response.artifacts,
            )

    return RouterExecuteResponse(
        route_response=route_response,
        agent_response=agent_response,
        chat_id=ensured_chat_id,
    )
