"""The neutral action schema — the single source of truth for Phantom.

Every LLM provider (Claude, OpenAI, Gemini, Ollama) maps its *native* tool /
function-calling format onto THIS schema. Because the schema is identical
everywhere, model behaviour is comparable and there is no vendor lock-in.

This module is intentionally dependency-free (pure data + helpers) so it can be
imported by every provider adapter without pulling in provider SDKs.
"""

from __future__ import annotations

import base64
import math
from typing import Any

# Fallback confidence when a provider does not report one. Most tool-calling
# models (Claude, GPT-4o, Gemini, Ollama) do not fill the optional `confidence`
# field, so without this they would arrive as 0.0 and the Rust-side autonomy
# gate would pause/skip EVERY action. "Model didn't say" must mean "moderately
# confident" — high enough to auto-run under the default 0.70 gate, low enough
# that an explicit low score from a provider (mock, nvidia) still stands out.
DEFAULT_CONFIDENCE = 0.85

# The only legal capability domains for a Phantom action. An action_type outside
# this set is a model/validation error, never something to silently execute.
VALID_ACTION_TYPES = frozenset({"browser", "cli", "file", "desktop", "done"})


class ActionValidationError(ValueError):
    """Raised when model output cannot be safely normalized into an action.

    This is a subclass of ``ValueError`` so the gRPC server can map it to
    ``INVALID_ARGUMENT`` with a single except clause. It exists as a distinct
    type so callers can tell "the model produced garbage" from other ValueErrors.
    """


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
    "description": (
        "Carry out the next step of the user's task using one capability. "
        "Always include a `confidence` between 0 and 1 expressing how sure you "
        "are the action is correct; use a lower value when the screen state is "
        "ambiguous so a human can review it."
    ),
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
def normalize_action_dict(d: Any, *, strict: bool = True) -> dict[str, Any]:
    """Coerce a provider's raw action dict into the canonical shape.

    ``strict=True`` (the default, and the only mode the gRPC server uses) is
    **fail-closed**: a missing/invalid ``action_type`` or ``action`` raises
    :class:`ActionValidationError` instead of silently becoming ``done``. This
    is the fix for the "false success" defect — an empty or malformed model
    output must never be reported to the user as a completed task.

    ``strict=False`` preserves the legacy lenient behaviour (missing fields
    default to ``done``) for tooling that deliberately wants a no-op fallback.
    It is never used on the live decision path.

    Raises:
        ActionValidationError: if ``strict`` and a required field is missing,
            empty, or invalid.
    """
    if not isinstance(d, dict):
        if strict:
            raise ActionValidationError(f"action must be an object, got {type(d).__name__}")
        d = {}
    else:
        d = dict(d)

    action_type = d.get("action_type")
    action = d.get("action")

    if strict:
        # Explicit model intent is required for *every* action — above all for
        # `done`, which must never be inferred from an empty/malformed output.
        if not isinstance(action_type, str) or not action_type.strip():
            raise ActionValidationError("missing or invalid 'action_type'")
        action_type = action_type.strip()
        if action_type not in VALID_ACTION_TYPES:
            raise ActionValidationError(
                f"invalid action_type {action_type!r}; expected one of {sorted(VALID_ACTION_TYPES)}"
            )
        if not isinstance(action, str) or not action.strip():
            raise ActionValidationError("missing or invalid 'action'")
        action = action.strip()
        if action_type == "done" and action != "done":
            raise ActionValidationError("a 'done' action_type requires action == 'done'")
        params = d.get("params", {})
        if not isinstance(params, dict):
            raise ActionValidationError(
                f"'params' must be an object, got {type(params).__name__}"
            )
    else:
        # Legacy lenient path — intentionally kept for offline tooling only.
        if not isinstance(action_type, str) or not action_type.strip():
            action_type = "done"
        if not isinstance(action, str) or not action.strip():
            action = "done"
        params = d.get("params", {})
        if not isinstance(params, dict):
            params = {}

    d["action_type"] = action_type
    d["action"] = action
    d.setdefault("reasoning", "")
    if not isinstance(d["reasoning"], str):
        d["reasoning"] = str(d["reasoning"])

    # Resolve confidence: honour an explicit, valid, in-range value; otherwise
    # substitute a sane default so a provider that omits it (or reports 0 /
    # NaN / garbage) does not trip the autonomy gate on every action. A `done`
    # action is always fully confident (nothing left to risk).
    raw_conf = d.get("confidence", None)
    try:
        conf = float(raw_conf) if raw_conf is not None else None
    except (TypeError, ValueError):
        conf = None
    if conf is None or not math.isfinite(conf) or conf <= 0.0:
        conf = 1.0 if d["action_type"] == "done" else DEFAULT_CONFIDENCE
    d["confidence"] = max(0.0, min(1.0, conf))

    # Params are a string->string map on the wire; coerce defensively.
    d["params"] = {str(k): str(v) for k, v in params.items()}
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
