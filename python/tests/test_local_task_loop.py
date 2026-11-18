"""Local bare-Windows validation: daemon + sidecar complete a task through the control API."""

import json
import os
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PY = ROOT / "python"
DAEMON = ROOT / "target" / "debug" / "phantom-daemon.exe"
CONFIG = ROOT / "target" / "local-validation-config.toml"
TOKEN = "local-validation-token"
BASE = "http://127.0.0.1:4556"
NO_WINDOW = 0x08000000


def request(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "X-Phantom-Nonce": str(time.time_ns()),
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


class LocalTaskLoopTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sys.platform != "win32" or not DAEMON.exists():
            raise unittest.SkipTest("local bare-Windows validation (needs built daemon)")
        CONFIG.write_text(
            'provider = "mock"\nmode = "safe"\nmax_iterations = 4\n'
            'grpc_endpoint = "http://127.0.0.1:50053"\n',
            encoding="utf-8",
        )
        pyenv = os.environ.copy()
        pyenv["PHANTOM_PROVIDER"] = "mock"
        pyenv["PHANTOM_GRPC_PORT"] = "50053"
        pyenv["PYTHONPATH"] = str(PY)
        cls.py = subprocess.Popen(
            [sys.executable, "-m", "phantom_llm.server"], cwd=str(PY), env=pyenv,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=NO_WINDOW,
        )
        denv = os.environ.copy()
        denv["PHANTOM_CONTROL_TOKEN"] = TOKEN
        cls.daemon = subprocess.Popen(
            [str(DAEMON), "--config", str(CONFIG), "--port", "4555", "--control-port", "4556"],
            cwd=str(ROOT), env=denv,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=NO_WINDOW,
        )
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                request("/settings")
                return
            except Exception:
                if cls.daemon.poll() is not None or cls.py.poll() is not None:
                    raise RuntimeError("local daemon or sidecar exited early")
                time.sleep(0.5)
        raise RuntimeError("control API did not become ready")

    @classmethod
    def tearDownClass(cls):
        for p in (cls.daemon, cls.py):
            p.terminate()
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()

    def test_task_reaches_terminal_state(self):
        created = request("/tasks", "POST", {"prompt": "write a file", "priority": 1})
        self.assertIn("id", created)
        deadline = time.time() + 45
        task = created
        while time.time() < deadline:
            task = request(f"/tasks/{created['id']}")
            if task["status"] in ("done", "failed", "cancelled"):
                break
            time.sleep(0.5)
        self.assertEqual(task["status"], "done", f"task failed: {task.get('outcome')}")
        self.assertTrue(task["outcome"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
