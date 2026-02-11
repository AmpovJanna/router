from __future__ import annotations

from grand_router_api.services.agents.registry import list_agents


def main() -> None:
    for a in list_agents():
        print(f"{a.agent_id}: {a.name}")
        print(f"  enabled: {a.enabled}")
        if a.version is not None:
            print(f"  version: {a.version}")
        print(f"  keywords: {', '.join(a.keywords)}")
        print(f"  entrypoint: {a.entrypoint}")


if __name__ == "__main__":
    main()
