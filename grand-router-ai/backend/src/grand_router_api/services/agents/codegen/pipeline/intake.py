from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ....llm.client import generate

from .utils import (
    ExecutionProfile,
    detect_profile,
    parse_json,
    read_prompt,
    safe_json_dumps,
)


_ALLOWED_LANGUAGES = {"python", "java", "javascript", "typescript", "csharp"}
_ALLOWED_FRAMEWORKS = {"", "fastapi", "spring", "react", "express", "aspnet"}


@dataclass(frozen=True)
class IntakeResult:
    needs_clarification: bool
    questions: list[str]
    assumptions: list[str]
    profile: ExecutionProfile
    goal: str
    verification_steps: list[str]


def _infer_goal(*, task: str, context: dict[str, Any]) -> str:
    explicit = str(context.get("goal") or "").strip().lower()
    if explicit in {"feature", "bugfix", "refactor"}:
        return explicit

    t = (task or "").lower()
    if context.get("error_logs"):
        return "bugfix"
    if any(
        k in t for k in ["fix", "bug", "error", "exception", "stack trace", "traceback"]
    ):
        return "bugfix"
    if any(k in t for k in ["refactor", "cleanup", "clean up", "optimize"]):
        return "refactor"
    return "feature"


def _clean_list(xs: Any, *, max_items: int | None = None) -> list[str]:
    out: list[str] = []
    for x in xs or []:
        s = str(x).strip()
        if not s:
            continue
        out.append(s)
        if max_items is not None and len(out) >= max_items:
            break
    return out


def run_intake(*, task: str, context: dict[str, Any]) -> IntakeResult:
    system = read_prompt("intake.md")

    user = {
        "task": task,
        "context": context,
    }

    raw = generate(system, "STEP: intake\n" + safe_json_dumps(user))
    data = parse_json(raw)

    profile = detect_profile(context=context, task=task)

    # Fail-safe behavior: if intake output is unparsable, request clarification.
    if not data:
        inferred_goal = _infer_goal(task=task, context=context)
        return IntakeResult(
            needs_clarification=True,
            questions=[
                "Please provide the relevant file(s) as context.files (path + content), or a minimal reproduction.",
                "What language/framework should I target (python/java/javascript/typescript/csharp; fastapi/spring/react/express/aspnet)?",
            ],
            assumptions=[],
            profile=profile,
            goal=inferred_goal,
            verification_steps=[],
        )

    if isinstance(data.get("profile"), dict):
        lang = str(data["profile"].get("language") or "").strip().lower()
        fw = str(data["profile"].get("framework") or "").strip().lower()
        if lang in _ALLOWED_LANGUAGES:
            profile = ExecutionProfile(language=lang, framework=profile.framework)
        if fw in _ALLOWED_FRAMEWORKS:
            profile = ExecutionProfile(language=profile.language, framework=fw)

    needs = bool(data.get("needs_clarification") or False)
    questions = _clean_list(data.get("questions"), max_items=3)
    assumptions = _clean_list(data.get("assumptions"))

    if not needs:
        questions = []

    if needs and not questions:
        questions = _clean_list(
            [
                "Please provide the relevant file(s) as context.files (path + content).",
                "If applicable, provide the full error log / stack trace in context.error_logs.",
            ],
            max_items=3,
        )

    goal = str(data.get("goal") or "").strip().lower()
    if goal not in {"feature", "bugfix", "refactor"}:
        goal = _infer_goal(task=task, context=context)

    ver_steps = _clean_list(data.get("verification_steps"))

    return IntakeResult(
        needs_clarification=needs,
        questions=questions,
        assumptions=assumptions,
        profile=profile,
        goal=goal,
        verification_steps=ver_steps,
    )
