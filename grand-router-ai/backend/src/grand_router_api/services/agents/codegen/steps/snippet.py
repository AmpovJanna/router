from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class SnippetFile:
    path: str
    content: str


@dataclass(frozen=True)
class SnippetResult:
    """Parsed snippet output.

    If the model returns a text-only explanation (no `// File:` blocks), this is still valid:
    - files=[]
    - is_chat_only=True
    """

    files: list[SnippetFile]
    is_chat_only: bool
    text: str


_FILE_RE = re.compile(r"^//\s*File:\s+(.+?)\s*$", flags=re.MULTILINE)


def parse_snippet(output: str) -> SnippetResult:
    """Parse snippet output into file blocks.

    Expected format for file blocks:
    - Lines starting with: `// File: path/to/file.ext`
    - File content continues until the next `// File:` line or end-of-text.

    If there are zero file blocks, treat as chat/explanation output.
    """

    s = (output or "").replace("\r\n", "\n").strip()
    if not s:
        return SnippetResult(files=[], is_chat_only=True, text="")

    matches = list(_FILE_RE.finditer(s))
    if not matches:
        return SnippetResult(files=[], is_chat_only=True, text=s)

    files: list[SnippetFile] = []
    for i, m in enumerate(matches):
        path = (m.group(1) or "").strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(s)
        content = s[start:end].lstrip("\n")
        if content and not content.endswith("\n"):
            content += "\n"

        if path:
            files.append(SnippetFile(path=path, content=content))

    return SnippetResult(files=files, is_chat_only=False, text=s)
