"""B5 — signing, notices, privacy and compliance artifacts exist and are honest."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


class BetaReleaseTest(unittest.TestCase):
    def test_signing_modes(self):
        src = read("packaging/sign.ps1")
        for mode in ("signpath", "artifact", "selfsigned-dev"):
            self.assertIn(mode, src)
        self.assertIn("signtool verify /pa", src)

    def test_notices_generator(self):
        src = read("scripts/generate-notices.ps1")
        self.assertIn("cargo metadata", src)
        self.assertIn("THIRDPARTY-NOTICES.md", src)

    def test_compliance_docs(self):
        for rel in ("SECURITY.md", "docs/legal/privacy.md", "docs/legal/beta-eula.md"):
            self.assertTrue((ROOT / rel).exists(), f"missing {rel}")

    def test_release_workflow_signs_every_binary(self):
        wf = read(".github/workflows/release.yml")
        for token in ("phantom-guest.exe", "phantom-daemon.exe", "Phantom_x64-setup.exe", "signpath"):
            self.assertIn(token, wf)


if __name__ == "__main__":
    unittest.main(verbosity=2)
