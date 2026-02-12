from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ....llm.client import generate

from .utils import (
    ExecutionProfile,
    ensure_unified_diff,
    read_prompt,
    safe_json_dumps,
    safe_truncate,
)


@dataclass(frozen=True)
class ReviseResult:
    patch: str


def run_revise(
    *,
    task: str,
    context: dict[str, Any],
    profile: ExecutionProfile,
    patch: str,
    review: dict[str, Any],
    solid: dict[str, Any],
) -> ReviseResult:
    system = read_prompt("revise.md")

    payload = {
        "task": task,
        "profile": {"language": profile.language, "framework": profile.framework},
        "constraints": context.get("constraints") or [],
        "patch": safe_truncate(patch, max_chars=30_000),
        "review": review,
        "solid": solid,
        "goal": context.get("goal"),
    }

    raw = generate(system, "STEP: revise\n" + safe_json_dumps(payload), temperature=0.0)
    revised = ensure_unified_diff(raw)
    if not revised:
        revised = patch
    return ReviseResult(patch=revised)
