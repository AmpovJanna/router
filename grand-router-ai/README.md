# Grand Router AI (v1)

Monorepo skeleton for a deterministic “Grand Router” system:

- **Router**: accepts a user query and returns a standardized JSON routing decision.
- **Top-level agents (v1)**: `codegen`, `projplan`.
- **Shared contracts**: one canonical Python package (pydantic models) under `shared/`.
- **Backend**: FastAPI app under `backend/`.
- **Frontend**: placeholder only for now.

This repo intentionally contains minimal implementation. See:
- `docs/architecture.md`
- `docs/contracts.md`
- `service_directory/agents.json`
- `samples/v1/`
- `evaluation/`
