"""Anthropic Claude provider (primary). Uses native tool_use + our schema.

We deliberately use generic ``tool_use`` with OUR neutral schema rather than
Anthropic's Anthropic-specific ``computer_use`` tool, so behaviour is comparable
to every other provider and there is no lock-in.
"""

from __future__ import annotations

import base64
import os

from .. import prompts
from ..schema import (
    CANONICAL_ACTION_SCHEMA,
    PLAN_SCHEMA,
    normalize_action_dict,
    normalize_plan_dict,
)
from .base import (
    ActionDecision,
    DecideRequest,
    LLMProvider,
    PlanRequest,
    SubTask,
)


class ClaudeProvider(LLMProvider):
    name = "claude"

    def __init__(self, api_key: str = "", endpoint: str = "", model: str | None = None):
        import anthropic

        super().__init__(api_key, endpoint, model)
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        self.model = model or os.environ.get("PHANTOM_CLAUDE_MODEL", "claude-sonnet-4-5")
        self.client = anthropic.AsyncAnthropic(api_key=self.api_key)

    def _action_tool(self) -> dict:
        return {
            "name": "phantom_action",
            "description": (
                "Carry out the next step of the user's task using one capability. "
                "Always include a `confidence` between 0 and 1 expressing how sure "
                "you are the action is correct; use a lower value when the screen "
                "state is ambiguous so a human can review it."
            ),
            "input_schema": CANONICAL_ACTION_SCHEMA,
        }

    def _plan_tool(self) -> dict:
        return {
            "name": "phantom_plan",
            "description": "Decompose the user's task into an ordered list of backend-specific subtasks.",
            "input_schema": PLAN_SCHEMA,
        }

    @staticmethod
    def _extract_tool_input(response) -> dict:
        for block in response.content:
            if getattr(block, "type", None) == "tool_use":
                return dict(block.input or {})
        return {}

    def _user_content(self, req: DecideRequest) -> list[dict]:
        content: list[dict] = []
        if req.screenshot:
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": base64.b64encode(req.screenshot).decode("ascii"),
                    },
                }
            )
        content.append({"type": "text", "text": self.build_user_text(req)})
        return content

    async def plan(self, req: PlanRequest) -> list[SubTask]:
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=2048,
            system=prompts.PLANNER_SYSTEM,
            messages=[{"role": "user", "content": f"Task: {req.task}\nMode: {req.mode}"}],
            tools=[self._plan_tool()],
            tool_choice={"type": "tool", "name": "phantom_plan"},
        )
        args = self._extract_tool_input(response)
        return [
            SubTask(order=s["order"], description=s["description"], backend=s["backend"])
            for s in normalize_plan_dict(args)
        ]

    async def decide(self, req: DecideRequest) -> ActionDecision:
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=1536,
            system=prompts.DECIDER_SYSTEM,
            messages=[{"role": "user", "content": self._user_content(req)}],
            tools=[self._action_tool()],
            tool_choice={"type": "tool", "name": "phantom_action"},
        )
        d = normalize_action_dict(self._extract_tool_input(response))
        return ActionDecision(
            action_type=d["action_type"],
            action=d["action"],
            params=d["params"],
            reasoning=d["reasoning"],
            confidence=d["confidence"],
        )
