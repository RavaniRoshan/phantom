"""Ollama (local) provider. Uses native tool calling with our neutral schema."""

from __future__ import annotations

import base64
import os

from .. import prompts
from ..schema import ACTION_TOOL, PLAN_TOOL, as_openai_tool, normalize_action_dict, normalize_plan_dict
from .base import ActionDecision, DecideRequest, LLMProvider, PlanRequest, SubTask


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(self, api_key: str = "", endpoint: str = "", model: str | None = None):
        import ollama

        super().__init__(api_key, endpoint, model)
        self.model = model or os.environ.get("PHANTOM_OLLAMA_MODEL", "llama3.1")
        host = endpoint or os.environ.get("PHANTOM_OLLAMA_HOST", "http://127.0.0.1:11434")
        self.client = ollama.AsyncClient(host=host)

    async def _call_tool(self, system: str, user_text: str, tool, tool_name: str, images=None):
        response = await self.client.chat(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_text},
            ],
            tools=[as_openai_tool(tool)],
            options={"temperature": 0},
            images=images or [],
        )
        msg = response.message
        if not getattr(msg, "tool_calls", None):
            return {}
        call = msg.tool_calls[0]
        return dict(call.function.arguments or {})

    async def plan(self, req: PlanRequest) -> list[SubTask]:
        args = await self._call_tool(
            prompts.PLANNER_SYSTEM,
            f"Task: {req.task}\nMode: {req.mode}",
            PLAN_TOOL,
            "phantom_plan",
        )
        return [
            SubTask(order=s["order"], description=s["description"], backend=s["backend"])
            for s in normalize_plan_dict(args)
        ]

    async def decide(self, req: DecideRequest) -> ActionDecision:
        images = [base64.b64encode(req.screenshot).decode("ascii")] if req.screenshot else []
        args = await self._call_tool(
            prompts.DECIDER_SYSTEM,
            self.build_user_text(req),
            ACTION_TOOL,
            "phantom_action",
            images=images,
        )
        d = normalize_action_dict(args)
        return ActionDecision(
            action_type=d["action_type"],
            action=d["action"],
            params=d["params"],
            reasoning=d["reasoning"],
            confidence=d["confidence"],
        )
