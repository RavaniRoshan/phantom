"""Deterministic, offline mock provider.

This provider needs **no SDK and no API key**. It produces sensible, rule-based
plans and actions purely from the task text and the running action history. Its
purpose is to let the *entire* Phantom stack — Rust agent loop, gRPC transport,
and Python service — run and be tested end-to-end without a paid model.

It is intentionally simple but not trivial: it routes a task to a backend by
keyword, walks a short scripted sequence per backend, and terminates with a
``done`` action so the observe→decide→execute loop actually converges. Because
it is fully deterministic, it is ideal for integration tests and demos.
"""

from __future__ import annotations

import re

from .base import (
    ActionDecision,
    DecideRequest,
    LLMProvider,
    PlanRequest,
    SubTask,
)

# Keyword → backend routing. First match wins; order matters (most specific first).
_ROUTING: list[tuple[str, str]] = [
    (r"\b(https?://|www\.|browse|website|web page|navigate|search the web|google)\b", "browser"),
    (r"\b(file|folder|directory|read|write|save|copy|move|delete|\.txt|\.md|\.json|\.csv)\b", "file"),
    (r"\b(run|command|powershell|shell|process|install|script|execute)\b", "cli"),
    (r"\b(app|application|window|gui|desktop|click on|button)\b", "desktop"),
]

# A URL anywhere in the text (used to fill browser navigate params).
_URL_RE = re.compile(r"https?://[^\s'\"]+")


def _route(task: str) -> str:
    """Pick a backend for a task by keyword. Defaults to ``browser``."""
    low = task.lower()
    for pattern, backend in _ROUTING:
        if re.search(pattern, low):
            return backend
    return "browser"


def _first_url(text: str) -> str:
    m = _URL_RE.search(text)
    return m.group(0) if m else "https://example.com"


class MockProvider(LLMProvider):
    """Offline, deterministic provider. No network, no SDK, no key required."""

    name = "mock"

    def __init__(self, api_key: str = "", endpoint: str = "", model: str | None = None):
        super().__init__(api_key, endpoint, model)
        self.model = model or "mock-1"

    # -- planning ----------------------------------------------------------
    async def plan(self, req: PlanRequest) -> list[SubTask]:
        backend = _route(req.task)
        # A minimal but coherent two/three-step plan per backend.
        if backend == "browser":
            steps = [
                ("Open the target web page", "browser"),
                ("Extract the requested information", "browser"),
            ]
        elif backend == "file":
            steps = [
                ("Locate the relevant file(s)", "file"),
                ("Read or modify the file as requested", "file"),
            ]
        elif backend == "cli":
            steps = [("Run the requested command", "cli")]
        else:  # desktop
            steps = [
                ("Open the target application", "desktop"),
                ("Interact with the application", "desktop"),
            ]
        return [
            SubTask(order=i + 1, description=desc, backend=be)
            for i, (desc, be) in enumerate(steps)
        ]

    # -- deciding ----------------------------------------------------------
    async def decide(self, req: DecideRequest) -> ActionDecision:
        backend = req.backend or _route(req.task_description)
        step = len(req.history)  # how many actions already taken

        if backend == "browser":
            return self._browser_step(req, step)
        if backend == "file":
            return self._file_step(req, step)
        if backend == "cli":
            return self._cli_step(req, step)
        if backend == "desktop":
            return self._desktop_step(req, step)
        return self._done("unknown backend; nothing to do")

    # -- per-backend scripted sequences -----------------------------------
    def _browser_step(self, req: DecideRequest, step: int) -> ActionDecision:
        if step == 0:
            url = _first_url(req.task_description)
            return ActionDecision(
                action_type="browser",
                action="navigate",
                params={"url": url},
                reasoning=f"Navigate to {url} to begin the task.",
                confidence=0.9,
            )
        if step == 1:
            return ActionDecision(
                action_type="browser",
                action="extract_content",
                params={"selector": "body"},
                reasoning="Extract page content to satisfy the task.",
                confidence=0.8,
            )
        return self._done("Browser task complete.")

    def _file_step(self, req: DecideRequest, step: int) -> ActionDecision:
        if step == 0:
            return ActionDecision(
                action_type="file",
                action="list_dir",
                params={"path": "."},
                reasoning="List the working directory to locate relevant files.",
                confidence=0.85,
            )
        return self._done("File task complete.")

    def _cli_step(self, req: DecideRequest, step: int) -> ActionDecision:
        if step == 0:
            return ActionDecision(
                action_type="cli",
                action="run_command",
                params={"command": "echo phantom"},
                reasoning="Run a harmless command to demonstrate CLI execution.",
                confidence=0.7,
            )
        return self._done("CLI task complete.")

    def _desktop_step(self, req: DecideRequest, step: int) -> ActionDecision:
        if step == 0:
            return ActionDecision(
                action_type="desktop",
                action="screenshot",
                params={},
                reasoning="Capture the current desktop to observe application state.",
                confidence=0.6,
            )
        return self._done("Desktop task complete.")

    @staticmethod
    def _done(reason: str) -> ActionDecision:
        return ActionDecision(
            action_type="done",
            action="done",
            params={},
            reasoning=reason,
            confidence=1.0,
        )
