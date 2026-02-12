from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ....llm.client import generate

from .utils import ExecutionProfile, read_prompt, safe_json_dumps


@dataclass(frozen=True)
class SnippetResult:
    code: str


def run_snippet(
    *,
    task: str,
    context: dict[str, Any],
    profile: ExecutionProfile,
    plan: list[str],
    assumptions: list[str],
) -> SnippetResult:
    system = read_prompt("snippet.md")

    payload = {
        "task": task,
        "profile": {"language": profile.language, "framework": profile.framework},
        "constraints": context.get("constraints") or [],
        "assumptions": assumptions,
        "plan": plan,
        "goal": context.get("goal"),
    }

    raw = generate(
        system, "STEP: snippet\n" + safe_json_dumps(payload), temperature=0.0
    )

    # IMPORTANT: snippet mode returns raw code snippets, not a unified diff.
    return SnippetResult(code=(raw or "").strip() + "\n")
