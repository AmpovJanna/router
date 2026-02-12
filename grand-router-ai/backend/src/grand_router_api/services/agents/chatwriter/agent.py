"""ChatWriter agent.

Historically:
- This agent rewrites an existing planner/codegen response for the left chat sidebar.

Now:
- If `context.original_message` is provided, it performs a rewrite (existing behavior).
- Otherwise, it acts as a lightweight Q&A agent to provide a direct answer without triggering
  the codegen pipeline.

This agent is intended to be invoked directly by the frontend (not via the router).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from grand_router_contracts.agent import (
    AgentId,
    AgentInvokeRequest,
    AgentInvokeResponse,
    AgentStatus,
)

from ...llm.client import generate
from ..base import BaseAgent


def _read_prompt(name: str) -> str:
    return (Path(__file__).with_name("prompts") / name).read_text(encoding="utf-8")


class ChatWriterAgent(BaseAgent):
    agent_id: AgentId = AgentId.chatwriter

    def invoke(self, request: AgentInvokeRequest) -> AgentInvokeResponse:
        ctx: dict[str, Any] = request.context or {}

        # Mode 1: rewrite an existing assistant message.
        original = str(ctx.get("original_message") or "").strip()
        if original:
            payload = {
                "user_task": str(request.task or "").strip(),
                "routed_label": str(ctx.get("routed_label") or "").strip(),
                "original_message": original,
                "original_agent_id": str(ctx.get("original_agent_id") or "").strip(),
            }

            system = _read_prompt("rewrite.md")
            user = "STEP: chatwriter.rewrite\n" + json.dumps(payload, ensure_ascii=False)

            out = generate(system, user, temperature=0.2)
            rewritten = (out or "").strip() or original

            return AgentInvokeResponse(
                agent_id=self.agent_id,
                status=AgentStatus.ok,
                artifacts=[],
                notes=[rewritten],
                clarifying_questions=[],
            )

        # Mode 2: lightweight Q&A.
        question = str(request.task or "").strip()
        if not question:
            return AgentInvokeResponse(
                agent_id=self.agent_id,
                status=AgentStatus.needs_clarification,
                artifacts=[],
                notes=["- Missing request.task."],
                clarifying_questions=["What would you like to know?"],
            )

        # Provide lightweight chat context if available.
        # NOTE: this is appended as plain text to keep the LLM client interface unchanged.
        history = ctx.get("chat_history")
        history_text = ""
        if isinstance(history, list) and history:
            # Keep short to avoid token bloat.
            lines: list[str] = []
            for m in history[-10:]:
                if not isinstance(m, dict):
                    continue
                role = str(m.get("role") or "").strip() or "unknown"
                content = str(m.get("content") or "").strip()
                if not content:
                    continue
                lines.append(f"{role}: {content}")
            if lines:
                history_text = "\n\nCHAT HISTORY (most recent last):\n" + "\n".join(lines)

        system = (
            "You are a helpful assistant. Answer the user's question directly and concisely. "
            "Use the provided chat history when relevant. "
            "If the user is actually asking for code changes or a patch, ask a single clarifying question."
        )
        user = "STEP: chatwriter.qna\n" + question + history_text

        out = generate(system, user, temperature=0.3)
        answer = (out or "").strip()
        if not answer:
            answer = "I couldn't generate an answer. Could you rephrase your question?"

        return AgentInvokeResponse(
            agent_id=self.agent_id,
            status=AgentStatus.ok,
            artifacts=[],
            notes=[answer],
            clarifying_questions=[],
        )
