"""B1 — control plane is wired into the daemon, not just a standalone crate."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


class ControlPlaneTest(unittest.TestCase):
    def test_control_crate_implements_required_routes(self):
        src = read("crates/phantom-control/src/lib.rs")
        for route in (
            'route("/tasks"', 'route("/tasks/:id/cancel"',
            'route("/approvals/:id"', 'route("/events"',
            'route("/settings"', 'route("/vm/status"',
            'route("/artifacts/:id"',
        ):
            self.assertIn(route, src, f"missing route {route}")

    def test_auth_and_replay_protection(self):
        src = read("crates/phantom-control/src/lib.rs")
        for token in ("Bearer ", "x-phantom-nonce", "StatusCode::UNAUTHORIZED", "StatusCode::CONFLICT"):
            self.assertIn(token, src, f"missing auth mechanism {token}")

    def test_no_gui_task_feedback_loop(self):
        engine = read("crates/phantom-daemon/src/engine.rs")
        control = read("crates/phantom-control/src/lib.rs")
        self.assertIn("PhantomEvent::Control", engine)
        self.assertIn("from_gui", engine)
        self.assertIn("c.record_task", engine)
        self.assertIn("pub fn record_task", control)
        self.assertIn("fn insert(&self, req: SubmitTask, forward: bool)", control)

    def test_daemon_owns_control_state(self):
        main = read("crates/phantom-daemon/src/main.rs")
        engine = read("crates/phantom-daemon/src/engine.rs")
        self.assertIn("phantom_control::load_or_create_token", main)
        self.assertIn("phantom_control::serve", main)
        self.assertIn("control_port", main)
        self.assertIn("control: Option<Arc<ControlState>>", engine)
        self.assertIn("c.finish(&task_id", engine)


if __name__ == "__main__":
    unittest.main(verbosity=2)
