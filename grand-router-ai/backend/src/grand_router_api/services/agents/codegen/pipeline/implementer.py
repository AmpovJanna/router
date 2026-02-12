from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ....llm.client import generate

from .utils import (
    ExecutionProfile,
    ensure_unified_diff,
    files_payload,
    read_prompt,
    safe_json_dumps,
    safe_truncate,
)


@dataclass(frozen=True)
class PatchResult:
    patch: str


def run_patch(
    *,
    task: str,
    context: dict[str, Any],
    profile: ExecutionProfile,
    plan: list[str],
    assumptions: list[str],
    files_to_touch: list[str] | None = None,
) -> PatchResult:
    system = read_prompt("patch.md")

    provided_files = files_payload(context.get("files"))

    effective_files_to_touch = list(files_to_touch or [])
    if not effective_files_to_touch and provided_files:
        # Encourage scope compliance: touch only provided files when plan didn't specify.
        effective_files_to_touch = [f["path"] for f in provided_files][:3]

    payload = {
        "task": task,
        "profile": {"language": profile.language, "framework": profile.framework},
        "constraints": context.get("constraints") or [],
        "assumptions": assumptions,
        "plan": plan,
        "files_to_touch": effective_files_to_touch,
        "files": provided_files,
        "error_logs": safe_truncate(
            str(context.get("error_logs") or ""), max_chars=12_000
        ),
        "goal": context.get("goal"),
        "project_scan": (context or {}).get("project_scan") or {},
    }

    raw = generate(system, "STEP: patch\n" + safe_json_dumps(payload), temperature=0.0)
    patch = ensure_unified_diff(raw)
    return PatchResult(patch=patch)
