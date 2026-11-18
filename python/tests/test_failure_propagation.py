"""W0.13 — failure propagation (structural guards, runnable without Rust).

    python -m unittest discover -s python/tests -p 'test_failure_propagation.py' -v
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


class FailurePropagationTest(unittest.TestCase):
    def test_agent_run_returns_typed_outcome(self):
        agent = _read("crates/phantom-core/src/agent.rs")
        self.assertIn("pub enum RunOutcome", agent)
        self.assertIn("-> anyhow::Result<RunOutcome>", agent)
        self.assertIn("RunOutcome::Completed", agent)

    def test_decide_failure_and_budget_exhaustion_return_err(self):
        agent = _read("crates/phantom-core/src/agent.rs")
        self.assertIn('return Err(anyhow::anyhow!("decide failed: {e}"));', agent)
        self.assertIn("W0.13: budget exhaustion is a failure, never a quiet success", agent)

    def test_no_silent_ok_on_loop_exit(self):
        agent = _read("crates/phantom-core/src/agent.rs")
        self.assertIn("All loop exits above return a typed outcome or an error", agent)
        self.assertNotIn("\n        Ok(())\n    }\n\n    /// Whether `action` must be held", agent)

    def test_daemon_surfaces_failure(self):
        engine = _read("crates/phantom-daemon/src/engine.rs")
        self.assertIn("Ok(Err(e)) =>", engine)
        self.assertIn("task failed: {e}", engine)
        # The run future must be spawned so it is actually polled.
        self.assertIn("tokio::spawn(async move { task_agent.run(&task, etx).await })", engine)

    def test_client_retries_invalid_argument_once(self):
        client = _read("crates/phantom-core/src/client.rs")
        self.assertIn("tonic::Code::InvalidArgument", client)
        self.assertIn("for attempt in 0..2u32", client)


if __name__ == "__main__":
    unittest.main(verbosity=2)
