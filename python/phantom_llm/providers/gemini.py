"""Google Gemini provider. Uses functionDeclarations with our neutral schema."""

from __future__ import annotations

import base64
import os

from .. import prompts
from ..schema import ACTION_TOOL, PLAN_TOOL, as_gemini_function, normalize_action_dict, normalize_plan_dict
from .base import ActionDecision, DecideRequest, LLMProvider, PlanRequest, SubTask


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(self, api_key: str = "", endpoint: str = "", model: str | None = None):
        import google.generativeai as genai

        super().__init__(api_key, endpoint, model)
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY", "")
        self.model = model or os.environ.get("PHANTOM_GEMINI_MODEL", "gemini-1.5-pro")
        genai.configure(api_key=self.api_key)
        self._genai = genai

    def _model(self, tool):
        return self._genai.GenerativeModel(
            model_name=self.model,
            system_instruction=prompts.DECIDER_SYSTEM,
            tools=[{"function_declarations": [as_gemini_function(tool)]}],
        )

    def _contents(self, req: DecideRequest) -> list[dict]:
        parts = []
        if req.screenshot:
            parts.append(
                {
                    "inline_data": {
                        "mime_type": "image/png",
                        "data": base64.b64encode(req.screenshot).decode("ascii"),
                    }
                }
            )
        parts.append({"text": self.build_user_text(req)})
        return [{"role": "user", "parts": parts}]

    @staticmethod
    def _call_args(response) -> dict:
        part = response.candidates[0].content.parts[0]
        return dict(part.function_call.args or {})

    async def plan(self, req: PlanRequest) -> list[SubTask]:
        model = self._genai.GenerativeModel(
            model_name=self.model,
            system_instruction=prompts.PLANNER_SYSTEM,
            tools=[{"function_declarations": [as_gemini_function(PLAN_TOOL)]}],
        )
        tool_config = {
            "function_calling_config": {
                "mode": "ANY",
                "allowed_function_names": ["phantom_plan"],
            }
        }
        response = await model.generate_content_async(
            [{"role": "user", "parts": [{"text": f"Task: {req.task}\nMode: {req.mode}"}]}],
            tool_config=tool_config,
        )
        return [
            SubTask(order=s["order"], description=s["description"], backend=s["backend"])
            for s in normalize_plan_dict(self._call_args(response))
        ]

    async def decide(self, req: DecideRequest) -> ActionDecision:
        model = self._model(ACTION_TOOL)
        tool_config = {
            "function_calling_config": {
                "mode": "ANY",
                "allowed_function_names": ["phantom_action"],
            }
        }
        response = await model.generate_content_async(
            self._contents(req), tool_config=tool_config
        )
        d = normalize_action_dict(self._call_args(response))
        return ActionDecision(
            action_type=d["action_type"],
            action=d["action"],
            params=d["params"],
            reasoning=d["reasoning"],
            confidence=d["confidence"],
        )
