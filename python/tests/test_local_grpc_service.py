"""Local bare-Windows validation: the Python sidecar answers DecideAction."""

import os
import subprocess
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PY = ROOT / "python"
sys.path.insert(0, str(PY))

import grpc
import phantom_pb2
import phantom_pb2_grpc


class LocalGrpcServiceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = "50052"
        env = os.environ.copy()
        env["PHANTOM_PROVIDER"] = "mock"
        env["PHANTOM_GRPC_PORT"] = cls.port
        env["PYTHONPATH"] = str(PY)
        cls.proc = subprocess.Popen(
            [sys.executable, "-m", "phantom_llm.server"],
            cwd=str(PY),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        cls.channel = grpc.insecure_channel(f"127.0.0.1:{cls.port}")
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                grpc.channel_ready_future(cls.channel).result(timeout=1)
                return
            except grpc.FutureTimeoutError:
                if cls.proc.poll() is not None:
                    raise RuntimeError("sidecar exited before becoming ready")
        raise RuntimeError("sidecar did not become ready")

    @classmethod
    def tearDownClass(cls):
        cls.channel.close()
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.proc.kill()

    def test_decide_action_returns_valid_neutral_action(self):
        stub = phantom_pb2_grpc.PhantomLLMStub(self.channel)
        req = phantom_pb2.ActionRequest(
            task_description="write a file",
            current_context="",
            mode="safe",
            backend="file",
            screenshot_mime="",
        )
        resp = stub.DecideAction(req, timeout=10)
        self.assertIn(resp.action_type, {"file", "browser", "cli", "desktop", "done"})
        self.assertTrue(resp.reasoning)
        self.assertGreater(resp.confidence, 0.0)

    def test_provider_model_key_ref_fields_are_accepted(self):
        stub = phantom_pb2_grpc.PhantomLLMStub(self.channel)
        req = phantom_pb2.ActionRequest(
            task_description="run a command",
            backend="cli",
            provider="mock",
            model="mock-1",
            key_ref="",
        )
        resp = stub.DecideAction(req, timeout=10)
        self.assertEqual(resp.action_type, "cli")


if __name__ == "__main__":
    unittest.main(verbosity=2)
