"""CodeChat agent.

Goal:
- Provide threaded Q&A about the current code/patch context.
- Avoid triggering the full codegen pipeline.

This agent is intended for direct invocation (typically forced routing).
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


def _truncate(s: str, *, max_chars: int) -> str:
    s2 = (s or "").strip()
    if len(s2) <= max_chars:
        return s2
    return s2[: max_chars - 2000].rstrip() + "\n\n...<truncated>...\n\n" + s2[-2000:]


def _infer_code_context_from_history(history: list[dict[str, Any]]) -> tuple[str, str]:
    """Best-effort extraction of code-ish context from chat_history.

    Returns (patch_like, snippet_like).
    """

    patch_like = ""
    snippet_like = ""

    for m in reversed(history or []):
        try:
            role = str(m.get("role") or "")
            content = str(m.get("content") or "")
        except Exception:
            continue

        if role != "assistant":
            continue

        c = (content or "").strip()
        if not c:
            continue

        # Diff-like content.
        if ("diff --git" in c) or ("@@" in c and "+++" in c):
            patch_like = c
            break

        # File-block style snippets.
        if "// File:" in c:
            snippet_like = c
            break

        # Markdown fenced code blocks.
        if "```" in c:
            snippet_like = c
            break

    return patch_like, snippet_like


class CodeChatAgent(BaseAgent):
    agent_id: AgentId = AgentId.codechat

    def invoke(self, request: AgentInvokeRequest) -> AgentInvokeResponse:
        question = (request.task or "").strip()
        if not question:
            return AgentInvokeResponse(
                agent_id=self.agent_id,
                status=AgentStatus.needs_clarification,
                artifacts=[],
                notes=["- Missing question."],
                clarifying_questions=["What do you want to know about the code?"],
            )

        ctx: dict[str, Any] = request.context or {}
        last_patch = str(ctx.get("last_patch") or "")
        last_snippet = str(ctx.get("last_snippet") or "")
        files = ctx.get("files") or []
        history = ctx.get("chat_history") or []

        if (not last_patch.strip()) and (not last_snippet.strip()) and history:
            inferred_patch, inferred_snippet = _infer_code_context_from_history(history)
            if inferred_patch:
                last_patch = inferred_patch
            if inferred_snippet:
                last_snippet = inferred_snippet

        # If the user explicitly refers to code but we still have no code context, ask for it.
        ql = question.lower()
        refers_to_code = any(
            x in ql
            for x in {
                "this code",
                "this patch",
                "this diff",
                "this function",
                "read_and_filter",
                "main.py",
            }
        )
        has_any_code = bool(last_patch.strip() or last_snippet.strip() or files)
        if refers_to_code and not has_any_code:
            return AgentInvokeResponse(
                agent_id=self.agent_id,
                status=AgentStatus.needs_clarification,
                artifacts=[],
                notes=[
                    "I can explain it, but I don't have the code for this chat in context.",
                ],
                clarifying_questions=[
                    "Paste `read_and_filter` (or main.py) and I will walk through it line-by-line.",
                ],
            )

        payload = {
            "question": question,
            "last_patch": _truncate(last_patch, max_chars=24_000),
            "last_snippet": _truncate(last_snippet, max_chars=16_000),
            "files": files[:8],
            "chat_history": history[-12:],
        }

        system = _read_prompt("answer.md")
        user = "STEP: codechat.answer\n" + json.dumps(payload, ensure_ascii=False)
        out = generate(system, user, temperature=0.2)
        answer = (out or "").strip()
        if not answer:
            answer = "I couldn't generate an answer. Paste the function body and I'll explain it step-by-step."

        return AgentInvokeResponse(
            agent_id=self.agent_id,
            status=AgentStatus.ok,
            artifacts=[],
            notes=[answer],
            clarifying_questions=[],
        )
