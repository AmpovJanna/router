"""Agent invocation endpoint (v1).

This endpoint intentionally bypasses routing and invokes a specific agent.

Phase 6+ planner sidebar requirement:
- allow continuing an existing planner chat without re-routing
- keep `chat_id` stable
- when `chat_id` is provided, enrich agent context with chat memory (history + latest plan/risks artifacts)
- optionally persist user/assistant messages into the same chat store
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from grand_router_contracts.agent import (
    AgentId,
    AgentInvokeRequest,
    AgentInvokeResponse,
)
from grand_router_contracts.chat import MessageRole, RoutingMeta, RoutingMetaMode

from ...services.agents.runner import AgentInvokeError, invoke_agent
from ...services.persistence.file_store import FileChatStore
from ...services.routing.qna_intent import detect_lightweight_qna

router = APIRouter(prefix="/agents", tags=["agents"])

_store = FileChatStore()


class AgentInvokeDirectRequest(AgentInvokeRequest):
    """Extended invoke request for direct agent calls with optional persistence.

    Note: We intentionally keep `/router/execute` behavior unchanged.
    """

    chat_id: str | None = Field(default=None, description="Existing chat to append to.")
    persist: bool = Field(
        default=False, description="If true, append user+assistant messages."
    )


def _augment_context_with_chat_memory(*, chat_id: str, base_context: dict) -> dict:
    """Attach minimal chat memory to context.

    Used by direct agent calls (`/agents/{agent_id}/invoke`) to:
    - keep follow-ups in the same chat without re-routing
    - provide the agent with recent conversation context (`chat_history`)
    - provide the agent with the most recent relevant artifacts (planner + codegen)

    Notes:
    - Planner artifacts may be stored on `system` messages.
    - Codegen artifacts are typically on assistant messages.
    """

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
                    m.routing_meta.model_dump(mode="json") if m.routing_meta else None
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

            # Codegen-style artifacts
            if at == "patch" and last_patch is None:
                last_patch = getattr(a, "patch", None)

            # NOTE: snippet is not currently part of shared contracts, but the UI reads it.
            # Keep enrichment resilient for forward/backward compatibility.
            if at == "snippet" and last_snippet is None:
                last_snippet = getattr(a, "snippet", None)

            # Freeform notes artifact (if present in future contracts)
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


@router.post("/{agent_id}/invoke", response_model=AgentInvokeResponse)
def invoke_agent_endpoint(
    agent_id: AgentId, request: AgentInvokeDirectRequest
) -> AgentInvokeResponse:
    try:
        # Enrich context from chat memory when continuing an existing chat.
        ctx = request.context or {}
        if request.chat_id:
            ctx = _augment_context_with_chat_memory(
                chat_id=request.chat_id, base_context=ctx
            )

        # Lightweight Q&A guard:
        # If the UI forces codegen, but the user is asking a simple question (e.g. "what is JSON"),
        # answer directly instead of triggering the full codegen pipeline.
        effective_agent_id = agent_id
        if agent_id == AgentId.codegen:
            intent = detect_lightweight_qna(task=str(request.task or ""), context=ctx)
            if intent.is_qna and intent.confidence >= 0.75:
                effective_agent_id = AgentId.chatwriter

        agent_response = invoke_agent(
            effective_agent_id,
            AgentInvokeRequest(
                agent_id=effective_agent_id,
                task=request.task,
                context=ctx,
                output_format=request.output_format,
            ),
        )

        # Optional persistence (append messages into existing chat).
        if request.persist and request.chat_id:
            # Validate chat exists
            _store.get_chat(request.chat_id)

            _store.create_message(
                chat_id=request.chat_id,
                role=MessageRole.user,
                content=request.task,
                routing_meta=None,
                artifacts=[],
            )
            assistant_content = (
                "\n".join(agent_response.notes)
                if agent_response.notes
                else "(no notes)"
            )
            _store.create_message(
                chat_id=request.chat_id,
                role=MessageRole.assistant,
                content=assistant_content,
                routing_meta=RoutingMeta(
                    agent_id=effective_agent_id,
                    confidence=1.0,
                    mode=RoutingMetaMode.forced,
                ),
                artifacts=agent_response.artifacts,
            )

        return agent_response
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except AgentInvokeError as e:
        if e.code == "not_found":
            raise HTTPException(status_code=404, detail=str(e)) from e
        if e.code in {"disabled", "bad_request", "agent_id_mismatch"}:
            raise HTTPException(status_code=400, detail=str(e)) from e
        raise HTTPException(status_code=500, detail=str(e)) from e
