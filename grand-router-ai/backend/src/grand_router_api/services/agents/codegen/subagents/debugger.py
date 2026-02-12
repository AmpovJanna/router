from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ....llm.client import generate
from ..pipeline.utils import read_prompt, safe_json_dumps, safe_truncate


@dataclass(frozen=True)
class DebugResult:
    reasoning: str
    likely_root_causes: list[str]
    proposed_fix: str


def run_debugger(
    *, task: str, context: dict[str, Any], patch: str | None = None
) -> DebugResult:
    """Analyze error logs + code context and propose a fix.

    This is intentionally "analysis only"; it does not produce a patch.
    """

    system = read_prompt("debug.md")
    payload = {
        "task": task,
        "error_logs": safe_truncate(
            str((context or {}).get("error_logs") or ""), max_chars=18_000
        ),
        "files": (context or {}).get("files") or [],
        "project_scan": (context or {}).get("project_scan") or {},
        "current_patch": safe_truncate(str(patch or ""), max_chars=18_000),
    }

    raw = generate(system, "STEP: debug\n" + safe_json_dumps(payload), temperature=0.0)

    # Try JSON first; fallback to plain text.
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            reasoning = str(obj.get("reasoning") or "").strip()
            likely = [
                str(x).strip()
                for x in (obj.get("likely_root_causes") or [])
                if str(x).strip()
            ]
            proposed = str(obj.get("proposed_fix") or "").strip()
            return DebugResult(
                reasoning=reasoning,
                likely_root_causes=likely[:8],
                proposed_fix=proposed,
            )
    except Exception:
        pass

    return DebugResult(
        reasoning=(raw or "").strip(), likely_root_causes=[], proposed_fix=""
    )
