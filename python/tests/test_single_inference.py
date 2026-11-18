"""W0.3 — one inference per step (DEV-PLAN section 5, Days 3-4).

    python -m unittest discover -s python/tests -p 'test_single_inference.py' -v
"""

import asyncio
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from phantom_llm.providers.base import (  # noqa: E402
    ActionDecision,
    DecideRequest,
    LLMProvider,
)


class CountingProvider(LLMProvider):
    name = "counting"

    def __init__(self):
        super().__init__()
        self.decide_calls = 0

    async def decide(self, req):
        self.decide_calls += 1
        return ActionDecision("done", "done", reasoning="finished", confidence=1.0)

    async def plan(self, req):
        return []


class SingleInferenceTest(unittest.TestCase):
    def test_default_stream_does_not_call_decide(self):
        provider = CountingProvider()
        req = DecideRequest(task_description="t", backend="browser")
        chunks = asyncio.run(_collect(provider.stream(req)))
        self.assertEqual(provider.decide_calls, 0, "stream() must not infer")
        self.assertTrue(chunks)
        self.assertTrue(all(c.text for c in chunks))

    def test_rust_agent_has_no_stream_thinking_precall(self):
        agent = (ROOT / "crates" / "phantom-core" / "src" / "agent.rs").read_text(
            encoding="utf-8"
        )
        self.assertNotIn(
            "stream_thinking",
            agent,
            "the agent loop must never issue a second inference per step",
        )
        self.assertIn("ONE inference per step", agent)


async def _collect(aiter):
    out = []
    async for chunk in aiter:
        out.append(chunk)
    return out


if __name__ == "__main__":
    unittest.main(verbosity=2)
