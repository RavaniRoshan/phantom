"""B6 — release gates reflect GitHub Actions evidence but stay honest."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class ReleaseGateEvidenceTest(unittest.TestCase):
    def test_gates_include_real_run_and_remain_honest(self):
        gates = (ROOT / "docs/benchmarks/release-gates.md").read_text(encoding="utf-8")
        self.assertIn("44296179855", gates)
        self.assertIn("github-actions-capture.md", gates)
        self.assertIn("Do not ship yet", gates)
        self.assertIn("⚠️ CAPTURE PROVEN, TASKS NOT RUN", gates)

    def test_workflow_file_declared_on_default_branch(self):
        wf = (ROOT / ".github/workflows/windows-gui-golden.yml").read_text(encoding="utf-8")
        self.assertIn("runs-on: windows-2022", wf)
        self.assertIn("workflow_dispatch", wf)


if __name__ == "__main__":
    unittest.main(verbosity=2)
