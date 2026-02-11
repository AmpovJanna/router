# Backend (Grand Router API)

This backend is a minimal FastAPI skeleton, wired to **shared contracts** from `shared/src/grand_router_contracts`.

Phase 4 adds **file-based chat persistence** and chat CRUD endpoints.

Phase 5 adds **LLM-primary routing with deterministic guardrails**.

Phase 6 adds **dynamic agent loading** from the declarative registry:

- `service_directory/agents.json`

Each agent registry entry contains an `entrypoint` in the form `module.path:SymbolName`. At runtime, the API imports that symbol and invokes it via [`invoke_agent()`](grand-router-ai/backend/src/grand_router_api/services/agents/runner.py).

## Persistence storage

Chats + messages are stored in a single JSON file:

- `backend/data/store.json`

Writes are "atomic-ish" on Windows: the backend writes a temp file then replaces the target via `os.replace()`.

You can override the path with:

- `GRAND_ROUTER_STORE_PATH` (env var)

## Requirements

- Windows
- Python 3.11+ recommended

## Setup (cmd.exe)

From the repo root:

```bat
cd grand-router-ai\backend
python -m venv .venv
.venv\Scripts\activate
python -m pip install -U pip
pip install -e .
pip install -e ..\shared
```

## Run (cmd.exe)

```bat
cd grand-router-ai\backend
.venv\Scripts\activate
uvicorn grand_router_api.main:app --host 127.0.0.1 --port 8000
```

OpenAPI:

- http://127.0.0.1:8000/docs

## Routing (Phase 5)

### LLM routing env vars

- `ROUTER_LLM_MODE` = `stub` | `openai` (default: `stub`)
- `OPENAI_API_KEY` (required if `ROUTER_LLM_MODE=openai`)
- `OPENAI_BASE_URL` (optional; OpenAI-compatible proxy base URL)
- `OPENAI_MODEL` (default: `gpt-4o-mini`)

Notes:
- In `stub` mode, the router simulates an LLM JSON response but still parses + validates it against [`RouterRouteResponse`](grand-router-ai/shared/src/grand_router_contracts/router.py:43).
- In `openai` mode, non-JSON model output is rejected and converted into a clarification response.

Known limitation (persistence): when `persist=true` and `chat_id` is omitted, the backend auto-creates a chat but does not return the new `chat_id` in the `/router/execute` response yet.

## Curl examples (cmd.exe)

### Create chat

```bat
curl -X POST http://127.0.0.1:8000/api/v1/chats ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"New chat\"}"
```

### List chats

```bat
curl http://127.0.0.1:8000/api/v1/chats
```

### Append message (with artifacts)

```bat
curl -X POST http://127.0.0.1:8000/api/v1/chats/CHAT_ID/messages ^
  -H "Content-Type: application/json" ^
  -d "{\"role\":\"assistant\",\"content\":\"Here is a plan\",\"routing_meta\":{\"agent_id\":\"projplan\",\"confidence\":0.9,\"mode\":\"auto\"},\"artifacts\":[{\"type\":\"project_plan\",\"plan\":\"...\"}]}"
```

### Get chat (chat + messages)

```bat
curl http://127.0.0.1:8000/api/v1/chats/CHAT_ID
```

### Health

```bat
curl http://127.0.0.1:8000/api/v1/health
```

### Agent invoke

```bat
curl -X POST http://127.0.0.1:8000/api/v1/agents/codegen/invoke ^
  -H "Content-Type: application/json" ^
  -d "{\"agent_id\":\"codegen\",\"task\":\"Add a hello endpoint\",\"context\":{}}"
```

### Verify dynamic invocation import works

From repo root:

```bat
python -c "import sys; sys.path[:0]=['src','..\\shared\\src']; from grand_router_api.services.agents.runner import invoke_agent; print('ok')"
```

### Router route (auto mode, LLM stub)

```bat
set ROUTER_LLM_MODE=stub

curl -X POST http://127.0.0.1:8000/api/v1/router/route ^
  -H "Content-Type: application/json" ^
  -d "{\"query\":\"Create a project plan for phase 4\",\"context\":{}}"
```

### Router route (forced mode bypasses LLM)

```bat
curl -X POST http://127.0.0.1:8000/api/v1/router/execute ^
  -H "Content-Type: application/json" ^
  -d "{\"query\":\"Create a project plan\",\"context\":{},\"mode\":\"forced\",\"forced_agent_id\":\"projplan\",\"persist\":false}"
```

### Router execute

Without persistence:

```bat
curl -X POST http://127.0.0.1:8000/api/v1/router/execute ^
  -H "Content-Type: application/json" ^
  -d "{\"query\":\"Implement routing stubs\",\"context\":{},\"mode\":\"auto\",\"persist\":false}"
```

With persistence (auto-creates chat if `chat_id` missing):

```bat
curl -X POST http://127.0.0.1:8000/api/v1/router/execute ^
  -H "Content-Type: application/json" ^
  -d "{\"query\":\"Implement routing stubs\",\"context\":{},\"mode\":\"auto\",\"persist\":true}"
```

Get the created chat (paste the `chat_id` returned from the execute response):

```bat
curl http://127.0.0.1:8000/api/v1/chats/PASTE_CHAT_ID_HERE
```

With persistence (existing chat):

```bat
curl -X POST http://127.0.0.1:8000/api/v1/router/execute ^
  -H "Content-Type: application/json" ^
  -d "{\"query\":\"Implement routing stubs\",\"chat_id\":\"CHAT_ID\",\"context\":{},\"mode\":\"auto\",\"persist\":true}"
```
