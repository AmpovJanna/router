from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ....llm.client import generate

from .utils import (
    ExecutionProfile,
    files_payload,
    parse_json,
    read_prompt,
    safe_json_dumps,
    safe_truncate,
)


@dataclass(frozen=True)
class ReviewResult:
    findings: list[str]
    edge_cases: list[str]
    improvements: list[str]
    must_fix: list[str]


def run_review(
    *,
    task: str,
    context: dict[str, Any],
    profile: ExecutionProfile,
    patch: str,
) -> ReviewResult:
    system = read_prompt("review.md")

    payload = {
        "task": task,
        "profile": {"language": profile.language, "framework": profile.framework},
        "constraints": context.get("constraints") or [],
        "files": files_payload(context.get("files")),
        "error_logs": safe_truncate(
            str(context.get("error_logs") or ""), max_chars=12_000
        ),
        "patch": safe_truncate(patch, max_chars=30_000),
        "goal": context.get("goal"),
    }

    raw = generate(system, "STEP: review\n" + safe_json_dumps(payload), temperature=0.0)
    data = parse_json(raw)

    if not data:
        return ReviewResult(
            findings=[],
            edge_cases=[],
            improvements=[],
            must_fix=["Review step failed to return valid JSON."],
        )

    def _clean(xs: Any) -> list[str]:
        return [str(x).strip() for x in (xs or []) if str(x).strip()]

    must_fix = _clean(data.get("must_fix"))
    if not patch.strip():
        must_fix.append("Patch is empty or not a valid unified diff.")

    return ReviewResult(
        findings=_clean(data.get("findings")),
        edge_cases=_clean(data.get("edge_cases")),
        improvements=_clean(data.get("improvements")),
        must_fix=must_fix,
    )
