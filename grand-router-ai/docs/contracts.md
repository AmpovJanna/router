# Contracts

Canonical JSON contracts are defined once in the shared Python package:
- `shared/src/grand_router_contracts/*.py`

All request/response payloads include an explicit `api_version`.

Contract families:
- Router: Route (decision) and Execute (decision + invocation)
- Agent invocation
- Artifacts (patch, verification_steps, project_plan, risks, next_steps)
- Chat + Message models

Samples live in `samples/v1/`.
