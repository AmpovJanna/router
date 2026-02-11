from __future__ import annotations

import fnmatch
import os
import re
from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class ScanResult:
    file_tree: list[str]
    grep_hits: list[str]


_DEFAULT_EXCLUDE_DIRS = {
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    "node_modules",
    "dist",
    "build",
    ".next",
}


def _safe_relpath(path: str, root: str) -> str:
    try:
        rel = os.path.relpath(path, root)
    except Exception:
        rel = path
    return rel.replace("\\", "/")


def _iter_files(*, root_dir: str, max_files: int, exclude_dirs: set[str]) -> Iterable[str]:
    count = 0
    for dirpath, dirnames, filenames in os.walk(root_dir):
        dirnames[:] = [d for d in dirnames if d not in exclude_dirs]
        for name in filenames:
            yield os.path.join(dirpath, name)
            count += 1
            if count >= max_files:
                return


def scan_project(
    *,
    root_dir: str,
    include_globs: list[str],
    regexes: list[str],
    max_files: int = 600,
    max_hits: int = 80,
    exclude_dirs: set[str] | None = None,
) -> ScanResult:
    """Lightweight project scan to provide extra context for debug/fix.

    Designed to be:
    - deterministic
    - reasonably fast
    - safe to run on server (no subprocess)

    It returns a file tree subset (matching include_globs) and a limited set of grep-like hits.
    """

    ex_dirs = set(exclude_dirs or set()) | _DEFAULT_EXCLUDE_DIRS

    file_tree: list[str] = []
    grep_hits: list[str] = []

    compiled: list[re.Pattern[str]] = []
    for rx in regexes or []:
        try:
            compiled.append(re.compile(rx, flags=re.IGNORECASE))
        except re.error:
            # Ignore bad patterns; caller owns regex quality.
            continue

    for abs_path in _iter_files(root_dir=root_dir, max_files=max_files, exclude_dirs=ex_dirs):
        rel = _safe_relpath(abs_path, root_dir)

        if any(fnmatch.fnmatch(rel, g) for g in (include_globs or [])):
            file_tree.append(rel)

        if not compiled:
            continue

        # Only scan text-ish files (best-effort): skip very large files.
        try:
            if os.path.getsize(abs_path) > 600_000:
                continue
        except OSError:
            continue

        try:
            with open(abs_path, "rb") as f:
                data = f.read()
        except OSError:
            continue

        # Decode with replacement to avoid crashes.
        text = data.decode("utf-8", errors="replace")
        if "\x00" in text:
            continue

        lines = text.splitlines()
        for i, ln in enumerate(lines, start=1):
            for pat in compiled:
                if pat.search(ln):
                    grep_hits.append(f"{rel}:{i} | {ln.strip()[:240]}")
                    if len(grep_hits) >= max_hits:
                        return ScanResult(file_tree=sorted(set(file_tree))[:500], grep_hits=grep_hits)

    return ScanResult(file_tree=sorted(set(file_tree))[:500], grep_hits=grep_hits)
