from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from grand_router_contracts.api_version import API_VERSION
from grand_router_contracts.router import RouterRouteRequest, RouterRouteResponse

from ..agents.registry_models import AgentRegistryEntry


class LLMRouterError(RuntimeError):
    """Raised when LLM routing fails in a non-recoverable way."""


def _read_prompt_template() -> str:
    path = Path(__file__).with_name("prompt.md")
    return path.read_text(encoding="utf-8")


def _env(name: str, default: str | None = None) -> str | None:
    v = os.getenv(name)
    if v is None or v == "":
        return default
    return v


def _value_str(x: object) -> str:
    v = getattr(x, "value", x)
    return "" if v is None else str(v)


def _registry_payload(agents: list[AgentRegistryEntry]) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for a in agents:
        payload.append(
            {
                "agent_id": _value_str(a.agent_id),
                "name": a.name,
                "description": a.description,
                "keywords": list(a.keywords),
                "enabled": bool(a.enabled),
            }
        )
    return payload


def _request_payload(request: RouterRouteRequest) -> dict[str, Any]:
    return {
        "query": request.query,
        "chat_id": request.chat_id,
        "message_id": request.message_id,
        "context": request.context,
        "selected_agent_id": (_value_str(request.selected_agent_id) if request.selected_agent_id else None),
    }


def _stub_llm_output(request: RouterRouteRequest, agents: list[AgentRegistryEntry]) -> str:
    # Simulate an LLM response as raw JSON string (so we still exercise parsing/validation).
    q = request.query.lower()

    # honor explicit selection if present
    if request.selected_agent_id is not None:
        chosen = _value_str(request.selected_agent_id)
    else:
        agent_ids = {_value_str(a.agent_id): a for a in agents if a.enabled}
        if ("plan" in q) or ("milestone" in q) or ("requirements" in q):
            # Canonical planner id is `planner`. `projplan` is a legacy alias and should not be
            # emitted by routing unless it's explicitly enabled in the registry.
            chosen = "planner" if "planner" in agent_ids else next(iter(agent_ids.keys()), "")
        else:
            chosen = "codegen" if "codegen" in agent_ids else next(iter(agent_ids.keys()), "")

    obj: dict[str, Any] = {
        # omit api_version; pydantic will default it
        "routes": (
            []
            if not chosen
            else [
                {
                    "agent_id": chosen,
                    "confidence": 0.9,
                    "subtask": request.query,
                }
            ]
        ),
        "needs_clarification": False if chosen else True,
        "clarifying_questions": ([] if chosen else ["Which agent should handle this request?"]),
        "routing_rationale": "Stub LLM router (simulated).",
    }
    return json.dumps(obj)


def _extract_json_object(text: str) -> str:
    """Best-effort extraction of a single JSON object from model output.

    Handles common cases:
    - wrapped in ```json fences
    - leading/trailing prose

    This does NOT attempt to repair invalid JSON.
    """

    s = (text or "").strip()

    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", s, flags=re.DOTALL | re.IGNORECASE)
    if fence:
        return fence.group(1).strip()

    start = s.find("{")
    end = s.rfind("}")
    if start != -1 and end != -1 and end > start:
        return s[start : end + 1].strip()

    return s


def _call_openai(*, prompt: str, request: RouterRouteRequest, agents: list[AgentRegistryEntry]) -> str:
    api_key = _env("OPENAI_API_KEY")
    if not api_key:
        raise LLMRouterError("OPENAI_API_KEY is required when ROUTER_LLM_MODE=openai")

    base_url = _env("OPENAI_BASE_URL")
    model = _env("OPENAI_MODEL", "gpt-4o-mini") or "gpt-4o-mini"

    try:
        from openai import OpenAI  # type: ignore
    except Exception as e:  # pragma: no cover
        raise LLMRouterError(
            "openai package not available. Install it or use ROUTER_LLM_MODE=stub."
        ) from e

    client = OpenAI(api_key=api_key, base_url=base_url)

    messages = [
        {"role": "system", "content": prompt},
        {
            "role": "user",
            "content": json.dumps(
                {
                    "api_version": API_VERSION,
                    "request": _request_payload(request),
                    "agent_registry": _registry_payload(agents),
                },
                ensure_ascii=False,
            ),
        },
    ]

    # response_format is supported by many OpenAI-compatible APIs; if unsupported it may error.
    # We keep it minimal; output is still parsed/validated independently.
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.0,
            response_format={"type": "json_object"},
        )
    except TypeError:
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.0,
        )

    content = (resp.choices[0].message.content or "").strip()
    return _extract_json_object(content)


def route_with_llm(request: RouterRouteRequest, agents: list[AgentRegistryEntry]) -> RouterRouteResponse:
    """LLM-first routing.

    Behavior is controlled by env vars:
    - ROUTER_LLM_MODE=stub|openai (default stub)
    - OPENAI_API_KEY (required for openai)
    - OPENAI_BASE_URL (optional; OpenAI-compatible proxies)
    - OPENAI_MODEL (default gpt-4o-mini)

    In ALL modes, we parse returned content as JSON and validate via RouterRouteResponse.
    """

    mode = (_env("ROUTER_LLM_MODE", "stub") or "stub").strip().lower()
    prompt = _read_prompt_template()

    if mode == "openai":
        raw = _call_openai(prompt=prompt, request=request, agents=agents)
    else:
        raw = _stub_llm_output(request, agents)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise LLMRouterError(f"LLM returned non-JSON output: {e}") from e

    try:
        return RouterRouteResponse.model_validate(data)
    except Exception as e:
        raise LLMRouterError(f"LLM output failed RouterRouteResponse validation: {e}") from e
