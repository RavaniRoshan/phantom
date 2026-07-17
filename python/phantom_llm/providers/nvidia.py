"""NVIDIA NIM provider — zero-cost visual reasoning for Phantom.

NVIDIA NIM exposes an **OpenAI-compatible** REST API at
``https://integrate.api.nvidia.com/v1`` and hosts free-tier vision models such as
``meta/llama-3.2-90b-vision-instruct``. We use it to exercise the full
observe→decide→execute loop with *real* screenshots at no cost, proving the
architecture generalizes to any vision LLM before wiring in paid Claude/GPT-4o.

Design note — why JSON instead of tool calls:
Many NIM vision models do **not** support function/tool calling. Rather than
lock the provider to a specific model's tool support, this adapter asks the model
to emit a single JSON object that matches Phantom's canonical schema, then parses
and runs it through ``normalize_action_dict`` / ``normalize_plan_dict``. The
result is the SAME neutral ``ActionDecision`` / ``SubTask`` shapes every other
provider returns — no vendor lock-in, no schema drift.
"""

from __future__ import annotations

import base64
import json
import os
import re
from typing import Any

from .. import prompts
from ..schema import normalize_action_dict, normalize_plan_dict
from .base import ActionDecision, DecideRequest, LLMProvider, PlanRequest, SubTask

# Default free-tier vision model on NVIDIA NIM. Overridable via env/config.
_DEFAULT_MODEL = "meta/llama-3.2-90b-vision-instruct"
_DEFAULT_ENDPOINT = "https://integrate.api.nvidia.com/v1"

# Instruction appended so the model returns a single machine-parseable object.
_ACTION_JSON_INSTRUCTION = """\
Respond with ONLY a single JSON object (no prose, no markdown fences) of the form:
{
  "action_type": "browser|cli|file|desktop|done",
  "action": "<specific action name, e.g. navigate, click, type_text, run_command, read_file, done>",
  "params": { "<key>": "<string value>", ... },
  "reasoning": "<one sentence>",
  "confidence": <number 0..1>
}
When the task is complete, use action_type "done" and action "done"."""

_PLAN_JSON_INSTRUCTION = """\
Respond with ONLY a single JSON object (no prose, no markdown fences) of the form:
{
  "steps": [
    { "order": 1, "description": "<concrete step>", "backend": "browser|cli|file|desktop" },
    ...
  ]
}"""


def extract_json_object(text: str) -> dict[str, Any]:
    """Pull the first well-formed JSON object out of an LLM text response.

    Robust to: leading/trailing prose, ```json ... ``` fences, and nested
    braces. Returns ``{}`` if no balanced object can be found — callers then
    fall back to schema defaults via ``normalize_*``.
    """
    if not text:
        return {}

    # Strip a fenced code block if present (```json ... ``` or ``` ... ```).
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    candidate = fence.group(1) if fence else text

    # Find the first balanced { ... } span (brace counting, string-aware).
    start = candidate.find("{")
    if start == -1:
        return {}
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(candidate)):
        ch = candidate[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                blob = candidate[start : i + 1]
                try:
                    return json.loads(blob)
                except json.JSONDecodeError:
                    return {}
    return {}


class NvidiaProvider(LLMProvider):
    """OpenAI-compatible NVIDIA NIM provider using JSON-mode responses."""

    name = "nvidia"

    def __init__(self, api_key: str = "", endpoint: str = "", model: str | None = None):
        from openai import AsyncOpenAI

        super().__init__(api_key, endpoint, model)
        self.api_key = (
            api_key
            or os.environ.get("NVIDIA_API_KEY")
            or os.environ.get("PHANTOM_API_KEY", "")
        )
        self.model = model or os.environ.get("PHANTOM_NVIDIA_MODEL", _DEFAULT_MODEL)
        base_url = endpoint or os.environ.get("PHANTOM_NVIDIA_ENDPOINT", _DEFAULT_ENDPOINT)
        self.client = AsyncOpenAI(api_key=self.api_key, base_url=base_url)

    # -- message construction (pure; unit-testable) ------------------------
    def _decide_messages(self, req: DecideRequest) -> list[dict]:
        user_text = f"{self.build_user_text(req)}\n\n{_ACTION_JSON_INSTRUCTION}"
        content: list[dict] = [{"type": "text", "text": user_text}]
        if req.screenshot:
            content.insert(
                0,
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "data:image/png;base64,"
                        + base64.b64encode(req.screenshot).decode("ascii")
                    },
                },
            )
        return [
            {"role": "system", "content": prompts.DECIDER_SYSTEM},
            {"role": "user", "content": content},
        ]

    def _plan_messages(self, req: PlanRequest) -> list[dict]:
        return [
            {"role": "system", "content": prompts.PLANNER_SYSTEM},
            {
                "role": "user",
                "content": f"Task: {req.task}\nMode: {req.mode}\n\n{_PLAN_JSON_INSTRUCTION}",
            },
        ]

    # -- inference ---------------------------------------------------------
    async def decide(self, req: DecideRequest) -> ActionDecision:
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=self._decide_messages(req),
            temperature=0.0,
            max_tokens=1024,
        )
        raw = extract_json_object(response.choices[0].message.content or "")
        d = normalize_action_dict(raw)
        return ActionDecision(
            action_type=d["action_type"],
            action=d["action"],
            params=d["params"],
            reasoning=d["reasoning"],
            confidence=d["confidence"],
        )

    async def plan(self, req: PlanRequest) -> list[SubTask]:
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=self._plan_messages(req),
            temperature=0.0,
            max_tokens=1024,
        )
        raw = extract_json_object(response.choices[0].message.content or "")
        return [
            SubTask(order=s["order"], description=s["description"], backend=s["backend"])
            for s in normalize_plan_dict(raw)
        ]
