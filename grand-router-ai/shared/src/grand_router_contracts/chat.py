"""Chat contracts.

Simple models for chats and messages, including routing metadata stored on assistant replies.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

from .agent import AgentId
from .artifacts import Artifact


class MessageRole(str, Enum):
    user = "user"
    assistant = "assistant"
    system = "system"


class RoutingMetaMode(str, Enum):
    auto = "auto"
    forced = "forced"


class RoutingMeta(BaseModel):
    agent_id: AgentId
    confidence: float = Field(..., ge=0.0, le=1.0)
    mode: RoutingMetaMode = RoutingMetaMode.auto


class PendingContinuation(BaseModel):
    """Chat-level state used to auto-continue after clarification.

    When the router cannot confidently route a task (needs_clarification=True), we persist
    the selected/anticipated agent_id plus the original query and a context snapshot.

    The next user message in the same chat is treated as the clarification answer and
    re-invokes the pending agent with a combined task.
    """

    agent_id: AgentId
    original_query: str
    context_snapshot: dict = Field(default_factory=dict)


class Chat(BaseModel):
    chat_id: str
    title: str
    created_at: datetime
    updated_at: datetime
    # Optional: persisted routing signal for UI (history icons, last mode).
    routed_agent_id: AgentId | None = None
    pending_continuation: PendingContinuation | None = None


class Message(BaseModel):
    message_id: str
    chat_id: str
    role: MessageRole
    content: str
    created_at: datetime
    routing_meta: RoutingMeta | None = None
    artifacts: list[Artifact] = Field(default_factory=list)
    # Optional UI hints: quick-reply suggestions for clarification flows.
    suggested_replies: list[str] | None = None
