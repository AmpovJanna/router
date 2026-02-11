# Architecture

## Goals
- One Router routes user queries to exactly one top-level agent (`codegen` or `projplan`) for v1.
- Shared JSON contracts are defined once in `shared/`.
- Backend exposes router + agent + chat endpoints.
- Frontend exists as a placeholder.

## Router endpoints
- `POST /api/v1/router/route`: decision only.
- `POST /api/v1/router/execute`: decision + invoke agent + optional persistence.

## Agent registry
- `service_directory/agents.json` is the declarative source of available top-level agents.

## Persistence
- `services/persistence/interface.py`: abstraction.
- `services/persistence/file_store.py`: file-based v1 implementation.
