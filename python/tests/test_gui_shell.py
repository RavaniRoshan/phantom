"""B2 — Tauri GUI shell is a thin client of the control plane."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


class GuiShellTest(unittest.TestCase):
    def test_tauri_commands_cover_required_flows(self):
        src = read("crates/phantom-app/src/main.rs")
        for cmd in ("list_tasks", "submit_task", "cancel_task", "resolve_approval",
                    "get_settings", "set_settings", "vm_status"):
            self.assertIn(f"async fn {cmd}", src, f"missing command {cmd}")
        self.assertIn("TrayIconBuilder", src)
        self.assertIn("http://127.0.0.1:4546", src)

    def test_frontend_has_required_screens(self):
        html = read("crates/phantom-app/frontend/index.html")
        for id_ in ("composer", "activity", "task-list", "approval", "settings", "vm-pill"):
            self.assertIn(f'id="{id_}"', html, f"missing UI element {id_}")

    def test_config_is_single_nsis_installer(self):
        conf = read("crates/phantom-app/tauri.conf.json")
        self.assertIn('"nsis"', conf)
        self.assertIn('"frontendDist": "frontend"', conf)


if __name__ == "__main__":
    unittest.main(verbosity=2)
