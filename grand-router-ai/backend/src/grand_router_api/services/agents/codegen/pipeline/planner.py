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
class PlanResult:
    plan: list[str]
    files_to_touch: list[str]
    approach: str
    verification_steps: list[str]
    risks: list[str]


def run_plan(
    *,
    task: str,
    context: dict[str, Any],
    profile: ExecutionProfile,
    assumptions: list[str],
) -> PlanResult:
    system = read_prompt("plan.md")

    payload = {
        "task": task,
        "profile": {"language": profile.language, "framework": profile.framework},
        "constraints": context.get("constraints") or [],
        "assumptions": assumptions,
        "files": files_payload(context.get("files")),
        "error_logs": safe_truncate(
            str(context.get("error_logs") or ""), max_chars=12_000
        ),
        "goal": context.get("goal"),
    }

    raw = generate(system, "STEP: plan\n" + safe_json_dumps(payload))
    data = parse_json(raw)

    plan = [str(x).strip() for x in (data.get("plan") or []) if str(x).strip()]
    files_to_touch = [
        str(x).strip() for x in (data.get("files_to_touch") or []) if str(x).strip()
    ]
    approach = (
        str(data.get("approach") or "").strip()
        or "Implement the minimal correct change."
    )

    verification_steps = [
        str(x).strip() for x in (data.get("verification_steps") or []) if str(x).strip()
    ]
    risks = [str(x).strip() for x in (data.get("risks") or []) if str(x).strip()]

    return PlanResult(
        plan=plan,
        files_to_touch=files_to_touch,
        approach=approach,
        verification_steps=verification_steps,
        risks=risks,
    )
