from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ....llm.client import generate
from ..pipeline.utils import ensure_unified_diff, read_prompt, safe_truncate


@dataclass(frozen=True)
class PatchWriteResult:
    patch: str
    reasoning: str


def run_patch_writer(*, task: str, context: dict[str, Any], plan: list[str], debug: dict[str, Any]) -> PatchWriteResult:
    """Write a unified diff patch focused on fixing the reported issue.

    Uses debugger output as additional guidance.
    """

    system = read_prompt("patch.md")
    payload = {
        "task": task,
        "plan": plan,
        "debug": debug,
        "error_logs": safe_truncate(str((context or {}).get("error_logs") or ""), max_chars=18_000),
        "files": (context or {}).get("files") or [],
        "project_scan": (context or {}).get("project_scan") or {},
    }

    raw = generate(system, "STEP: patch\n" + json.dumps(payload, ensure_ascii=False), temperature=0.0)

    # Try to keep only a diff.
    patch = ensure_unified_diff(raw)
    if patch:
        return PatchWriteResult(patch=patch, reasoning="")

    # If model wrapped it in JSON, accept that.
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            patch2 = ensure_unified_diff(str(obj.get("patch") or ""))
            reasoning = str(obj.get("reasoning") or "").strip()
            if patch2:
                return PatchWriteResult(patch=patch2, reasoning=reasoning)
    except Exception:
        pass

    return PatchWriteResult(patch="", reasoning=(raw or "").strip())
