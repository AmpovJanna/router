from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class QnaIntent:
    is_qna: bool
    confidence: float
    reason: str


_QNA_STARTERS = (
    "what is ",
    "what's ",
    "whats ",
    "explain ",
    "define ",
    "meaning of ",
    "how does ",
    "why does ",
    "difference between ",
    "compare ",
)


def detect_lightweight_qna(*, task: str, context: dict | None = None) -> QnaIntent:
    """Heuristic to detect lightweight Q&A.

    Goal: high precision (avoid stealing real codegen/planner requests).

    We consider Q&A only when:
    - the text looks like a question/explanation request, AND
    - there are no strong code/planning action signals, AND
    - the request is short/simple.
    """

    q = (task or "").strip().lower()
    if not q:
        return QnaIntent(is_qna=False, confidence=0.0, reason="empty")

    # If the UI injected code/planning context, assume it's not lightweight Q&A.
    ctx = context or {}
    if any(k in ctx for k in ("files", "goal", "diff", "patch", "selected_text")):
        return QnaIntent(is_qna=False, confidence=0.1, reason="has_code_context")

    # Strong signals that the user wants code changes/debugging.
    code_signals = (
        "stack trace",
        "traceback",
        "exception",
        "error",
        "bug",
        "debug",
        "fix",
        "refactor",
        "patch",
        "unit test",
        "failing test",
        "compile",
        "build",
        ".py",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        "diff",
        "pr",
        "commit",
        "file ",
        "function",
        "class ",
        "/api",
        "endpoint",
    )
    if any(s in q for s in code_signals):
        return QnaIntent(is_qna=False, confidence=0.05, reason="code_signal")

    plan_signals = (
        "project plan",
        "execution plan",
        "mvp plan",
        "roadmap",
        "timeline",
        "milestone",
        "requirements",
        "dependencies",
    )
    if any(s in q for s in plan_signals):
        return QnaIntent(is_qna=False, confidence=0.05, reason="plan_signal")

    is_question = q.endswith("?") or q.startswith(_QNA_STARTERS)
    if not is_question:
        return QnaIntent(is_qna=False, confidence=0.2, reason="not_question")

    # Keep it short; long text tends to be tasking.
    word_count = len([w for w in q.split() if w])
    if word_count > 18:
        return QnaIntent(is_qna=False, confidence=0.4, reason="too_long")

    return QnaIntent(is_qna=True, confidence=0.85, reason="lightweight_qna")
