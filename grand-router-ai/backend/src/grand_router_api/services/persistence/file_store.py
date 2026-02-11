"""File-based [`ChatStore`](grand-router-ai/backend/src/grand_router_api/services/persistence/interface.py:1).

Storage format (Phase 4):
- Single JSON file at `backend/data/store.json` (default).

Why single-file?
- Minimal implementation (no DB), easy to inspect/edit.
- Sufficient for small demos; can be swapped for a DB later via the interface.

Write strategy:
- Read-modify-write with an "atomic-ish" replace: write to a temp file then
  `os.replace()` onto the target path (works on Windows).

Config:
- If env var `GRAND_ROUTER_STORE_PATH` is set, it is used as the store path.

Notes:
- No concurrency guarantees (no locking).
"""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from grand_router_contracts.artifacts import Artifact
from grand_router_contracts.chat import Chat, Message, MessageRole, PendingContinuation, RoutingMeta

from .interface import ChatStore


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _find_backend_root(start: Path) -> Path:
    """Find the `backend/` directory by walking upward looking for pyproject.toml."""
    cur = start
    for _ in range(10):
        if (cur / "pyproject.toml").exists():
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    return start.resolve().parents[4]


@dataclass
class _StoreDoc:
    chats: dict[str, dict[str, Any]]
    messages_by_chat: dict[str, list[dict[str, Any]]]


class FileChatStore(ChatStore):
    def __init__(self, store_path: str | Path | None = None) -> None:
        if store_path is None:
            env_path = os.environ.get("GRAND_ROUTER_STORE_PATH")
            if env_path:
                store_path = env_path
            else:
                backend_root = _find_backend_root(Path(__file__).resolve())
                store_path = backend_root / "data" / "store.json"

        self._path = Path(store_path)

    def create_chat(self, title: str) -> Chat:
        doc = self._load()

        chat_id = uuid.uuid4().hex
        now = _utc_now()
        chat = Chat(chat_id=chat_id, title=title, created_at=now, updated_at=now)

        doc.chats[chat_id] = chat.model_dump(mode="json")
        doc.messages_by_chat.setdefault(chat_id, [])
        self._save(doc)
        return chat

    def list_chats(self) -> list[Chat]:
        doc = self._load()
        chats = [Chat.model_validate(v) for v in doc.chats.values()]
        chats.sort(key=lambda c: c.updated_at, reverse=True)
        return chats

    def get_chat(self, chat_id: str) -> Chat:
        doc = self._load()
        raw = doc.chats.get(chat_id)
        if raw is None:
            raise KeyError(chat_id)
        return Chat.model_validate(raw)

    def delete_chat(self, chat_id: str) -> None:
        doc = self._load()
        if chat_id not in doc.chats:
            raise KeyError(chat_id)
        doc.chats.pop(chat_id, None)
        doc.messages_by_chat.pop(chat_id, None)
        self._save(doc)

    def set_pending_continuation(
        self, chat_id: str, pending: PendingContinuation | None
    ) -> Chat:
        doc = self._load()
        raw = doc.chats.get(chat_id)
        if raw is None:
            raise KeyError(chat_id)

        chat = Chat.model_validate(raw)
        chat = chat.model_copy(update={"pending_continuation": pending, "updated_at": _utc_now()})
        doc.chats[chat_id] = chat.model_dump(mode="json")
        self._save(doc)
        return chat

    def list_messages(self, chat_id: str) -> list[Message]:
        doc = self._load()
        if chat_id not in doc.chats:
            raise KeyError(chat_id)
        return [Message.model_validate(m) for m in doc.messages_by_chat.get(chat_id, [])]

    def append_message(self, message: Message) -> Message:
        doc = self._load()
        if message.chat_id not in doc.chats:
            raise KeyError(message.chat_id)

        doc.messages_by_chat.setdefault(message.chat_id, []).append(
            message.model_dump(mode="json")
        )

        chat = Chat.model_validate(doc.chats[message.chat_id])
        chat = chat.model_copy(update={"updated_at": _utc_now()})
        doc.chats[message.chat_id] = chat.model_dump(mode="json")

        self._save(doc)
        return message

    def create_message(
        self,
        chat_id: str,
        role: MessageRole,
        content: str,
        *,
        routing_meta: RoutingMeta | None = None,
        artifacts: list[Artifact] | None = None,
        suggested_replies: list[str] | None = None,
    ) -> Message:
        msg = Message(
            message_id=uuid.uuid4().hex,
            chat_id=chat_id,
            role=role,
            content=content,
            created_at=_utc_now(),
            routing_meta=routing_meta,
            artifacts=artifacts or [],
            suggested_replies=suggested_replies,
        )
        return self.append_message(msg)

    def _load(self) -> _StoreDoc:
        if not self._path.exists():
            return _StoreDoc(chats={}, messages_by_chat={})

        text = self._path.read_text(encoding="utf-8")
        if not text.strip():
            return _StoreDoc(chats={}, messages_by_chat={})

        data = json.loads(text)
        return _StoreDoc(
            chats=dict(data.get("chats", {})),
            messages_by_chat=dict(data.get("messages_by_chat", {})),
        )

    def _save(self, doc: _StoreDoc) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)

        payload = {
            "chats": doc.chats,
            "messages_by_chat": doc.messages_by_chat,
        }

        tmp_path = self._path.with_suffix(self._path.suffix + ".tmp")
        tmp_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        os.replace(tmp_path, self._path)
