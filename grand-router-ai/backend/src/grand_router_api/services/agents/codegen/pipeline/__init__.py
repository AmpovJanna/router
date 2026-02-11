"""Internal multi-step pipeline for the Codegen agent.

Router and external API never see these subagents; they are implementation details.
"""

from .debug_fix import DebugFixResult, run_debug_fix
from .implementer import PatchResult, run_patch
from .intake import IntakeResult, run_intake
from .planner import PlanResult, run_plan
from .reporter import ReportResult, run_report
from .reviewer import ReviewResult, run_review
from .reviser import ReviseResult, run_revise
from .scanner import ScanResult, scan_project
from .snippet import SnippetResult, run_snippet
from .solid_critic import SolidCriticResult, run_solid_critic

__all__ = [
    "IntakeResult",
    "run_intake",
    "PlanResult",
    "run_plan",
    "DebugFixResult",
    "run_debug_fix",
    "PatchResult",
    "run_patch",
    "SnippetResult",
    "run_snippet",
    "ReviewResult",
    "run_review",
    "SolidCriticResult",
    "run_solid_critic",
    "ReviseResult",
    "run_revise",
    "ReportResult",
    "run_report",
    "ScanResult",
    "scan_project",
]
