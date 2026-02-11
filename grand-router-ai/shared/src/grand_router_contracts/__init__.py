"""Shared contract models (single source of truth).

Minimal re-exports for convenient importing.
"""

from .api_version import API_VERSION
from .agent import AgentId, AgentInvokeRequest, AgentInvokeResponse, AgentStatus
from .artifacts import (
    Artifact,
    ArtifactType,
    NextStepsArtifact,
    PatchArtifact,
    ProjectPlanArtifact,
    RisksArtifact,
    VerificationStepsArtifact,
)
from .chat import Chat, Message, MessageRole, RoutingMeta, RoutingMetaMode
from .router import (
    RouteItem,
    RouterExecuteRequest,
    RouterExecuteResponse,
    RouterRouteRequest,
    RouterRouteResponse,
    RoutingMode,
)

__all__ = [
    "API_VERSION",
    "AgentId",
    "AgentInvokeRequest",
    "AgentInvokeResponse",
    "AgentStatus",
    "Artifact",
    "ArtifactType",
    "NextStepsArtifact",
    "PatchArtifact",
    "ProjectPlanArtifact",
    "RisksArtifact",
    "VerificationStepsArtifact",
    "Chat",
    "Message",
    "MessageRole",
    "RoutingMeta",
    "RoutingMetaMode",
    "RouteItem",
    "RouterExecuteRequest",
    "RouterExecuteResponse",
    "RouterRouteRequest",
    "RouterRouteResponse",
    "RoutingMode",
]
