from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ...llm.client import generate


def _read_prompt(name: str) -> str:
    path = Path(__file__).with_name("prompts") / name
    return path.read_text(encoding="utf-8")


def _strip_json_fences(text: str) -> str:
    s = (text or "").strip()
    # ```json ... ```
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", s, flags=re.DOTALL | re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return s


@dataclass
class ScopeResult:
    requirements_md: str


@dataclass
class StrategyResult:
    strategy_md: str


@dataclass
class TaskResult:
    plan_json: str


@dataclass
class RiskResult:
    risks_md: str


class ScopeAgent:
    def run(self, user_query: str) -> ScopeResult:
        system = _read_prompt("scope.md")
        user = f"STEP: projplan.scope\n\nUSER_QUERY:\n{user_query.strip()}\n"
        out = generate(system, user, temperature=0.2)
        return ScopeResult(requirements_md=out.strip())


class StrategyAgent:
    def run(self, requirements_md: str) -> StrategyResult:
        system = _read_prompt("strategy.md")
        user = f"STEP: projplan.strategy\n\nREQUIREMENTS_AND_DOMAIN:\n{requirements_md.strip()}\n"
        out = generate(system, user, temperature=0.2)
        return StrategyResult(strategy_md=out.strip())


class TaskAgent:
    def run(self, requirements_md: str, strategy_md: str) -> TaskResult:
        system = _read_prompt("tasks_json.md")
        user = (
            "STEP: projplan.tasks_json\n\n"
            "REQUIREMENTS_AND_DOMAIN:\n"
            f"{requirements_md.strip()}\n\n"
            "STRATEGY:\n"
            f"{strategy_md.strip()}\n"
        )
        out = generate(system, user, temperature=0.0)
        cleaned = _strip_json_fences(out)

        # Ensure it is valid JSON (early, before main agent validation)
        json.loads(cleaned)
        return TaskResult(plan_json=cleaned.strip())


class RiskAgent:
    def run(self, plan_json: str) -> RiskResult:
        system = _read_prompt("risks.md")
        user = f"STEP: projplan.risks\n\nPROJECT_PLAN_JSON:\n{plan_json.strip()}\n"
        out = generate(system, user, temperature=0.2)
        return RiskResult(risks_md=out.strip())


@dataclass
class FollowupResult:
    answer_md: str


class FollowupAgent:
    def run(
        self, *, user_message: str, plan_json: str, risks: list[str] | None = None
    ) -> FollowupResult:
        system = _read_prompt("followup.md")
        user = (
            "STEP: projplan.followup\n\n"
            "USER_MESSAGE:\n"
            f"{user_message.strip()}\n\n"
            "CURRENT_PROJECT_PLAN_JSON:\n"
            f"{plan_json.strip()}\n\n"
            "RISKS (OPTIONAL):\n"
            f"{json.dumps(risks or [], ensure_ascii=False)}\n"
        )
        out = generate(system, user, temperature=0.2)
        return FollowupResult(answer_md=out.strip())


@dataclass
class EditResult:
    plan_json: str


class EditAgent:
    def run(self, *, user_message: str, plan_json: str) -> EditResult:
        system = _read_prompt("edit.md")
        user = (
            "STEP: projplan.edit\n\n"
            "USER_MESSAGE:\n"
            f"{user_message.strip()}\n\n"
            "CURRENT_PROJECT_PLAN_JSON:\n"
            f"{plan_json.strip()}\n"
        )
        out = generate(system, user, temperature=0.3)
        cleaned = _strip_json_fences(out)
        # Validate it's proper JSON
        json.loads(cleaned)
        return EditResult(plan_json=cleaned.strip())
