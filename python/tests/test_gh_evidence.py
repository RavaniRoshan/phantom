"""B6 — verify the live GitHub Actions capture artifact is a real non-black PNG."""

import struct
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ART = ROOT / "artifacts" / "guest-capture.png"


class GithubCaptureEvidenceTest(unittest.TestCase):
    def test_capture_artifact_exists_and_is_png(self):
        self.assertTrue(ART.exists(), "run gh run download ... --name guest-capture")
        b = ART.read_bytes()
        self.assertEqual(b[:8], b"\x89PNG\r\n\x1a\n")
        w, h = struct.unpack(">II", b[16:24])
        self.assertGreaterEqual(w, 100)
        self.assertGreaterEqual(h, 100)
        self.assertGreaterEqual(len(set(b)), 8, "capture is black/blank")

    def test_evidence_report_records_real_run(self):
        report = (ROOT / "docs/benchmarks/github-actions-capture.md").read_text(encoding="utf-8")
        for token in ("44296179855", "success", "1024", "768", "windows-2022"):
            self.assertIn(token, report)


if __name__ == "__main__":
    unittest.main(verbosity=2)
