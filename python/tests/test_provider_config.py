"""B3 — provider registry, validation outcomes, capability/cost precedence."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from phantom_llm import provider_config as pc


class ProviderConfigTest(unittest.TestCase):
    def test_five_provider_families(self):
        self.assertEqual(set(pc.PROVIDERS), {"openai", "anthropic", "gemini", "openrouter", "local"})

    def test_base_url_normalization(self):
        self.assertEqual(pc.normalize_base_url("openai"), "https://api.openai.com/v1")
        self.assertEqual(pc.normalize_base_url("local", "http://localhost:1234"), "http://localhost:1234/v1")
        self.assertEqual(pc.normalize_base_url("openrouter", " https://openrouter.ai/api/v1/ "),
                         "https://openrouter.ai/api/v1")

    def test_six_validation_outcomes(self):
        outcomes = [pc.validate_outcome(s, n) for s, n in
                    ((200, 5), (200, 0), (401, None), (403, None), (429, None), (0, None))]
        self.assertEqual(outcomes, ["accepted", "connected_no_models", "key_rejected",
                                    "api_not_enabled", "rate_limited", "unreachable"])

    def test_capability_precedence(self):
        self.assertEqual(pc.capabilities("openai", "gpt-4o"), {"vision", "tools"})
        self.assertEqual(pc.capabilities("openai", "unknown-model-xyz"), set())
        self.assertEqual(pc.capabilities("openai", "anything", {"vision": True}), {"vision"})

    def test_price_sentinel_is_not_free(self):
        self.assertIsNone(pc.price_per_million("openrouter", "router", sentinel=-1))
        self.assertEqual(pc.price_per_million("openrouter", "x", live_price=0.0), (0.0, 0.0))
        self.assertEqual(pc.price_per_million("gemini", "gemini-3.8-flash"), (0.75, 3.75))

    def test_no_key_in_config(self):
        src = (ROOT / "python/phantom_llm/server.py").read_text(encoding="utf-8")
        self.assertIn('_provider_for(request)', src)
        self.assertIn('key_ref', src)


if __name__ == "__main__":
    unittest.main(verbosity=2)
