"""Demo: CodegenAgent verification step cleaning.

Run:
  python -m backend.scripts.demo_verify_steps

Note: This script is for local development/demo purposes.
"""

from __future__ import annotations

import json

from grand_router_api.services.agents.codegen.agent import CodegenAgent
from grand_router_contracts.agent import AgentInvokeRequest


def main() -> None:
    agent = CodegenAgent()

    # Java greenfield task that tends to produce overly generic verification steps.
    req = AgentInvokeRequest(
        agent_id=agent.agent_id,
        task=(
            "Create classes User and Employee and a Main entrypoint that demonstrates usage. "
            "Keep everything in the default package."
        ),
        context={},
    )

    resp = agent.invoke(req)
    steps: list[str] = []
    for art in resp.artifacts:
        if getattr(art, "type", None) == "verification_steps":
            steps = list(getattr(art, "verification_steps", []) or [])
            break

    print(json.dumps({"status": str(resp.status), "verification_steps": steps}, indent=2))


if __name__ == "__main__":
    main()
