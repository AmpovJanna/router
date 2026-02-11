from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..subagents.debugger import DebugResult, run_debugger
from ..subagents.patch_writer import PatchWriteResult, run_patch_writer
from .reviewer import ReviewResult, run_review
from .solid_critic import SolidCriticResult, run_solid_critic


@dataclass(frozen=True)
class DebugFixResult:
    debug: DebugResult
    patch: str
    review: ReviewResult
    solid: SolidCriticResult


def run_debug_fix(
    *,
    task: str,
    context: dict[str, Any],
    profile: Any,
    plan: list[str],
) -> DebugFixResult:
    """End-to-end debug+fix pipeline.

    Returns a final patch plus review/solid outputs to feed the reporter.
    """

    debug = run_debugger(task=task, context=context)

    patch_wr = run_patch_writer(
        task=task,
        context=context,
        plan=plan,
        debug={
            "reasoning": debug.reasoning,
            "likely_root_causes": debug.likely_root_causes,
            "proposed_fix": debug.proposed_fix,
        },
    )

    review = run_review(task=task, context=context, profile=profile, patch=patch_wr.patch)
    solid = run_solid_critic(task=task, context=context, profile=profile, patch=patch_wr.patch, plan=plan)

    return DebugFixResult(debug=debug, patch=patch_wr.patch, review=review, solid=solid)
