"""W0.11 — golden-task harness corpus and baseline.

    python -m unittest python.tests.test_golden_harness.py -v
"""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class GoldenHarnessTest(unittest.TestCase):
    def test_twenty_tasks_per_backend(self):
        tasks_dir = ROOT / "bench" / "tasks"
        for name in ("desktop", "browser", "files"):
            text = (tasks_dir / f"{name}.yaml").read_text(encoding="utf-8")
            ids = [line for line in text.splitlines() if line.startswith("- id:")]
            self.assertEqual(len(ids), 20, f"{name}.yaml must define 20 tasks")
            self.assertIn(f"backend: {name}", text)

    def test_tasks_have_required_fields(self):
        for name in ("desktop", "browser", "files"):
            text = (ROOT / "bench" / "tasks" / f"{name}.yaml").read_text(encoding="utf-8")
            for field in ("prompt:", "check:", "type:", "artifacts:"):
                self.assertIn(field, text, f"{name}.yaml missing {field}")

    def test_runner_and_baseline_exist(self):
        runner = ROOT / "crates" / "phantom-core" / "examples" / "bench.rs"
        self.assertTrue(runner.exists())
        body = runner.read_text(encoding="utf-8")
        self.assertIn("load_tasks", body)
        self.assertIn("run_deterministic", body)
        self.assertIn("PHANTOM_BENCH_LIVE", body)
        baseline = (ROOT / "docs" / "benchmarks" / "baseline.md").read_text(encoding="utf-8")
        self.assertIn("20 pass", baseline)
        self.assertIn("not yet measured", baseline)


if __name__ == "__main__":
    unittest.main(verbosity=2)
