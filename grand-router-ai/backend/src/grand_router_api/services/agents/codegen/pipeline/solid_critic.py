from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ....llm.client import generate

from .utils import (
    ExecutionProfile,
    parse_json,
    read_prompt,
    safe_json_dumps,
    safe_truncate,
)


@dataclass(frozen=True)
class SolidCriticResult:
    solid: list[str]
    pattern_justification: list[str]
    issues: list[str]
    recommended_changes: list[str]


def run_solid_critic(
    *,
    task: str,
    context: dict[str, Any],
    profile: ExecutionProfile,
    patch: str,
    plan: list[str],
) -> SolidCriticResult:
    system = read_prompt("solid.md")

    payload = {
        "task": task,
        "profile": {"language": profile.language, "framework": profile.framework},
        "constraints": context.get("constraints") or [],
        "plan": plan,
        "patch": safe_truncate(patch, max_chars=30_000),
        "goal": context.get("goal"),
    }

    raw = generate(system, "STEP: solid\n" + safe_json_dumps(payload), temperature=0.0)
    data = parse_json(raw)

    if not data:
        return SolidCriticResult(
            solid=[],
            pattern_justification=[],
            issues=["SOLID critic step failed to return valid JSON."],
            recommended_changes=[],
        )

    def _clean(xs: Any) -> list[str]:
        return [str(x).strip() for x in (xs or []) if str(x).strip()]

    issues = _clean(data.get("issues"))
    if not patch.strip():
        issues.append(
            "Patch is empty or not a valid unified diff; SOLID critique may be incomplete."
        )

    return SolidCriticResult(
        solid=_clean(data.get("solid")),
        pattern_justification=_clean(data.get("pattern_justification")),
        issues=issues,
        recommended_changes=_clean(data.get("recommended_changes")),
    )
