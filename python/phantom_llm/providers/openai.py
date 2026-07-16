"""OpenAI provider. Uses function calling with our neutral schema."""

from __future__ import annotations

import base64
import json
import os

from .. import prompts
from ..schema import ACTION_TOOL, PLAN_TOOL, as_openai_tool, normalize_action_dict, normalize_plan_dict
from .base import ActionDecision, DecideRequest, LLMProvider, PlanRequest, SubTask


class OpenAIProvider(LLMProvider):
    name = "openai"

    def __init__(self, api_key: str = "", endpoint: str = "", model: str | None = None):
        from openai import AsyncOpenAI

        super().__init__(api_key, endpoint, model)
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self.model = model or os.environ.get("PHANTOM_OPENAI_MODEL", "gpt-4o")
        self.client = AsyncOpenAI(api_key=self.api_key, base_url=endpoint or None)

    def _user_content(self, req: DecideRequest) -> list[dict]:
        content: list[dict] = [{"type": "text", "text": self.build_user_text(req)}]
        if req.screenshot:
            content.insert(
                0,
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{base64.b64encode(req.screenshot).decode('ascii')}"
                    },
                },
            )
        return content

    async def plan(self, req: PlanRequest) -> list[SubTask]:
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": prompts.PLANNER_SYSTEM},
                {"role": "user", "content": f"Task: {req.task}\nMode: {req.mode}"},
            ],
            tools=[as_openai_tool(PLAN_TOOL)],
            tool_choice={"type": "function", "function": {"name": "phantom_plan"}},
        )
        args = json.loads(response.choices[0].message.tool_calls[0].function.arguments)
        return [
            SubTask(order=s["order"], description=s["description"], backend=s["backend"])
            for s in normalize_plan_dict(args)
        ]

    async def decide(self, req: DecideRequest) -> ActionDecision:
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": prompts.DECIDER_SYSTEM},
                {"role": "user", "content": self._user_content(req)},
            ],
            tools=[as_openai_tool(ACTION_TOOL)],
            tool_choice={"type": "function", "function": {"name": "phantom_action"}},
        )
        args = json.loads(response.choices[0].message.tool_calls[0].function.arguments)
        d = normalize_action_dict(args)
        return ActionDecision(
            action_type=d["action_type"],
            action=d["action"],
            params=d["params"],
            reasoning=d["reasoning"],
            confidence=d["confidence"],
        )
