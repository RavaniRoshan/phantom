"""B2 — Tauri GUI shell is a thin client of the control plane.

The frontend is a React 19 / Vite app built into the Tauri frontendDist folder;
the source of truth for the screens is frontend-src/src/App.tsx.
"""

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
                    "get_settings", "set_settings", "vm_status", "has_api_key", "set_api_key",
                    "delete_api_key", "get_app_settings", "save_app_settings"):
            self.assertIn(f"async fn {cmd}", src, f"missing command {cmd}")
        self.assertIn("TrayIconBuilder", src)
        self.assertIn("http://127.0.0.1:4546", src)

    def test_frontend_has_required_screens(self):
        source = read("frontend-src/src/App.tsx")
        for id_ in ("composer", "activity", "task-list", "approval", "settings", "vm-pill",
                    "provider", "model", "mode", "api-key", "clear-api-key", "confidence", "workers"):
            self.assertIn(f'id="{id_}"', source, f"missing UI element {id_}")
        # Vite must emit into the folder Tauri serves.
        self.assertIn('outDir: "../crates/phantom-app/frontend"', read("frontend-src/vite.config.ts"))
        self.assertIn('id="root"', read("frontend-src/index.html"))

    def test_frontend_uses_space_ui_components(self):
        app = read("frontend-src/src/App.tsx")
        for component in ("button", "card", "badge", "input", "textarea", "separator", "dialog"):
            self.assertIn(f'"@/components/ui/{component}"', app, f"missing Space UI component {component}")
        for cmd in ("submit_task", "list_tasks", "cancel_task", "vm_status",
                    "get_app_settings", "save_app_settings", "set_api_key", "delete_api_key"):
            self.assertIn(f'"{cmd}"', app, f"frontend does not call {cmd}")
        self.assertIn('from "@/tauri"', app)

    def test_frontend_owns_model_catalog(self):
        self.assertIn('from "@/models"', read("frontend-src/src/App.tsx"))
        catalog = read("frontend-src/src/models.ts")
        for provider in ("claude", "openai", "gemini", "nvidia", "ollama", "mock"):
            self.assertIn(f'id: "{provider}"', catalog, f"missing provider {provider}")

    def test_config_is_single_nsis_installer(self):
        conf = read("crates/phantom-app/tauri.conf.json")
        self.assertIn('"nsis"', conf)
        self.assertIn('"frontendDist": "frontend"', conf)
        self.assertIn("beforeBuildCommand", conf)


if __name__ == "__main__":
    unittest.main(verbosity=2)
