"""Provider base class and shared request/response types.

All providers share these dataclasses and the neutral schema in
``phantom_llm.schema``. The only provider-specific code is how each SDK is
called and how its native tool-call output is read back — every provider
returns the SAME ``ActionDecision`` / ``list[SubTask]`` shapes.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any, AsyncIterator


@dataclass
class ActionDecision:
    action_type: str
    action: str
    params: dict[str, str] = field(default_factory=dict)
    reasoning: str = ""
    confidence: float = 0.0


@dataclass
class SubTask:
    order: int
    description: str
    backend: str


@dataclass
class ThinkingChunk:
    text: str
    phase: str  # planning | executing | observing


@dataclass
class DecideRequest:
    task_description: str
    current_context: str = ""
    screenshot: bytes | None = None
    history: list[tuple[str, str, bool]] = field(default_factory=list)
    mode: str = "safe"
    backend: str = ""


@dataclass
class PlanRequest:
    task: str
    mode: str = "safe"


class LLMProvider(abc.ABC):
    """A neutral LLM backend. Subclasses implement ``decide`` and ``plan``."""

    name: str = "base"

    def __init__(self, api_key: str = "", endpoint: str = "", model: str | None = None):
        self.api_key = api_key
        self.endpoint = endpoint
        self.model = model

    @abc.abstractmethod
    async def decide(self, req: DecideRequest) -> ActionDecision:
        """Return the single next action for the current state."""

    @abc.abstractmethod
    async def plan(self, req: PlanRequest) -> list[SubTask]:
        """Decompose a task into ordered backend-specific subtasks."""

    async def stream(self, req: DecideRequest) -> AsyncIterator[ThinkingChunk]:
        """Default streaming: surface the decision as reasoning chunks.

        Providers may override this with true token streaming from their SDK.
        """
        yield ThinkingChunk("Analyzing task and current state...", "planning")
        decision = await self.decide(req)
        if decision.reasoning:
            yield ThinkingChunk(decision.reasoning, "executing")
        yield ThinkingChunk(
            f"Next: [{decision.action_type}] {decision.action}", "observing"
        )

    # --- shared helpers ---------------------------------------------------
    @staticmethod
    def build_user_text(req: DecideRequest) -> str:
        lines: list[str] = [f"Task: {req.task_description}"]
        if req.backend:
            lines.append(f"Active backend: {req.backend}")
        lines.append(f"Mode: {req.mode}")
        if req.current_context:
            lines.append(f"Current state:\n{req.current_context}")
        if req.history:
            lines.append("Actions taken so far:")
            for action, result, ok in req.history:
                lines.append(f"  - {action} -> {'OK' if ok else 'FAIL'}: {result}")
        lines.append("Return the single next action using the phantom_action tool.")
        return "\n".join(lines)
