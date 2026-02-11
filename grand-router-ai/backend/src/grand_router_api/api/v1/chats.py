"""Chat persistence endpoints (v1).

Endpoints:
- POST `/api/v1/chats` create a new chat
- GET `/api/v1/chats` list chats
- GET `/api/v1/chats/{chat_id}` get chat + messages
- POST `/api/v1/chats/{chat_id}/messages` append message

Storage is via the persistence port implemented by
[`FileChatStore`](grand-router-ai/backend/src/grand_router_api/services/persistence/file_store.py:1).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from grand_router_contracts.api_version import API_VERSION
from grand_router_contracts.agent import AgentId
from grand_router_contracts.artifacts import (
    Artifact,
    ProjectPlan,
    ProjectPlanArtifact,
    RisksArtifact,
)
from grand_router_contracts.chat import (
    Chat,
    Message,
    MessageRole,
    RoutingMeta,
    RoutingMetaMode,
)

from ...services.persistence.file_store import FileChatStore

router = APIRouter(prefix="/chats", tags=["chats"])

_store = FileChatStore()


class CreateChatRequest(BaseModel):
    title: str = Field(..., min_length=1)


class CreateChatResponse(BaseModel):
    api_version: str = Field(default=API_VERSION)
    chat: Chat


class ListChatsResponse(BaseModel):
    api_version: str = Field(default=API_VERSION)
    chats: list[Chat] = Field(default_factory=list)


class GetChatResponse(BaseModel):
    api_version: str = Field(default=API_VERSION)
    chat: Chat
    messages: list[Message] = Field(default_factory=list)


class AppendMessageRequest(BaseModel):
    role: MessageRole
    content: str = Field(..., min_length=1)
    routing_meta: RoutingMeta | None = None
    artifacts: list[Artifact] = Field(default_factory=list)


class AppendMessageResponse(BaseModel):
    api_version: str = Field(default=API_VERSION)
    message: Message


class UpdatePlannerPlanRequest(BaseModel):
    plan: ProjectPlan
    risks: list[str] | None = None
    note: str | None = None


@router.post("", response_model=CreateChatResponse)
def create_chat(req: CreateChatRequest) -> CreateChatResponse:
    chat = _store.create_chat(req.title)
    return CreateChatResponse(chat=chat)


@router.get("", response_model=ListChatsResponse)
def list_chats() -> ListChatsResponse:
    return ListChatsResponse(chats=_store.list_chats())


@router.get("/{chat_id}", response_model=GetChatResponse)
def get_chat(chat_id: str) -> GetChatResponse:
    try:
        chat = _store.get_chat(chat_id)
        messages = _store.list_messages(chat_id)
        return GetChatResponse(chat=chat, messages=messages)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"chat not found: {chat_id}")


@router.delete("/{chat_id}")
def delete_chat(chat_id: str) -> Response:
    try:
        _store.delete_chat(chat_id)
        return Response(status_code=204)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"chat not found: {chat_id}")


@router.post("/{chat_id}/messages", response_model=AppendMessageResponse)
def append_message(chat_id: str, req: AppendMessageRequest) -> AppendMessageResponse:
    try:
        msg = _store.create_message(
            chat_id=chat_id,
            role=req.role,
            content=req.content,
            routing_meta=req.routing_meta,
            artifacts=req.artifacts,
        )
        return AppendMessageResponse(message=msg)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"chat not found: {chat_id}")


@router.post("/{chat_id}/planner/plan", response_model=AppendMessageResponse)
def update_planner_plan(
    chat_id: str, req: UpdatePlannerPlanRequest
) -> AppendMessageResponse:
    """Persist planner board/roadmap changes without polluting the visible chat.

    We append a `system` message containing the updated `project_plan` artifact.
    The Planner UI loads the most recent `project_plan` artifact regardless of role,
    while the chat stream renders only user/assistant messages.
    """

    try:
        artifacts: list[Artifact] = [ProjectPlanArtifact(plan=req.plan)]
        if req.risks is not None:
            artifacts.append(RisksArtifact(risks=req.risks))

        msg = _store.create_message(
            chat_id=chat_id,
            role=MessageRole.system,
            content="",
            routing_meta=RoutingMeta(
                agent_id=AgentId.planner,
                confidence=1.0,
                mode=RoutingMetaMode.forced,
            ),
            artifacts=artifacts,
        )
        return AppendMessageResponse(message=msg)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"chat not found: {chat_id}")
