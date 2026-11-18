"""W0.2 — fail-closed action parsing (DEV-PLAN section 5, Days 1-2).

Run with the standard library only (no pytest / grpc / provider SDKs needed):
    python -m unittest discover -s python/tests -p 'test_schema_strict.py' -v

The regression this locks down: the old normalize_action_dict() defaulted a
missing/invalid action to ``done`` with confidence 1.0, so broken or empty
model output was reported to the user as a successful task. Strict mode must
never infer ``done``.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from phantom_llm.schema import (  # noqa: E402
    ActionValidationError,
    VALID_ACTION_TYPES,
    normalize_action_dict,
)


def build_malformed_corpus(n: int = 100):
    """Deterministically build `n` malformed model-output shapes."""
    non_dicts = [None, [], "x", 42, 3.14, True, b"bytes", (), set(), object()]
    bad_type = [
        None, "", "  ", 0, 1, -1, 2.5, True, False, [], {}, object(),
        "BROWSER", "Done", "DONE", "shell", "hack", "done ", " done",
        "cli\n", "null", "none", "undefined", "0", "[]", "browser/cli",
    ]
    bad_action = [
        None, "", "  ", 0, 1, 2.5, True, False, [], {}, object(),
        "   ", "\n", "navigate ", " navigate",
    ]
    bad_params = ["url=x", [], 0, None, True, "{}", 42, 3.5]

    cases = list(non_dicts)
    i = 0
    while len(cases) < n:
        bucket = (len(cases) // 10) % 4
        if bucket == 0:
            cases.append({"action_type": bad_type[i % len(bad_type)],
                          "action": "navigate", "params": {}})
        elif bucket == 1:
            cases.append({"action_type": "browser",
                          "action": bad_action[i % len(bad_action)], "params": {}})
        elif bucket == 2:
            cases.append({"action_type": "done", "action": "done",
                          "params": bad_params[i % len(bad_params)]})
        else:
            cases.append({"action_type": "browser", "action": "navigate",
                          "params": bad_params[i % len(bad_params)]})
        i += 1
    return cases[:n]


class FailClosedParsingTest(unittest.TestCase):
    def assert_rejects(self, raw):
        with self.assertRaises(ActionValidationError):
            normalize_action_dict(raw, strict=True)

    def test_empty_or_missing_fields_rejected(self):
        self.assert_rejects({})
        self.assert_rejects({"action": "navigate"})
        self.assert_rejects({"action_type": "browser"})
        self.assert_rejects({"action_type": "done"})

    def test_done_requires_explicit_model_intent(self):
        # A bare `done` intent is explicit and valid.
        done = normalize_action_dict({"action_type": "done", "action": "done"})
        self.assertEqual(done["action_type"], "done")
        self.assertEqual(done["action"], "done")
        self.assertEqual(done["confidence"], 1.0)
        # A type of done with any other action is internally inconsistent.
        self.assert_rejects({"action_type": "done", "action": "navigate"})

    def test_valid_actions_normalize(self):
        out = normalize_action_dict({
            "action_type": "browser", "action": "navigate",
            "params": {"url": "https://example.com", "n": 3},
            "confidence": "0.9",
        })
        self.assertEqual(out["action_type"], "browser")
        self.assertEqual(out["params"], {"url": "https://example.com", "n": "3"})
        self.assertAlmostEqual(out["confidence"], 0.9)
        self.assertTrue(VALID_ACTION_TYPES.issuperset({out["action_type"]}))

    def test_missing_confidence_falls_back_but_type_still_required(self):
        out = normalize_action_dict({"action_type": "file", "action": "read_file"})
        self.assertAlmostEqual(out["confidence"], 0.85)
        self.assertAlmostEqual(
            normalize_action_dict({"action_type": "done", "action": "done"})["confidence"],
            1.0,
        )

    def test_legacy_lenient_mode_is_documented_not_live(self):
        # strict=False is for offline tooling only; the server never uses it.
        out = normalize_action_dict({}, strict=False)
        self.assertEqual(out["action_type"], "done")

    def test_100_case_malformed_corpus_has_zero_false_done(self):
        cases = build_malformed_corpus(100)
        self.assertEqual(len(cases), 100)
        false_dones = []
        escaped = []
        for idx, raw in enumerate(cases):
            try:
                out = normalize_action_dict(raw, strict=True)
            except ActionValidationError:
                continue
            except Exception as exc:  # noqa: BLE001 - must be the typed error
                escaped.append((idx, type(exc).__name__))
                continue
            if out["action_type"] == "done":
                false_dones.append((idx, raw, out))
        self.assertEqual(escaped, [], "only ActionValidationError may escape")
        self.assertEqual(false_dones, [], "malformed output must never become `done`")

    def test_action_validation_error_is_a_value_error(self):
        # The gRPC server maps ValueError -> INVALID_ARGUMENT with one clause.
        self.assertTrue(issubclass(ActionValidationError, ValueError))


if __name__ == "__main__":
    unittest.main(verbosity=2)
