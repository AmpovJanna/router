from __future__ import annotations

from pathlib import Path


def load_env() -> None:
    """Load local .env files if present.

    This is a dev convenience so the backend can be started without manually exporting
    variables. In production (Docker/K8s/etc.), prefer real environment variables.

    Load order (later does NOT override existing env vars):
    1) <repo_root>/.env
    2) <repo_root>/.env.local

    We intentionally set override=False to avoid surprising production behavior.
    """

    try:
        from dotenv import load_dotenv  # type: ignore
    except Exception:
        # If python-dotenv isn't installed, silently do nothing.
        return

    # backend/src/grand_router_api/services/settings/env.py -> repo root is 5 parents up
    # (env.py -> settings -> services -> grand_router_api -> src -> backend)
    repo_root = Path(__file__).resolve().parents[5]

    load_dotenv(dotenv_path=repo_root / ".env", override=False)
    load_dotenv(dotenv_path=repo_root / ".env.local", override=False)
