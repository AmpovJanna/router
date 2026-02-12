"""Top-level Codegen agent.

Phase 7 (Part 1): Real Code Generation & Debugging Agent

Registry entrypoint must remain:
`grand_router_api.services.agents.codegen.agent:CodegenAgent`.

External API contract remains unchanged (shared contracts).
Internal implementation uses a multi-step LLM pipeline.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any

from .pipeline.utils import safe_truncate

from grand_router_contracts.agent import (
    AgentId,
    AgentInvokeRequest,
    AgentInvokeResponse,
    AgentStatus,
)
from grand_router_contracts.artifacts import (
    Artifact,
    PatchArtifact,
    VerificationStepsArtifact,
)

from ..base import BaseAgent
from .pipeline import (
    run_intake,
    run_patch,
    run_plan,
    run_report,
    run_review,
    run_revise,
    run_snippet,
    run_solid_critic,
    scan_project,
    run_debug_fix,
)

from .steps.snippet import parse_snippet

logger = logging.getLogger(__name__)


def _dedupe_preserve_order(items: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for it in items:
        s = str(it).strip()
        if not s:
            continue
        if s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def _is_test_path(path: str) -> bool:
    p = (path or "").replace("\\", "/").casefold()
    name = p.rsplit("/", 1)[-1]
    if "/tests/" in f"/{p}/" or "/test/" in f"/{p}/" or "/__tests__/" in f"/{p}/":
        return True
    if name.startswith("test_") and name.endswith(".py"):
        return True
    if name.endswith("_test.py"):
        return True
    if ".spec." in name or ".test." in name:
        return True
    return False


def _extract_diff_paths(patch: str) -> list[str]:
    # Parse git diff headers like: diff --git a/path b/path
    paths: list[str] = []
    for m in re.finditer(
        r"^diff\s+--git\s+a/(\S+)\s+b/(\S+)\s*$", patch or "", flags=re.MULTILINE
    ):
        a_path = m.group(1)
        b_path = m.group(2)
        for p in (a_path, b_path):
            if p and p != "/dev/null":
                paths.append(p)
    return _dedupe_preserve_order(paths)


def _patch_deletes_or_moves_tests(patch: str) -> bool:
    # Conservative heuristic: treat deletes/renames of test files as disallowed.
    # - deleted file: "deleted file mode" + a/ path is a test
    # - rename: "rename from" or "rename to" where any side is a test
    curr_a: str | None = None
    for line in (patch or "").splitlines():
        if line.startswith("diff --git a/"):
            m = re.match(r"^diff\s+--git\s+a/(\S+)\s+b/(\S+)$", line)
            if m:
                curr_a = m.group(1)
            else:
                curr_a = None
            continue

        if line.startswith("deleted file mode"):
            if curr_a and _is_test_path(curr_a):
                return True

        if line.startswith("rename from "):
            old = line[len("rename from ") :].strip()
            if _is_test_path(old):
                return True

        if line.startswith("rename to "):
            new = line[len("rename to ") :].strip()
            if _is_test_path(new):
                return True

    return False


def _user_explicitly_requested_test_deletion(task: str) -> bool:
    # Minimal explicitness check: user must ask to delete/remove tests.
    # (Also accept "rename"/"move" because the guardrail blocks those too.)
    t = (task or "").casefold()
    return (
        "test" in t
        and any(k in t for k in ["delete", "remove", "rename", "move"])
        and any(k in t for k in ["test", "tests"])
    )


def _is_generic_verification_step(step: str) -> bool:
    s = _normalize_step(step)
    return any(
        re.search(p, s)
        for p in [
            r"\brun\s+unit\s+tests?\b",
            r"\brun\s+tests?\b",
            r"\bunit\s+tests?\b",
            r"\blint(ers|ing)?\b",
            r"\bsmoke\s+test\b",
        ]
    )


def _python_project_has_tests(context: dict[str, Any], task: str) -> bool:
    task_lc = (task or "").casefold()
    if any(k in task_lc for k in ["pytest", "unittest", "test suite", "tests"]):
        return True

    files = (context or {}).get("files") or []
    for f in files:
        p = str((f or {}).get("path") or "")
        if _is_test_path(p):
            return True

    return False


def _clean_verification_steps_final(
    steps: list[str],
    *,
    profile: Any,
    task: str,
    context: dict[str, Any],
) -> list[str]:
    # Apply existing cleaning + additional language-specific preferences.
    cleaned = clean_verification_steps(
        steps, profile=profile, task=task, context=context
    )

    lang = str(getattr(profile, "language", "") or "").casefold()

    if lang == "python":
        has_tests = _python_project_has_tests(context, task)
        out: list[str] = []
        for s in cleaned:
            slc = s.casefold()
            # remove generic linters/smoke (again) for safety
            if _is_generic_verification_step(s) and "pytest" not in slc:
                continue
            # prefer compileall; drop "python -m py_compile" etc.
            if "py_compile" in slc:
                continue
            # drop pytest if no tests mentioned/present
            if ("pytest" in slc) and (not has_tests):
                continue
            out.append(s)

        # Ensure compileall is present when python is detected.
        if not any("compileall" in s.casefold() for s in out):
            out.insert(0, "python -m compileall .")

        cleaned = out

    # Final cap/dedupe already handled upstream, but be safe.
    return _dedupe_preserve_order(cleaned)[:6]


def _report_mentions_only_touched_files(
    *, notes: list[str], touched_paths: list[str]
) -> bool:
    # Minimal heuristic: if the report mentions a path-like token that looks like a repo file,
    # it must be in touched_paths.
    allowed = {p.replace("\\", "/").casefold() for p in (touched_paths or [])}
    if not allowed:
        return True

    text = "\n".join(notes or [])
    # Capture slash paths with an extension; avoid URLs.
    candidates = set(
        m.group(0)
        for m in re.finditer(
            r"\b(?!https?://)([A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9_.-]+)\b",
            text,
        )
    )
    for c in candidates:
        p = c.replace("\\", "/").casefold()
        if p not in allowed:
            return False
    return True


def _normalize_step(step: str) -> str:
    # Normalize for case-insensitive dedupe while keeping the original step text.
    return re.sub(r"\s+", " ", step.strip()).casefold()


def clean_verification_steps(
    steps: list[str],
    profile: Any,
    task: str,
    context: dict[str, Any],
) -> list[str]:
    """Clean and constrain verification steps.

    Requirements implemented:
    - trim
    - case-insensitive de-dupe
    - remove generic steps (tests/linters/smoke) unless requested or framework indicates
    - remove jshell by default
    - Java/Spring greenfield: prefer mvn test if explicitly mentioned; otherwise prefer javac/java
    - cap to <= 6 steps
    """

    raw: list[str] = [str(s).strip() for s in (steps or []) if str(s).strip()]
    if not raw:
        return []

    task_lc = (task or "").casefold()
    files = (context or {}).get("files") or []
    java_greenfield = bool(getattr(profile, "language", None) == "java") and (
        not files or "create class" in task_lc or "create classes" in task_lc
    )

    # Generic steps to remove unless explicitly requested / indicated.
    generic_patterns = [
        r"\brun\s+unit\s+tests?\b",
        r"\brun\s+tests?\b",
        r"\bunit\s+tests?\b",
        r"\blint(ers|ing)?\b",
        r"\bsmoke\s+test\b",
    ]
    wants_generic = any(
        k in task_lc
        for k in [
            "unit test",
            "unit tests",
            "tests",
            "test suite",
            "lint",
            "linter",
            "smoke test",
        ]
    )

    # Framework indication heuristic: allow generic steps if the task mentions a known test tool.
    mentions_test_framework = any(
        k in task_lc
        for k in [
            "pytest",
            "unittest",
            "jest",
            "vitest",
            "mocha",
            "junit",
            "testng",
            "go test",
            "cargo test",
            "dotnet test",
        ]
    )

    allow_generic = wants_generic or mentions_test_framework

    # Java build tool policy.
    allow_maven = "mvn" in task_lc or "maven" in task_lc
    allow_gradle = "gradle" in task_lc or "./gradlew" in task_lc or "gradlew" in task_lc

    cleaned: list[str] = []
    seen_norm: set[str] = set()

    def add(step: str) -> None:
        s = str(step).strip()
        if not s:
            return
        n = _normalize_step(s)
        if n in seen_norm:
            return
        seen_norm.add(n)
        cleaned.append(s)

    for step in raw:
        step_lc = step.casefold()

        # Remove jshell by default.
        if "jshell" in step_lc:
            continue

        # Remove generic steps unless explicitly requested/indicated.
        if not allow_generic:
            if any(re.search(p, step_lc) for p in generic_patterns):
                continue

        if java_greenfield:
            # Prefer javac/java commands; disallow mvn/gradle unless explicitly mentioned.
            if ("mvn" in step_lc or "maven" in step_lc) and not allow_maven:
                continue
            if ("gradle" in step_lc or "gradlew" in step_lc) and not allow_gradle:
                continue

        add(step)

    if java_greenfield:
        # Ensure reasonable Java greenfield steps exist.
        # Policy:
        # - If Maven is mentioned, prefer `mvn test`.
        # - Otherwise prefer plain `javac`/`java` (no jshell).
        preferred = (
            [
                "mvn test",
            ]
            if allow_maven
            else [
                "javac User.java Employee.java Main.java",
                "java Main",
            ]
        )
        # Prepend in order while respecting dedupe.
        existing = cleaned
        cleaned = []
        seen_norm.clear()
        for s in preferred:
            add(s)
        for s in existing:
            add(s)

        # In greenfield mode, also remove any remaining build-tool steps unless explicitly allowed.
        if not allow_maven:
            cleaned = [
                s
                for s in cleaned
                if "mvn" not in s.casefold() and "maven" not in s.casefold()
            ]
        if not allow_gradle:
            cleaned = [
                s
                for s in cleaned
                if "gradle" not in s.casefold() and "gradlew" not in s.casefold()
            ]

    return cleaned[:6]


class CodegenAgent(BaseAgent):
    agent_id: AgentId = AgentId.codegen

    def invoke(self, request: AgentInvokeRequest) -> AgentInvokeResponse:
        t0 = time.perf_counter()
        context: dict[str, Any] = request.context or {}

        logger.info("codegen.pipeline start")

        logger.info("codegen.step intake start")
        intake = run_intake(task=request.task, context=context)
        logger.info(
            "codegen.step intake end needs_clarification=%s goal=%s",
            intake.needs_clarification,
            intake.goal,
        )
        if intake.needs_clarification:
            return AgentInvokeResponse(
                agent_id=self.agent_id,
                status=AgentStatus.needs_clarification,
                artifacts=[],
                notes=["- Missing critical information to generate a safe patch."],
                clarifying_questions=intake.questions[:3],
            )

        # Decide generation mode.
        # Requested behavior:
        # - If context.files is empty/missing -> ALWAYS snippet mode.
        #   (Do not attempt patch/revise, even if the task includes inline code blocks.)
        files = context.get("files") or []
        error_logs = str(context.get("error_logs") or "").strip()

        # Project scan (optional): provide extra context for debug/fix runs.
        # This is best-effort and safe: no subprocesses, size caps.
        try:
            want_scan = bool(context.get("project_scan"))
            looks_like_debug = (
                bool(error_logs)
                or any(
                    k in (request.task or "").casefold()
                    for k in ["debug", "traceback", "stack trace", "exception"]
                )
                or intake.goal == "bugfix"
            )
            if want_scan and looks_like_debug:
                root_dir = str(context.get("project_root") or ".")
                scan = scan_project(
                    root_dir=root_dir,
                    include_globs=list(
                        context.get("project_scan_include")
                        or [
                            "**/*.py",
                            "**/*.ts",
                            "**/*.tsx",
                            "**/*.js",
                            "**/*.json",
                            "**/*.toml",
                            "**/*.yml",
                            "**/*.yaml",
                            "**/pyproject.toml",
                            "**/package.json",
                            "**/vite.config.*",
                        ]
                    ),
                    regexes=list(
                        context.get("project_scan_regexes")
                        or [
                            r"Traceback\\b",
                            r"TODO\\b",
                            r"FIXME\\b",
                            r"raise\\s+",
                            r"logger\\.",
                            r"console\\.",
                        ]
                    ),
                )
                context = {
                    **context,
                    "project_scan": {
                        "file_tree": scan.file_tree[:250],
                        "grep_hits": scan.grep_hits[:80],
                    },
                }
                logger.info(
                    "codegen.project_scan done files=%s hits=%s",
                    len(scan.file_tree),
                    len(scan.grep_hits),
                )
        except Exception:
            logger.exception("codegen.project_scan failed")

        snippet_mode = not bool(files)

        # If user pasted inline code (in the task) but did not provide context.files, we still want
        # to proceed for small, self-contained bugfix/debug tasks.
        # We do that by injecting a virtual file into context.files so downstream steps can operate
        # deterministically and the reporter can produce WHAT CHANGED (BY FILE).
        inline_task = str(request.task or "")
        if snippet_mode and inline_task.strip():
            # Treat pasted code as a virtual file so bugfix/debug/refactor can still proceed even
            # when the caller didn't provide context.files.
            #
            # Heuristics:
            # - Multi-line snippets: >=3 lines + at least one strong code token
            # - One-line "pasted module"/"minified" code: allow if it contains multiple strong tokens
            task_lines = inline_task.splitlines()
            inline_task_lc = inline_task.casefold()

            strong_tokens = [
                "def ",
                "class ",
                "return ",
                "import ",
                "from ",
                "try:",
                "except",
                "raise ",
                "async def ",
                "await ",
                "public class",
                "function ",
                "=>",
                "{",
            ]

            token_hits = sum(1 for tok in strong_tokens if tok in inline_task)

            # If code is pasted as a single line, we still want to detect it.
            # Example: "import x; def f(...): ..." (or other language equivalents).
            multiline_like_code = (len(task_lines) >= 3) and (token_hits >= 1)

            oneline_like_python_module = (
                (len(task_lines) <= 2)
                and ("def " in inline_task)
                and (
                    ("import " in inline_task)
                    or ("from " in inline_task)
                    or ("class " in inline_task)
                )
            )

            oneline_like_code = (len(task_lines) <= 2) and (
                oneline_like_python_module
                or (token_hits >= 2)
                or (";" in inline_task and token_hits >= 1)
            )

            looks_like_inline_code = multiline_like_code or oneline_like_code

            if looks_like_inline_code:
                # Choose a default filename based on the detected profile language.
                lang = (intake.profile.language or "").casefold()
                default_name = {
                    "python": "inline_snippet.py",
                    "java": "inline_snippet.java",
                    "javascript": "inline_snippet.js",
                    "typescript": "inline_snippet.ts",
                    "csharp": "inline_snippet.cs",
                }.get(lang, "inline_snippet.txt")

                # Preserve original context, but add a single virtual file.
                context = {
                    **context,
                    "files": [{"path": default_name, "content": inline_task}],
                }
                files = context.get("files") or []
                snippet_mode = False

        # NOTE: In snippet mode we don't run reviewer/solid-critic, but the reporter step expects
        # `review` and `solid`-shaped inputs.
        review: Any | None = None
        solid: Any | None = None

        if intake.goal in {"bugfix", "refactor"} and snippet_mode and not error_logs:
            return AgentInvokeResponse(
                agent_id=self.agent_id,
                status=AgentStatus.needs_clarification,
                artifacts=[],
                notes=[
                    "- Please provide relevant files in context.files for bugfix/refactor work."
                ],
                clarifying_questions=[
                    "Which file(s) should be modified? Provide them as context.files (path + content).",
                    "If available, include the full error log / stack trace in context.error_logs.",
                ],
            )

        logger.info("codegen.step planner start")
        plan = run_plan(
            task=request.task,
            context=context,
            profile=intake.profile,
            assumptions=intake.assumptions,
        )
        logger.info(
            "codegen.step planner end plan_items=%s files_to_touch=%s",
            len(plan.plan or []),
            len(plan.files_to_touch or []),
        )

        if snippet_mode:
            logger.info("codegen.step snippet start")
            snippet = run_snippet(
                task=request.task,
                context=context,
                profile=intake.profile,
                plan=plan.plan,
                assumptions=intake.assumptions,
            )
            logger.info(
                "codegen.step snippet end code_chars=%s", len(snippet.code or "")
            )

            code = snippet.code or ""

            parsed = parse_snippet(code)

            # Guardrails: snippet output must never contain diff markers.
            if (
                re.search(r"(^|\n)diff\s+--git\b", code)
                or re.search(r"(^|\n)\+\+\+\b", code)
                or re.search(r"(^|\n)@@\b", code)
            ):
                return AgentInvokeResponse(
                    agent_id=self.agent_id,
                    status=AgentStatus.needs_clarification,
                    artifacts=[],
                    notes=[
                        "- Snippet output contained diff markers. Please re-run with plain file snippets only."
                    ],
                    clarifying_questions=[
                        "Confirm the requested files/paths so I can output only full `// File:` blocks (no diffs).",
                    ],
                )

            # Guardrails: snippet output must include enough `// File:` blocks for the requested plan.
            # However, 0 file blocks is a valid "chat/explanation" state when no files are requested.
            requested_files = [
                str(p).strip() for p in (plan.files_to_touch or []) if str(p).strip()
            ]
            requested_files = _dedupe_preserve_order(requested_files)

            task_for_intent = (request.task or "").strip().lower()
            looks_like_question = (
                "?" in task_for_intent
                or task_for_intent.startswith("what ")
                or task_for_intent.startswith("why ")
                or task_for_intent.startswith("how ")
                or task_for_intent.startswith("can you ")
                or "explain" in task_for_intent
            )
            looks_like_generation_request = any(
                k in task_for_intent
                for k in [
                    "generate",
                    "scaffold",
                    "create ",
                    "write ",
                    "implement",
                    "add ",
                    "remove ",
                    "refactor",
                    "patch",
                    "diff",
                ]
            )

            if (
                parsed.is_chat_only
                and looks_like_question
                and (not looks_like_generation_request)
            ):
                # Pass through chat/explanation output even if the planner suggested files.
                # This prevents Q&A prompts from being blocked by snippet completeness guardrails.
                return AgentInvokeResponse(
                    agent_id=self.agent_id,
                    status=AgentStatus.ok,
                    artifacts=[],
                    notes=[parsed.text or code],
                    clarifying_questions=[],
                )

            file_blocks = len(parsed.files)

            # If planner suggests multiple files, require >=2. Otherwise require >= len(files_to_touch).
            min_blocks = len(requested_files)
            if len(requested_files) >= 2:
                min_blocks = max(min_blocks, 2)

            if file_blocks < min_blocks:
                return AgentInvokeResponse(
                    agent_id=self.agent_id,
                    status=AgentStatus.needs_clarification,
                    artifacts=[],
                    notes=[
                        f"- Snippet output is incomplete for expected domain + usage files (expected >= {min_blocks} `// File:` blocks, got {file_blocks}).",
                    ],
                    clarifying_questions=[
                        "Confirm the exact file list/paths you want generated so I can output full `// File:` blocks for each.",
                    ],
                )

            # Optional: if the task explicitly names Spring Boot classes/files, ensure those appear somewhere.
            # (We intentionally do NOT require Java example files like User/Employee/Main.java.)
            task_lc = (request.task or "").casefold()
            looks_like_spring = any(
                k in task_lc
                for k in [
                    "spring boot",
                    "springboot",
                    "@restcontroller",
                    "@controller",
                    "spring data",
                ]
            )
            if looks_like_spring:
                # Extract tokens that look like filenames or Java class names.
                class_tokens = set(
                    re.findall(
                        r"\b[A-Z][A-Za-z0-9]+(?:Controller|Service|Repository|Dto|DTO|Request|Response|Entity|Model)\b",
                        request.task or "",
                    )
                )
                file_tokens = set(
                    re.findall(
                        r"\b[\w./-]+\.(?:java|kt)\b",
                        request.task or "",
                        flags=re.IGNORECASE,
                    )
                )

                required_markers: list[str] = sorted(class_tokens) + sorted(file_tokens)
                if required_markers:
                    missing = [m for m in required_markers if m not in code]
                    if missing:
                        return AgentInvokeResponse(
                            agent_id=self.agent_id,
                            status=AgentStatus.needs_clarification,
                            artifacts=[],
                            notes=[
                                "- Snippet output is missing explicitly requested Spring Boot components:",
                                *[f"  - {m}" for m in missing[:8]],
                            ],
                            clarifying_questions=[
                                "Confirm whether these components should be generated (and their exact filenames/paths).",
                            ],
                        )

            final_patch = code

            verification_steps = _dedupe_preserve_order(
                list(plan.verification_steps)
                + list(intake.verification_steps)
                + [
                    "Compile/build the generated code",
                    "Run the provided entrypoint/example",
                ]
            )
            verification_steps = _clean_verification_steps_final(
                verification_steps,
                profile=intake.profile,
                task=request.task,
                context=context,
            )
        else:
            use_debug_fix = bool(context.get("debug_fix")) and bool(error_logs)

            if use_debug_fix:
                logger.info("codegen.step debug_fix start")
                dbg = run_debug_fix(
                    task=request.task,
                    context=context,
                    profile=intake.profile,
                    plan=plan.plan,
                )
                logger.info(
                    "codegen.step debug_fix end patch_chars=%s", len(dbg.patch or "")
                )

                final_patch = dbg.patch
                review = dbg.review
                solid = dbg.solid
            else:
                logger.info("codegen.step implementer start")
                patch1 = run_patch(
                    task=request.task,
                    context=context,
                    profile=intake.profile,
                    plan=plan.plan,
                    assumptions=intake.assumptions,
                    files_to_touch=plan.files_to_touch,
                )
                logger.info(
                    "codegen.step implementer end patch_chars=%s",
                    len(patch1.patch or ""),
                )

                logger.info("codegen.step reviewer start")
                review = run_review(
                    task=request.task,
                    context=context,
                    profile=intake.profile,
                    patch=patch1.patch,
                )
                logger.info(
                    "codegen.step reviewer end findings=%s must_fix=%s",
                    len(review.findings or []),
                    len(review.must_fix or []),
                )

                logger.info("codegen.step solid_critic start")
                solid = run_solid_critic(
                    task=request.task,
                    context=context,
                    profile=intake.profile,
                    patch=patch1.patch,
                    plan=plan.plan,
                )
                logger.info(
                    "codegen.step solid_critic end solid_items=%s issues=%s",
                    len(solid.solid or []),
                    len(solid.issues or []),
                )

                logger.info("codegen.step reviser start")
                revised = run_revise(
                    task=request.task,
                    context=context,
                    profile=intake.profile,
                    patch=patch1.patch,
                    review={
                        "findings": review.findings,
                        "edge_cases": review.edge_cases,
                        "improvements": review.improvements,
                        "must_fix": review.must_fix,
                    },
                    solid={
                        "solid": solid.solid,
                        "pattern_justification": solid.pattern_justification,
                        "issues": solid.issues,
                        "recommended_changes": solid.recommended_changes,
                    },
                )
                logger.info(
                    "codegen.step reviser end patch_chars=%s", len(revised.patch or "")
                )

                final_patch = revised.patch

            if not final_patch.strip():
                return AgentInvokeResponse(
                    agent_id=self.agent_id,
                    status=AgentStatus.needs_clarification,
                    artifacts=[],
                    notes=[
                        "- Unable to produce a valid unified diff patch from the provided inputs."
                    ],
                    clarifying_questions=[
                        "Please provide the relevant file(s) in context.files (path + content).",
                        "If this is a bug, include the full error log / stack trace in context.error_logs.",
                    ],
                )

            verification_steps = _dedupe_preserve_order(
                (
                    list(plan.verification_steps)
                    + list(intake.verification_steps)
                    + [
                        "Run unit tests",
                        "Run linters",
                        "Smoke test the app",
                    ]
                )
            )
            verification_steps = _clean_verification_steps_final(
                verification_steps,
                profile=intake.profile,
                task=request.task,
                context=context,
            )

        logger.info("codegen.step reporter start")
        report = run_report(
            task=request.task,
            context=context,
            profile=intake.profile,
            plan={
                "plan": plan.plan,
                "files_to_touch": plan.files_to_touch,
                "approach": plan.approach,
                "risks": plan.risks,
            },
            review={
                "findings": (review.findings if review else []),
                "edge_cases": (review.edge_cases if review else []),
                "improvements": (review.improvements if review else []),
                "must_fix": (review.must_fix if review else []),
            },
            solid={
                "solid": (solid.solid if solid else []),
                "pattern_justification": (solid.pattern_justification if solid else []),
                "issues": (solid.issues if solid else []),
                "recommended_changes": (solid.recommended_changes if solid else []),
            },
            final_patch=final_patch,
            verification_steps=verification_steps,
        )
        logger.info("codegen.step reporter end notes=%s", len(report.notes or []))

        notes = report.notes or ["- Generated a patch."]

        # (B) Deterministic final_patch guardrail: block test deletion/rename/move unless user asked.
        if (
            (not snippet_mode)
            and _patch_deletes_or_moves_tests(final_patch)
            and (not _user_explicitly_requested_test_deletion(request.task))
        ):
            return AgentInvokeResponse(
                agent_id=self.agent_id,
                status=AgentStatus.needs_clarification,
                artifacts=[],
                notes=[
                    "- Proposed patch deletes/renames/moves test files, which is not allowed by default.",
                    "- Please explicitly confirm that you want tests deleted/renamed/moved, or ask to keep/update them.",
                ],
                clarifying_questions=[
                    "Do you want to delete/rename/move the existing test files? If yes, list the exact paths.",
                ],
            )

        # (C) Report/patch consistency check: ensure notes mention only files touched in diff headers.
        if not snippet_mode:
            touched = _extract_diff_paths(final_patch)
            if not _report_mentions_only_touched_files(
                notes=notes, touched_paths=touched
            ):
                notes = [
                    "- Generated a patch.",
                    "- Note: Report omitted due to file/path inconsistency with the produced diff.",
                ]

        artifacts: list[Artifact] = [
            PatchArtifact(patch=final_patch),
            VerificationStepsArtifact(verification_steps=verification_steps),
        ]

        resp = AgentInvokeResponse(
            agent_id=self.agent_id,
            status=AgentStatus.ok,
            artifacts=artifacts,
            notes=notes,
            clarifying_questions=[],
        )

        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        logger.info(
            "codegen.pipeline end status=%s elapsed_ms=%s", resp.status, elapsed_ms
        )
        return resp
