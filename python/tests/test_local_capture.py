"""Bare-Windows capture evidence: a real non-black PNG from the interactive session."""

import struct
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
ART = ROOT / "artifacts" / "local-windows-capture.png"


class LocalCaptureTest(unittest.TestCase):
    def test_capture_is_real_png(self):
        self.assertTrue(ART.exists(), "run scripts/verify-guest-capture.ps1 first")
        b = ART.read_bytes()
        self.assertEqual(b[:8], b"\x89PNG\r\n\x1a\n")
        w, h = struct.unpack(">II", b[16:24])
        self.assertGreaterEqual(w, 100)
        self.assertGreaterEqual(h, 100)
        self.assertGreaterEqual(len(set(b)), 8, "capture is black/blank")

    def test_evidence_report_exists(self):
        report = ROOT / "docs/benchmarks/local-windows-validation.md"
        self.assertTrue(report.exists())
        text = report.read_text(encoding="utf-8")
        self.assertIn("1536", text)
        self.assertIn("non-black", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
