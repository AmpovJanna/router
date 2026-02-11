from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Final
from urllib.parse import urlparse


# Default model used if none is specified.
# NOTE: keep this a widely-available OpenAI(-compatible) model name.
_DEFAULT_MODEL: Final[str] = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

logger = logging.getLogger(__name__)


class LLMClientError(RuntimeError):
    """Raised when the LLM client cannot generate a response."""


def _env(name: str, default: str | None = None) -> str | None:
    v = os.getenv(name)
    if v is None or v == "":
        return default
    return v


def _mode() -> str:
    return (_env("CODEGEN_LLM_MODE", "stub") or "stub").strip().lower()


def _extract_step_id(user_prompt: str) -> str:
    """Extract a deterministic step identifier from the user prompt.

    Convention:
    - Include a line like: "STEP: intake".
    """

    m = re.search(r"^STEP\s*:\s*([a-zA-Z0-9_\-\.]+)\s*$", user_prompt, flags=re.MULTILINE)
    if not m:
        return "unknown"
    return m.group(1).strip().lower()


def _maybe_log_reasoning(*, step: str, content: str) -> None:
    """Optionally log model output for transparency/debugging.

    Controlled by env var CODEGEN_SUBAGENT_REASONING_LOG=0|1 (default 0).

    NOTE: this logs raw model output; do not enable in environments where prompts
    or code may contain secrets.
    """

    enabled = (_env("CODEGEN_SUBAGENT_REASONING_LOG", "0") or "0").strip() in {"1", "true", "yes"}
    if not enabled:
        return

    try:
        # Trim to avoid log spam.
        preview = (content or "").strip()
        if len(preview) > 4000:
            preview = preview[:3500] + "\n...<truncated>...\n" + preview[-400:]
        logger.info("llm.step_output step=%s chars=%s\n%s", step, len(content or ""), preview)
    except Exception:
        # Never fail the request due to logging.
        logger.exception("llm.step_output logging failed")


def _stub_json(obj: dict[str, Any]) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True)


def _stub_generate(system_prompt: str, user_prompt: str, *, model: str | None, temperature: float) -> str:
    step = _extract_step_id(user_prompt)

    # Deterministic JSON-ish outputs to reduce parser complexity.
    if step == "intake":
        return _stub_json(
            {
                "needs_clarification": False,
                "questions": [],
                "assumptions": ["Files provided are sufficient."],
                "profile": {"language": "python", "framework": ""},
                "goal": "bugfix",
                "verification_steps": ["Run unit tests", "Run the demo script"],
            }
        )

    # Project-planner (projplan) stubs.
    # These steps are invoked by the projplan agent, which shares this LLM client wrapper.
    if step == "projplan.scope":
        return (
            "## REQUIREMENTS\n"
            "- Produce a structured project plan (phases + tasks) and risks\n\n"
            "## DOMAIN\n"
            "- Project planning\n\n"
            "## CONSTRAINTS\n"
            "- Keep output concise and implementation-ready\n\n"
            "## ASSUMPTIONS\n"
            "- Use reasonable defaults when details are missing\n"
        )

    if step == "projplan.strategy":
        return (
            "## STRATEGY OVERVIEW\n\n"
            "- Break delivery into 3–5 phases with clear outcomes\n"
            "- Prefer tasks that are independently actionable\n"
            "- Include a lightweight customer/ops feedback loop\n"
        )

    if step == "projplan.tasks_json":
        return _stub_json(
            {
                "projectName": "Project Plan",
                "currentProgress": 0,
                "phases": [
                    {
                        "id": "p1",
                        "title": "Discovery & Definition",
                        "icon": "search",
                        "tasks": [
                            {
                                "id": "t1",
                                "title": "Confirm scope and success metrics",
                                "description": "Define objectives, audience, constraints, and 3–5 measurable KPIs.",
                                "completed": False,
                                "status": "todo",
                            },
                            {
                                "id": "t2",
                                "title": "Identify dependencies and timeline",
                                "description": "List key dependencies and draft a realistic timeline.",
                                "completed": False,
                                "status": "todo",
                            },
                        ],
                    },
                    {
                        "id": "p2",
                        "title": "Execution Planning",
                        "icon": "palette",
                        "tasks": [
                            {
                                "id": "t3",
                                "title": "Create runbook and staffing plan",
                                "description": "Define roles/responsibilities and a run-of-show.",
                                "completed": False,
                                "status": "todo",
                            }
                        ],
                    },
                    {
                        "id": "p3",
                        "title": "Delivery & Follow-up",
                        "icon": "rocket",
                        "tasks": [
                            {
                                "id": "t4",
                                "title": "Launch and capture learnings",
                                "description": "Execute, measure KPIs, and run a post-mortem with next actions.",
                                "completed": False,
                                "status": "todo",
                            }
                        ],
                    },
                ],
            }
        )

    if step == "projplan.risks":
        return (
            "## RISKS & MITIGATIONS\n\n"
            "- Scope creep → Freeze scope early; require approval for additions.\n"
            "- Timeline slippage → Add buffer; track dependencies weekly.\n"
            "- Capacity/throughput issues → Simplify offerings; add staffing during peaks.\n"
        )

    if step == "plan":
        return _stub_json(
            {
                "plan": [
                    "Keep changes minimal and local.",
                    "Prefer pure functions and small classes.",
                    "Ensure unified diff output for patch steps.",
                ],
                "files_to_touch": [],
                "risks": ["Stub mode cannot validate compilation/runtime."],
            }
        )

    if step == "patch":
        # Patch/revise steps must return unified diff only.
        return (
            "diff --git a/example.py b/example.py\n"
            "new file mode 100644\n"
            "index 0000000..1111111\n"
            "--- /dev/null\n"
            "+++ b/example.py\n"
            "@@\n"
            "+def hello():\n"
            "+    return 'hello'\n"
        )

    if step == "review":
        return _stub_json(
            {
                "findings": ["No critical issues found in stub output."],
                "edge_cases": ["Ensure patch applies cleanly."],
                "improvements": ["Add tests if the project has a test harness."],
            }
        )

    if step == "solid":
        return _stub_json(
            {
                "solid": [
                    "SRP: pipeline steps are separated.",
                    "OCP: prompts/pipeline are modular.",
                    "DIP: LLM access is behind a stable wrapper.",
                ],
                "patterns": ["Internal pipeline / chain-of-responsibility"],
            }
        )

    if step == "revise":
        # In stub mode return empty; reviser will fall back to previous patch.
        return ""

    if step == "report":
        # Reporter may return bullet lines; pipeline will split them.
        return (
            "- Implemented internal multi-step codegen pipeline (intake->plan->patch->review->SOLID->revise->report).\n"
            "- Added LLM client wrapper supporting stub/openai via env vars (incl. OPENAI_BASE_URL for proxies).\n"
            "- Ensured outputs conform to shared Pydantic contracts and kept external API unchanged.\n"
            "- SOLID: separated responsibilities per pipeline step; prompt files enable extension without modifying core logic.\n"
            "- Verification: run demo script in stub and openai mode; run backend unit tests (if present).\n"
        )

    return "(stub)"


