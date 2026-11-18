"""W0.10 / W0.14 — cancellation, timeouts, TUI task isolation.

    python -m unittest python.tests.test_cancellation_isolation.py -v
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


class CancellationAndIsolationTest(unittest.TestCase):
    # --- W0.10 --------------------------------------------------------------
    def test_config_has_budgets(self):
        cfg = _read("crates/phantom-core/src/config.rs")
        self.assertIn("step_timeout_secs", cfg)
        self.assertIn("max_output_bytes", cfg)

    def test_agent_loop_is_cancellable_and_bounded(self):
        agent = _read("crates/phantom-core/src/agent.rs")
        for token in (
            "CancellationToken",
            "pub fn cancel(&self)",
            "RunOutcome::Cancelled",
            "cancel.cancelled()",
            "decide timed out",
            "step_timeout_secs",
        ):
            self.assertIn(token, agent, f"agent.rs missing {token}")

    def test_shell_command_killed_and_capped(self):
        ps = _read("crates/phantom-fs/src/powershell.rs")
        for token in ("kill_on_drop", "cancel.cancelled()", "MAX_OUTPUT_BYTES", "[output truncated]"):
            self.assertIn(token, ps, f"powershell.rs missing {token}")

    # --- W0.14 --------------------------------------------------------------
    def test_tui_uses_multiplexed_events_and_fresh_agent_per_task(self):
        app = _read("crates/phantom-cli/src/tui/app.rs")
        for token in (
            "UnboundedSender<(u64, AgentEvent)>",
            "Agent::new(cfg, client)",
            "set_task_status",
            "Command::Tasks",
        ):
            self.assertIn(token, app, f"app.rs missing {token}")
        # The old bug: overwriting the single receiver on each submission.
        self.assertNotIn("self.events = Some(rx);", app)
        self.assertNotIn("let mut rx = self.events.take();", app)

    def test_tasks_command_and_status_running_count(self):
        self.assertIn("Tasks", _read("crates/phantom-cli/src/commands.rs"))
        status = _read("crates/phantom-cli/src/tui/views/status.rs")
        self.assertIn("running", status)


if __name__ == "__main__":
    unittest.main(verbosity=2)
