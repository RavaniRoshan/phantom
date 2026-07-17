"""Tests for the NVIDIA NIM provider.

These are fully offline: the robust JSON extractor is a pure function, and the
decide/plan paths are exercised with a fake OpenAI-compatible client so no
network or API key is needed. They prove the provider funnels arbitrary model
text back into Phantom's neutral schema (no vendor lock-in).
"""

import asyncio

import pytest

from phantom_llm.providers.nvidia import extract_json_object
from phantom_llm.providers.base import DecideRequest, PlanRequest


# --- extract_json_object: robustness ------------------------------------
def test_extract_plain_object():
    assert extract_json_object('{"a": 1}') == {"a": 1}


def test_extract_strips_prose_prefix_and_suffix():
    text = 'Sure! Here is the action:\n{"action_type": "done", "action": "done"}\nHope that helps.'
    assert extract_json_object(text) == {"action_type": "done", "action": "done"}


def test_extract_from_markdown_fence():
    text = '```json\n{"action_type": "browser", "action": "navigate"}\n```'
    assert extract_json_object(text)["action"] == "navigate"


def test_extract_handles_nested_braces_and_strings():
    text = '{"params": {"selector": "div > a", "text": "a } brace in a string"}, "confidence": 0.5}'
    out = extract_json_object(text)
    assert out["params"]["selector"] == "div > a"
    assert out["params"]["text"] == "a } brace in a string"
    assert out["confidence"] == 0.5


def test_extract_returns_empty_on_garbage():
    assert extract_json_object("no json here at all") == {}
    assert extract_json_object("") == {}
    assert extract_json_object("{ unbalanced") == {}


# --- decide/plan via a fake OpenAI-compatible client --------------------
class _FakeChatCompletions:
    def __init__(self, content: str):
        self._content = content

    async def create(self, **kwargs):
        # Mirror the openai response shape: .choices[0].message.content
        msg = type("M", (), {"content": self._content})
        choice = type("C", (), {"message": msg})
        return type("R", (), {"choices": [choice]})


class _FakeClient:
    def __init__(self, content: str):
        self.chat = type("Chat", (), {"completions": _FakeChatCompletions(content)})


def _provider_with(content: str):
    """Build an NvidiaProvider without importing the real openai SDK."""
    from phantom_llm.providers.nvidia import NvidiaProvider

    p = NvidiaProvider.__new__(NvidiaProvider)  # bypass __init__ (no SDK/key)
    p.api_key = ""
    p.endpoint = ""
    p.model = "test-model"
    p.client = _FakeClient(content)
    return p


def test_decide_parses_messy_model_output_into_neutral_action():
    p = _provider_with(
        'Okay, I will navigate.\n```json\n'
        '{"action_type":"browser","action":"navigate",'
        '"params":{"url":"https://example.com"},"confidence":"0.9"}\n```'
    )
    d = asyncio.run(p.decide(DecideRequest(task_description="open example.com", backend="browser")))
    assert d.action_type == "browser"
    assert d.action == "navigate"
    assert d.params == {"url": "https://example.com"}
    assert d.confidence == 0.9  # coerced from string by normalize


def test_decide_falls_back_to_done_on_unparseable_output():
    p = _provider_with("I cannot help with that.")
    d = asyncio.run(p.decide(DecideRequest(task_description="whatever")))
    # normalize_action_dict defaults to a safe 'done' when nothing parses.
    assert d.action_type == "done"
    assert d.action == "done"


def test_plan_parses_steps_and_fills_orders():
    p = _provider_with(
        '{"steps":[{"description":"open page","backend":"browser"},'
        '{"description":"save result","backend":"file"}]}'
    )
    steps = asyncio.run(p.plan(PlanRequest(task="research and save")))
    assert [s.order for s in steps] == [1, 2]
    assert steps[0].backend == "browser"
    assert steps[1].backend == "file"


def test_decide_message_shape_includes_image_when_screenshot_present():
    p = _provider_with("{}")
    msgs = p._decide_messages(
        DecideRequest(task_description="t", backend="browser", screenshot=b"\x89PNG")
    )
    user = msgs[-1]["content"]
    # First content part is the image when a screenshot is supplied.
    assert user[0]["type"] == "image_url"
    assert user[0]["image_url"]["url"].startswith("data:image/png;base64,")
    assert user[-1]["type"] == "text"


def test_nvidia_registered_in_provider_list():
    from phantom_llm.providers import available

    assert "nvidia" in available()
