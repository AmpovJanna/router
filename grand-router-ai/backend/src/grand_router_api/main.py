"""FastAPI app entrypoint."""

from __future__ import annotations

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from grand_router_contracts.api_version import API_VERSION

from .logging_config import configure_logging

# Load .env files if present (local dev convenience). In production, prefer real env vars.
from .services.settings.env import load_env

from .api.v1.agents import router as agents_router
from .api.v1.chats import router as chats_router
from .api.v1.router import router as router_router


def _build_v1_router() -> APIRouter:
    v1 = APIRouter(prefix="/api/v1")

    @v1.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "api_version": API_VERSION}

    v1.include_router(agents_router)
    v1.include_router(chats_router)
    v1.include_router(router_router)
    return v1


load_env()
configure_logging()

app = FastAPI(title="Grand Router API", version=API_VERSION)

# Allow the Vite dev server (and other clients) to call this API.
# Without CORS middleware, browsers send OPTIONS preflight and FastAPI returns 405.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(_build_v1_router())
