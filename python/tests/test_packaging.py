"""W8 — packaging artifacts and honest release-gate reporting.

    python -m unittest python.tests.test_packaging.py -v
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class PackagingTest(unittest.TestCase):
    def test_installer_and_scripts_exist(self):
        for rel in (
            "packaging/wix/Product.wxs",
            "scripts/install-service.ps1",
            "scripts/support-bundle.ps1",
            "docs/user-guide.md",
            "docs/admin-guide.md",
            "docs/troubleshooting.md",
        ):
            self.assertTrue((ROOT / rel).exists(), f"missing {rel}")

    def test_installer_avoids_forbidden_approaches(self):
        wix = (ROOT / "packaging/wix/Product.wxs").read_text(encoding="utf-8")
        self.assertIn("InstallScope=\"perUser\"", wix)
        self.assertIn("Do NOT use PyOxidizer", wix)
        self.assertNotIn("pyoxidizer-config", wix.lower())

    def test_support_bundle_redacts_secrets(self):
        script = (ROOT / "scripts/support-bundle.ps1").read_text(encoding="utf-8")
        for token in ("api[_-]?key", "bearer", "sk-", "nvapi-", "REDACTED"):
            self.assertIn(token, script, f"support bundle missing redaction for {token}")

    def test_release_gates_are_honest(self):
        gates = (ROOT / "docs/benchmarks/release-gates.md").read_text(encoding="utf-8")
        self.assertIn("Do not ship", gates)
        self.assertIn("BLOCKED", gates)
        self.assertIn("20/20", gates)


if __name__ == "__main__":
    unittest.main(verbosity=2)
