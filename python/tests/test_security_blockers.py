"""W0.7/W0.8/W0.9 — desktop policy, webhook auth, secret storage.

    python -m unittest discover -s python/tests -p 'test_security_blockers.py' -v
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


class SecurityBlockerTest(unittest.TestCase):
    # --- W0.7 ---------------------------------------------------------------
    def test_desktop_allowlist_policy_exists(self):
        sec = _read("crates/phantom-core/src/security.rs")
        self.assertIn("ALLOWED_DESKTOP_APPS", sec)
        self.assertIn("BLOCKED_SHELL_INTERPRETERS", sec)
        self.assertIn("fn check_desktop_action", sec)
        self.assertIn('"desktop" => self.check_desktop_action(action)', sec)

    def test_desktop_open_uses_shellexecute_not_cmd(self):
        desktop = _read("crates/phantom-desktop/src/desktop.rs")
        self.assertIn("ShellExecuteW", desktop)
        self.assertNotIn('format!("cmd.exe /c start {}", target)', desktop)

    # --- W0.8 ---------------------------------------------------------------
    def test_webhook_enforces_auth_limits_replay(self):
        hook = _read("crates/phantom-daemon/src/webhook.rs")
        for token in (
            "StatusCode::UNAUTHORIZED",
            "StatusCode::CONFLICT",
            "StatusCode::TOO_MANY_REQUESTS",
            "DefaultBodyLimit",
            "constant_time_eq",
            "NONCE_HEADER",
        ):
            self.assertIn(token, hook, f"webhook missing {token}")
        self.assertIn("load_or_create_token()", _read("crates/phantom-daemon/src/main.rs"))

    # --- W0.9 ---------------------------------------------------------------
    def test_config_file_no_longer_reads_api_key(self):
        server = _read("python/phantom_llm/server.py")
        self.assertIn('if k == "api_key":', server)
        self.assertIn("get_api_key()", server)

    def test_secret_store_roundtrip(self):
        if sys.platform != "win32":
            self.skipTest("Credential Manager is Windows-only")
        from phantom_llm import secrets

        target = "phantom/unit_test_secret"
        secrets.delete_secret(target)
        try:
            self.assertTrue(secrets.set_secret(target, "s3cr3t-value"))
            self.assertEqual(secrets.get_secret(target), "s3cr3t-value")
        finally:
            secrets.delete_secret(target)
        self.assertIsNone(secrets.get_secret(target))


if __name__ == "__main__":
    unittest.main(verbosity=2)