def _openai_generate(system_prompt: str, user_prompt: str, *, model: str | None, temperature: float) -> str:
    api_key = _env("OPENAI_API_KEY")
    if not api_key:
        raise LLMClientError("OPENAI_API_KEY is required when CODEGEN_LLM_MODE=openai")

    # Support OpenAI-compatible proxies.
    base_url = _env("OPENAI_BASE_URL")

    resolved_model = model or (_env("LLM_MODEL_CODEGEN", _DEFAULT_MODEL) or _DEFAULT_MODEL)

    try:
        from openai import OpenAI  # type: ignore
    except Exception as e:  # pragma: no cover
        raise LLMClientError("openai package not available. Install it or use CODEGEN_LLM_MODE=stub.") from e

    client = OpenAI(api_key=api_key, base_url=base_url)

    host = None
    if base_url:
        try:
            host = urlparse(base_url).hostname
        except Exception:
            host = None

    t0 = time.perf_counter()
    logger.info(
        "llm.call start provider=openai model=%s host=%s system_chars=%s user_chars=%s",
        resolved_model,
        host,
        len(system_prompt or ""),
        len(user_prompt or ""),
    )

    resp = client.chat.completions.create(
        model=resolved_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
    )

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    content = (resp.choices[0].message.content or "").strip()

    prompt_tokens = getattr(getattr(resp, "usage", None), "prompt_tokens", None)
    completion_tokens = getattr(getattr(resp, "usage", None), "completion_tokens", None)
    total_tokens = getattr(getattr(resp, "usage", None), "total_tokens", None)

    logger.info(
        "llm.call end provider=openai model=%s elapsed_ms=%s prompt_tokens=%s completion_tokens=%s total_tokens=%s output_chars=%s",
        resolved_model,
        elapsed_ms,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        len(content),
    )

    return content


def generate(
    system_prompt: str,
    user_prompt: str,
    *,
    model: str | None = None,
    temperature: float = 0.0,
) -> str:
    """Generate content from an LLM.

    Controlled by env vars:
    - CODEGEN_LLM_MODE=stub|openai (default stub)
    - OPENAI_API_KEY (required if openai)
    - OPENAI_BASE_URL (optional; OpenAI-compatible proxies)
    - LLM_MODEL_CODEGEN (default gpt-4o-mini)
    - LLM_MODEL_REPORTER (optional; report step fallback)

    Returns raw model message content.
    """

    step = _extract_step_id(user_prompt)

    resolved_model = model
    if resolved_model is None and step == "report":
        resolved_model = _env("LLM_MODEL_REPORTER") or _env("LLM_MODEL_CODEGEN", _DEFAULT_MODEL) or _DEFAULT_MODEL

    mode = _mode()
    if mode == "openai":
        out = _openai_generate(system_prompt, user_prompt, model=resolved_model, temperature=temperature)
        _maybe_log_reasoning(step=step, content=out)
        return out

    # Stub mode still logs start/end so users see progress in dev without an API key.
    t0 = time.perf_counter()
    logger.info(
        "llm.call start provider=stub model=%s system_chars=%s user_chars=%s",
        resolved_model,
        len(system_prompt or ""),
        len(user_prompt or ""),
    )
    out = _stub_generate(system_prompt, user_prompt, model=resolved_model, temperature=temperature)
    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    logger.info(
        "llm.call end provider=stub model=%s elapsed_ms=%s output_chars=%s",
        resolved_model,
        elapsed_ms,
        len(out or ""),
    )
    _maybe_log_reasoning(step=step, content=out)
    return out
