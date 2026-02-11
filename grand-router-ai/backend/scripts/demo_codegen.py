from __future__ import annotations

import json
import os

from grand_router_contracts.agent import AgentId, AgentInvokeRequest

from grand_router_api.services.agents.codegen.agent import CodegenAgent


def main() -> None:
    # Default to stub mode for offline runs.
    os.environ.setdefault("CODEGEN_LLM_MODE", "stub")

    # Optional: log raw subagent outputs to terminal (off by default).
    # WARNING: this can include code/prompt content. Do not enable with secrets.
    os.environ.setdefault("CODEGEN_SUBAGENT_REASONING_LOG", "0")

    # Two small files + an error log to demonstrate bugfix flow.
    files = [
        {
            "path": "app/math_utils.py",
            "content": (
                "def divide(a: float, b: float) -> float:\n"
                "    # BUG: division by zero not handled\n"
                "    return a / b\n"
            ),
        },
        {
            "path": "app/main.py",
            "content": (
                "from app.math_utils import divide\n\n"
                "def run() -> None:\n"
                "    print(divide(10, 0))\n\n"
                "if __name__ == '__main__':\n"
                "    run()\n"
            ),
        },
    ]

    error_logs = "ZeroDivisionError: float division by zero\n  at divide (app/math_utils.py:3)"

    req = AgentInvokeRequest(
        agent_id=AgentId.codegen,
        task="Fix divide() to handle division by zero and add a small testable design (no new deps).",
        context={
            "language": "python",
            "framework": "",
            "goal": "bugfix",
            "constraints": ["solid", "no new deps", "prefer smallest change"],
            "files": files,
            "error_logs": error_logs,
            # New: enable dedicated debug+fix subagent flow + optional project scan context.
            "debug_fix": True,
            "project_scan": True,
            # demo runs from backend/scripts so repo root is one level up.
            "project_root": "..",
        },
    )

    resp = CodegenAgent().invoke(req)
    print(resp.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
