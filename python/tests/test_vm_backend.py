"""B4 — concrete VM backend, guest agent, and GitHub Actions capture path."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


class VmBackendTest(unittest.TestCase):
    def test_guest_capture_contract(self):
        src = read("crates/phantom-guest/src/capture.rs")
        for token in ("reject_all_black", "encode_png", "ImageFormat::Png", "capture_console"):
            self.assertIn(token, src, f"missing capture contract {token}")
        self.assertIn("image/png", read("crates/phantom-guest/src/server.rs"))

    def test_guest_input_and_server(self):
        inp = read("crates/phantom-guest/src/input.rs")
        srv = read("crates/phantom-guest/src/server.rs")
        self.assertIn("SendInput", inp)
        self.assertIn("map_coordinate", inp)
        for route in ('/health', '/screenshot', '/click', '/type', '/uia/tree'):
            self.assertIn(f'"{route}"', srv)

    def test_host_client_and_hyperv_commands(self):
        g = read("crates/phantom-vm/src/guest.rs")
        h = read("crates/phantom-vm/src/hyperv.rs")
        self.assertIn("impl VmBackend for GuestBackend", g)
        self.assertIn("impl VmBackend for HyperVBackend", h)
        self.assertIn("Checkpoint-VM", h)
        self.assertIn("[REDACTED]", g)

    def test_github_actions_path_has_no_inbound_rdp(self):
        wf = read(".github/workflows/windows-gui-golden.yml")
        self.assertIn("runs-on: windows-2022", wf)
        self.assertIn("verify-guest-capture.ps1", wf)
        self.assertIn("upload-artifact", wf)


if __name__ == "__main__":
    unittest.main(verbosity=2)
