"""Unit tests for the neutral schema — the heart of provider-agnosticism.

These tests prove that whatever a provider returns, the normalization step
collapses it into one consistent shape (the guarantee of no vendor lock-in).
They do NOT require any provider SDK to be installed (imports are lazy).
"""

import sys
from pathlib import Path

# Make the package importable when running pytest from the python/ dir.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from phantom_llm.schema import (
    ACTION_TOOL,
    PLAN_TOOL,
    as_gemini_function,
    as_openai_tool,
    normalize_action_dict,
    normalize_plan_dict,
)
from phantom_llm.providers import build_provider
from phantom_llm.providers.base import ActionDecision, LLMProvider, SubTask


def test_normalize_action_dict_coerces_types():
    d = normalize_action_dict(
        {"action_type": "browser", "action": "navigate", "params": {"url": "https://x.com"}, "confidence": "0.9"}
    )
    assert d["action_type"] == "browser"
    assert d["params"] == {"url": "https://x.com"}
    assert d["confidence"] == 0.9
    assert isinstance(d["confidence"], float)


def test_normalize_action_dict_defaults():
    d = normalize_action_dict({})
    assert d["action_type"] == "done"
    assert d["action"] == "done"
    assert d["params"] == {}
    # An empty dict normalizes to a `done` action, which is always fully
    # confident (nothing left to risk). A real non-done action with no
    # confidence falls back to DEFAULT_CONFIDENCE (0.85) on the server.
    assert d["confidence"] == 1.0


def test_normalize_action_dict_missing_confidence_falls_back():
    # A non-done action whose provider omitted confidence must NOT land at 0.0
    # (that would trip the autonomy gate on every action); it falls back to
    # DEFAULT_CONFIDENCE so the agent can still progress in Safe mode.
    d = normalize_action_dict({"action_type": "file", "action": "read_file", "params": {"path": "x"}})
    assert d["confidence"] == 0.85


def test_normalize_plan_dict_orders_and_fills():
    steps = normalize_plan_dict(
        {"steps": [{"description": "scrape", "backend": "browser"}, {"description": "save", "backend": "file"}]}
    )
    assert [s["order"] for s in steps] == [1, 2]
    assert steps[0]["backend"] == "browser"


def test_provider_tool_adapters_are_consistent():
    oai = as_openai_tool(ACTION_TOOL)
    gem = as_gemini_function(ACTION_TOOL)
    assert oai["type"] == "function"
    assert oai["function"]["name"] == "phantom_action"
    assert gem["name"] == "phantom_action"
    # Both carry the same underlying schema -> neutral contract.
    assert oai["function"]["parameters"] is ACTION_TOOL["parameters"]
    assert gem["parameters"] is ACTION_TOOL["parameters"]


def test_build_provider_rejects_unknown():
    try:
        build_provider("nope")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for unknown provider")


def test_neutrality_pipeline_is_identical_across_fake_providers():
    """Two providers returning differently-shaped raw dicts must normalize to
    the same ActionDecision structure — this is what keeps models comparable."""

    class FakeA(LLMProvider):
        name = "fake_a"

        async def decide(self, req):
            return ActionDecision(**normalize_action_dict({
                "action_type": "file", "action": "write_file",
                "params": {"path": "a", "content": "x"}, "confidence": 1,
            }))

        async def plan(self, req):
            return [SubTask(**s) for s in normalize_plan_dict({"steps": [{"description": "d", "backend": "cli"}]})]

    class FakeB(LLMProvider):
        name = "fake_b"

        async def decide(self, req):
            # Different raw shape, same normalized result.
            return ActionDecision(**normalize_action_dict({
                "action_type": "file", "action": "write_file",
                "params": {"path": "a", "content": "x"}, "confidence": "1.0",
            }))

        async def plan(self, req):
            return [SubTask(**s) for s in normalize_plan_dict({"steps": [{"description": "d", "backend": "cli"}]})]

    import asyncio

    a = asyncio.run(FakeA().decide(None))
    b = asyncio.run(FakeB().decide(None))
    assert a.action_type == b.action_type == "file"
    assert a.params == b.params
    assert a.confidence == b.confidence == 1.0
