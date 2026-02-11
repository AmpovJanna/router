from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class ExecutionProfile:
    language: str
    framework: str


def detect_profile(*, context: dict[str, Any], task: str = "") -> ExecutionProfile:
    """Best-effort language/framework detection.

    Priority:
    1) explicit context.language/framework
    2) infer from file extensions
    3) infer from task keywords

    React-specific language inference rules:
    - If files include .tsx -> language = typescript
    - If files include .jsx or .js -> language = javascript
    - If task mentions "typescript" explicitly -> language = typescript
    - Otherwise, if React is detected with no files, default to javascript (safer)
    """

    task_l = (task or "").lower()

    lang = str(context.get("language") or "").strip().lower()
    fw = str(context.get("framework") or "").strip().lower()

    files = context.get("files") or []
    exts: list[str] = []
    for f in files:
        try:
            p = str(f.get("path") or "")
        except Exception:
            continue
        _, dot, ext = p.rpartition(".")
        if dot and ext:
            exts.append(ext.lower())

    has_files = bool(exts)

    react_detected = (
        fw == "react" or "react" in task_l or any(e in {"tsx", "jsx"} for e in exts)
    )

    if not lang:
        # Strong signals from file extensions.
        if any(e in {"py"} for e in exts):
            lang = "python"
        elif any(e in {"java"} for e in exts):
            lang = "java"
        elif any(e in {"cs"} for e in exts):
            lang = "csharp"
        elif any(e in {"ts", "tsx"} for e in exts):
            lang = "typescript"
        elif any(e in {"js", "jsx"} for e in exts):
            lang = "javascript"
        else:
            # Task keyword inference.
            if "typescript" in task_l:
                lang = "typescript"
            elif "javascript" in task_l or "node" in task_l or "nodejs" in task_l:
                lang = "javascript"
            elif "asp.net" in task_l or "dotnet" in task_l or "c#" in task_l:
                lang = "csharp"
            elif "spring" in task_l:
                lang = "java"
            elif react_detected:
                # React with no evidence -> default JS (safer in practice).
                lang = "javascript"
            else:
                lang = "python"

    # React overrides when not explicitly set and we have evidence.
    if react_detected and not str(context.get("language") or "").strip():
        if any(e == "tsx" for e in exts) or "typescript" in task_l:
            lang = "typescript"
        elif any(e in {"jsx", "js"} for e in exts):
            lang = "javascript"
        elif not has_files:
            lang = "javascript"

    if not fw:
        if react_detected:
            fw = "react"
        elif "fastapi" in task_l:
            fw = "fastapi"
        elif "spring" in task_l:
            fw = "spring"
        elif "express" in task_l:
            fw = "express"
        elif "asp.net" in task_l or "aspnet" in task_l:
            fw = "aspnet"

    return ExecutionProfile(language=lang, framework=fw)


def read_prompt(name: str) -> str:
    base = Path(__file__).resolve().parent.parent / "prompts"
    path = base / name
    return path.read_text(encoding="utf-8")


def safe_truncate(s: str, *, max_chars: int = 40_000) -> str:
    if not s:
        return ""
    if len(s) <= max_chars:
        return s
    head = s[: max_chars - 2000]
    tail = s[-2000:]
    return head + "\n\n...<truncated>...\n\n" + tail


def ensure_unified_diff(text: str) -> str:
    """Return a properly newline-terminated diff string only when it looks like a diff.

    Acceptable forms:
    - Unified diff containing at least one "diff --git" header
    - Legacy patch text starting with "*** Begin Patch"

    Otherwise returns empty string so callers can treat it as a failure.
    """

    s = (text or "").strip()
    if not s:
        return ""

    if ("diff --git " not in s) and (not s.lstrip().startswith("*** Begin Patch")):
        return ""

    return s + "\n"


def parse_json(text: str) -> dict[str, Any]:
    s = (text or "").strip()

    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", s, flags=re.DOTALL | re.IGNORECASE)
    if m:
        s = m.group(1).strip()

    try:
        obj = json.loads(s)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def bullet_lines(text: str) -> list[str]:
    lines = [ln.strip() for ln in (text or "").splitlines()]
    bullets = [ln for ln in lines if ln.startswith("-")]
    if bullets:
        normalized = [b if b.startswith("- ") else "- " + b[1:].lstrip() for b in bullets]
    else:
        normalized = ["- " + ln for ln in lines if ln]

    return normalized[:12]


def files_payload(files: Iterable[dict[str, Any]] | None, *, max_chars_per_file: int = 12_000) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for f in files or []:
        try:
            path = str(f.get("path") or "").strip()
        except Exception:
            continue
        if not path:
            continue
        content = str(f.get("content") or "")
        out.append({"path": path, "content": safe_truncate(content, max_chars=max_chars_per_file)})
    return out


def is_openai_mode() -> bool:
    return (os.getenv("CODEGEN_LLM_MODE") or "stub").strip().lower() == "openai"
