"""Persistence interface for chats/messages.

Phase 4 persistence is intentionally small and file-backed.

Error behavior (recommended):
- [`ChatStore.get_chat()`](grand-router-ai/backend/src/grand_router_api/services/persistence/interface.py:1) raises `KeyError` if the chat does not exist.
- [`ChatStore.list_messages()`](grand-router-ai/backend/src/grand_router_api/services/persistence/interface.py:1) raises `KeyError` if the chat does not exist.

The interface includes both:
- `append_message(message: Message)` for callers that construct full `Message` objects
- `create_message(...)` convenience so the store owns ID + timestamp generation
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from grand_router_contracts.artifacts import Artifact
from grand_router_contracts.chat import Chat, Message, MessageRole, PendingContinuation, RoutingMeta


class ChatStore(ABC):
    """Port for chat persistence."""

    @abstractmethod
    def create_chat(self, title: str) -> Chat:
        """Create a chat."""

    @abstractmethod
    def list_chats(self) -> list[Chat]:
        """List chats."""

    @abstractmethod
    def get_chat(self, chat_id: str) -> Chat:
        """Get a chat by id.

        Raises:
            KeyError: if chat does not exist.
        """

    @abstractmethod
    def list_messages(self, chat_id: str) -> list[Message]:
        """List messages for a chat.

        Raises:
            KeyError: if chat does not exist.
        """

    @abstractmethod
    def append_message(self, message: Message) -> Message:
        """Append a message (assumes message_id/created_at already set)."""

    @abstractmethod
    def create_message(
        self,
        chat_id: str,
        role: MessageRole,
        content: str,
        *,
        routing_meta: RoutingMeta | None = None,
        artifacts: list[Artifact] | None = None,
    ) -> Message:
        """Convenience: create + append a message with store-owned ID/timestamp."""

    @abstractmethod
    def delete_chat(self, chat_id: str) -> None:
        """Delete a chat and its messages.

        Raises:
            KeyError: if chat does not exist.
        """

    @abstractmethod
    def set_pending_continuation(
        self, chat_id: str, pending: PendingContinuation | None
    ) -> Chat:
        """Set or clear a chat's pending continuation state.

        Raises:
            KeyError: if chat does not exist.
        """
