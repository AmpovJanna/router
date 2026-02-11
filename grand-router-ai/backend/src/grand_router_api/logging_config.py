from __future__ import annotations

import logging
import os
from typing import Final


_DEFAULT_LEVEL: Final[str] = os.getenv("LOG_LEVEL", "INFO").strip().upper() or "INFO"


def configure_logging() -> None:
    """Configure simple, low-noise console logging.

    Goals:
    - show progress during long-running LLM/codegen operations
    - keep output safe (no prompts / API keys)
    - keep output low-noise (no per-token logs)

    Controlled by env vars:
    - LOG_LEVEL=DEBUG|INFO|WARNING|ERROR (default INFO)

    Note: uvicorn also has its own logging config; this sets up our app logger
    and a reasonable default root handler.
    """

    level = getattr(logging, _DEFAULT_LEVEL, logging.INFO)

    # Avoid double-config when imported multiple times.
    root = logging.getLogger()
    if root.handlers:
        root.setLevel(level)
        return

    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )

    # Reduce known chatty loggers unless explicitly requested.
    if level >= logging.INFO:
        for noisy in [
            "openai",
            "httpx",
            "urllib3",
        ]:
            logging.getLogger(noisy).setLevel(logging.WARNING)
