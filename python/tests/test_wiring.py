"""Verify that built modules are WIRED into the live loops, not just libraries.

    python -m unittest python.tests.test_wiring.py -v
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


class WiringTest(unittest.TestCase):
    def test_verifier_wired_into_agent_done(self):
        agent = _read("crates/phantom-core/src/agent.rs")
        for token in (
            "set_verification",
            "crate::verify::verify",
            "crate::verify::all_passed",
            "crate::verify::can_replan",
            "verification failed",
        ):
            self.assertIn(token, agent, f"agent.rs not wired: {token}")
        self.assertIn("max_replans", _read("crates/phantom-core/src/config.rs"))

    def test_daemon_persists_runs_actions_and_retries(self):
        engine = _read("crates/phantom-daemon/src/engine.rs")
        for token in (
            "RunStore::open",
            "AuditLog::open",
            "TaskQueue::new",
            "record_step",
            "log.append",
            "queue.fail",
        ):
            self.assertIn(token, engine, f"engine.rs not wired: {token}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
