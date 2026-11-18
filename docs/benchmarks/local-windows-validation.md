# Bare-Windows validation (real user machine)

**Date:** 2026-11-18 · **Machine:** Windows 11 Home, 16 GB RAM (~6 GB free), Rust 1.100, Python 3.14.7
**Authorization:** user asked to run the remaining gates on the bare Windows machine; GUI capture is expected.

## Environment constraint

Windows 11 Home does **not** support Hyper-V or Windows Sandbox, so the production
isolation boundary cannot run here. These tests exercise the agent loop, control
plane, capture and browser backends in the real interactive session. They prove
the code works on real Windows; they do **not** prove VM isolation on this machine.

## Passed

| Gate | Result | Evidence |
|---|---|---|
| Python sidecar with mock provider | PASS | `test_local_grpc_service.py`, 2 tests; `DecideAction` returns valid neutral actions with `provider/model/key_ref`. |
| Full daemon + control-plane task loop | PASS | `test_local_task_loop.py`: submit → engine → mock provider → `done` in ~1 s. Found and fixed a control→engine feedback loop and ID mismatch. |
| Live desktop capture on real Windows | PASS | `scripts/verify-guest-capture.ps1` → `artifacts/local-windows-capture.png`: **1536 × 864 PNG**, 409,648 bytes, 256 distinct byte values (non-black). |
| Browser backend smoke on local Edge | PASS | `cargo test -p phantom-browser -- --nocapture`, including `test_browser_navigate_and_screenshot`; `PHANTOM_CHROME` pointed at local Edge. |
| Scaled local soak (20 warm-up + 200 measured tasks) | PASS | `scripts/local_soak.py`: 200 done / 0 failed in 16.0 s; working set 25.1 to 25.7 MiB (2.5% growth, under the 10% gate). See `docs/benchmarks/local-soak.md`. |

## Honest caveats

- The mock provider does not test real model grounding or prompt injection resistance.
- The desktop capture here is the **user's real session**, not an isolated VM; the
  VM isolation proof remains the GitHub Actions `windows-2022` run and any future
  Hyper-V/Cloud PC host.
- A signed installer still needs SignPath/Artifact Signing secrets; a local unsigned
  NSIS build is possible but is not a signed deliverable.
- Beta-user onboarding needs actual users; it cannot be run by the agent alone.

## Still blocked (not runnable by the agent)

Real LLM-driven desktop/browser golden suites need provider keys and a live model;
a signed installer needs SignPath/Artifact Signing secrets; beta onboarding needs
actual users; VM isolation needs a Hyper-V/Cloud PC host (Windows 11 Home here).
