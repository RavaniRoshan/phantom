"""The neutral action schema — the single source of truth for Phantom.

Every LLM provider (Claude, OpenAI, Gemini, Ollama) maps its *native* tool /
function-calling format onto THIS schema. Because the schema is identical
everywhere, model behaviour is comparable and there is no vendor lock-in.

This module is intentionally dependency-free (pure data + helpers) so it can be
imported by every provider adapter without pulling in provider SDKs.
"""

from __future__ import annotations

import base64
from typing import Any


# ---------------------------------------------------------------------------
# Canonical JSON Schema for a single action (the DecideAction contract).
# ---------------------------------------------------------------------------
CANONICAL_ACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "title": "PhantomAction",
    "description": "A single next action for the Phantom agent.",
    "properties": {
        "action_type": {
            "type": "string",
            "enum": ["browser", "cli", "file", "desktop", "done"],
            "description": "The capability domain this action belongs to.",
        },
        "action": {
            "type": "string",
            "description": (
                "The specific action name, e.g. navigate, click, type_text, "
                "extract_content, read_file, write_file, run_command, "
                "screenshot, done."
            ),
        },
        "params": {
            "type": "object",
            "additionalProperties": {"type": "string"},
            "description": "Action arguments as string key/value pairs.",
        },
        "reasoning": {
            "type": "string",
            "description": "One-sentence rationale for choosing this action.",
        },
        "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "Confidence the action is correct, 0..1.",
        },
    },
    "required": ["action_type", "action", "params"],
}

# Canonical JSON Schema for a plan (the PlanTask contract).
PLAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "title": "PhantomPlan",
    "properties": {
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "order": {"type": "integer"},
                    "description": {"type": "string"},
                    "backend": {
                        "type": "string",
                        "enum": ["browser", "cli", "file", "desktop"],
                    },
                },
                "required": ["order", "description", "backend"],
            },
        }
    },
    "required": ["steps"],
}

# Tool descriptors (provider-neutral "name/description/parameters" shape).
ACTION_TOOL: dict[str, Any] = {
    "name": "phantom_action",
    "description": "Carry out the next step of the user's task using one capability.",
    "parameters": CANONICAL_ACTION_SCHEMA,
}

PLAN_TOOL: dict[str, Any] = {
    "name": "phantom_plan",
    "description": "Decompose the user's task into an ordered list of backend-specific subtasks.",
    "parameters": PLAN_SCHEMA,
}


# ---------------------------------------------------------------------------
# Provider-format adapters — every provider builds its native tool spec from
# the canonical descriptors above, guaranteeing a single shared schema.
# ---------------------------------------------------------------------------
def as_openai_tool(tool: dict[str, Any]) -> dict[str, Any]:
    """OpenAI / Ollama function-calling tool shape."""
    return {
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool["description"],
            "parameters": tool["parameters"],
        },
    }


def as_gemini_function(tool: dict[str, Any]) -> dict[str, Any]:
    """Gemini functionDeclarations entry shape."""
    return {
        "name": tool["name"],
        "description": tool["description"],
        "parameters": tool["parameters"],
    }


# ---------------------------------------------------------------------------
# Normalization — the guarantee of neutrality.
# Whatever the provider returns, we coerce it into these canonical shapes so
# the Rust side always receives a consistent ActionResponse.
# ---------------------------------------------------------------------------
def normalize_action_dict(d: Any) -> dict[str, Any]:
    d = dict(d or {})
    d.setdefault("action_type", "done")
    d.setdefault("action", "done")
    d.setdefault("params", {})
    d.setdefault("reasoning", "")
    try:
        d["confidence"] = float(d.get("confidence", 0.0))
    except (TypeError, ValueError):
        d["confidence"] = 0.0
    params = d["params"]
    d["params"] = (
        {str(k): str(v) for k, v in params.items()}
        if isinstance(params, dict)
        else {}
    )
    return d


def normalize_plan_dict(d: Any) -> list[dict[str, Any]]:
    d = dict(d or {})
    steps = d.get("steps", []) or []
    out: list[dict[str, Any]] = []
    for i, s in enumerate(steps):
        s = dict(s or {})
        out.append(
            {
                "order": int(s.get("order", i + 1)),
                "description": str(s.get("description", "")),
                "backend": str(s.get("backend", "cli")),
            }
        )
    return out


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")
