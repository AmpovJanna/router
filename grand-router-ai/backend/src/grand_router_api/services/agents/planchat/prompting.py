from __future__ import annotations

import json
from pathlib import Path

from ...llm.client import generate


def _read_prompt(name: str) -> str:
    return (Path(__file__).with_name("prompts") / name).read_text(encoding="utf-8")


def build_prompt(*, user_message: str, plan_json: str, risks: list[str]) -> str:
    system = _read_prompt("answer.md")
    payload = {
        "user_message": (user_message or "").strip(),
        "plan_json": (plan_json or "").strip(),
        "risks": [str(r) for r in (risks or [])][:20],
    }
    user = "STEP: planchat.answer\n" + json.dumps(payload, ensure_ascii=False)
    out = generate(system, user, temperature=0.2)
    return (out or "").strip()
