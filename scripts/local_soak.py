"""Bare-Windows scaled soak: 200 mock tasks through the real daemon + control API."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = ROOT / "python"
DAEMON = ROOT / "target" / "debug" / "phantom-daemon.exe"
CONFIG = ROOT / "target" / "local-soak-config.toml"
TOKEN = "local-soak-token"
CONTROL = "http://127.0.0.1:4558"
GRPC = "50054"
NO_WINDOW = 0x08000000
COUNT = 200


def api(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        CONTROL + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "X-Phantom-Nonce": str(time.time_ns()),
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def working_set(pid: int) -> int:
    out = subprocess.check_output(
        ["powershell", "-NoProfile", "-Command", f"(Get-Process -Id {pid}).WorkingSet64"],
        text=True,
    ).strip()
    return int(out)


def wait_ready() -> None:
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            api("/settings")
            return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("services did not become ready")


def main() -> int:
    CONFIG.write_text(
        f'provider = "mock"\nmode = "safe"\nmax_iterations = 4\ngrpc_endpoint = "http://127.0.0.1:{GRPC}"\n',
        encoding="utf-8",
    )
    pyenv = os.environ.copy()
    pyenv.update(PHANTOM_PROVIDER="mock", PHANTOM_GRPC_PORT=GRPC, PYTHONPATH=str(PY))
    sidecar = subprocess.Popen(
        [sys.executable, "-m", "phantom_llm.server"], cwd=str(PY), env=pyenv,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=NO_WINDOW,
    )
    denv = os.environ.copy()
    denv["PHANTOM_CONTROL_TOKEN"] = TOKEN
    daemon = subprocess.Popen(
        [str(DAEMON), "--config", str(CONFIG), "--port", "4557", "--control-port", "4558"],
        cwd=str(ROOT), env=denv,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=NO_WINDOW,
    )
    try:
        wait_ready()

        def run_batch(count: int, label: str):
            done = failed = 0
            for i in range(count):
                task = api("/tasks", "POST", {
                    "prompt": f"write a file {label}-{i}", "priority": 1,
                    "dedupe_key": f"soak-{label}-{i}",
                })
                deadline = time.time() + 30
                while time.time() < deadline:
                    state = api(f"/tasks/{task['id']}")
                    if state["status"] in ("done", "failed", "cancelled"):
                        break
                    time.sleep(0.05)
                if state["status"] == "done":
                    done += 1
                else:
                    failed += 1
            return done, failed

        # Warm up lazy caches before measuring, so startup growth is not a leak.
        run_batch(20, "warm")
        start_mem = working_set(daemon.pid)
        start = time.time()
        done, failed = run_batch(COUNT, "main")
        elapsed = time.time() - start
        end_mem = working_set(daemon.pid)
        growth = (end_mem - start_mem) / max(start_mem, 1) * 100
        report = ROOT / "docs/benchmarks/local-soak.md"
        report.write_text(
            "# Local bare-Windows soak\n\n"
            "- Method: 20 warm-up tasks, then 200 measured tasks; working set sampled "
            "after warm-up and after the measured batch.\n"
            f"- Tasks submitted (measured): {COUNT}\n- Completed: {done}\n- Failed: {failed}\n"
            f"- Elapsed: {elapsed:.1f}s\n- Daemon working set before: {start_mem / 1048576:.1f} MiB\n"
            f"- Daemon working set after: {end_mem / 1048576:.1f} MiB\n"
            f"- Growth: {growth:.1f}%\n\n"
            "Provider: offline mock. This measures daemon/control-plane stability, "
            "not real model grounding or VM isolation.\n",
            encoding="utf-8",
        )
        print(f"SOAK done={done} failed={failed} elapsed={elapsed:.1f}s growth={growth:.1f}%")
        return 0 if failed == 0 else 1
    finally:
        daemon.terminate()
        sidecar.terminate()
        for p in (daemon, sidecar):
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()


if __name__ == "__main__":
    sys.exit(main())
