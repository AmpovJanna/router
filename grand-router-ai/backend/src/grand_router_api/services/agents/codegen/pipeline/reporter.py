from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ....llm.client import generate

from .utils import ExecutionProfile, read_prompt, safe_json_dumps, safe_truncate


@dataclass(frozen=True)
class ReportResult:
    notes: list[str]


def run_report(
    *,
    task: str,
    context: dict[str, Any],
    profile: ExecutionProfile,
    plan: dict[str, Any],
    review: dict[str, Any],
    solid: dict[str, Any],
    final_patch: str,
    verification_steps: list[str],
) -> ReportResult:
    system = read_prompt("report.md")

    payload = {
        "task": task,
        "profile": {"language": profile.language, "framework": profile.framework},
        "plan": plan,
        "review": review,
        "solid": solid,
        "verification_steps": verification_steps,
        "patch": safe_truncate(final_patch, max_chars=30_000),
    }

    raw = generate(system, "STEP: report\n" + safe_json_dumps(payload), temperature=0.0)

    # Preserve reporter headings/paragraphs exactly as plain text.
    # Only remove empty lines.
    lines = [ln.rstrip() for ln in (raw or "").splitlines() if ln.strip()]
    return ReportResult(notes=lines)
