# GitHub Actions live capture evidence (B0.3 / B4 / B6)

**Date:** 2026-11-18 · **Workflow:** `Windows GUI golden (B4/B6)` · **Run:** https://github.com/RavaniRoshan/phantom/actions/runs/44296179855 · **Branch:** `main` (PR #13) · **Conclusion:** `success`

## What actually ran

- Runner: `windows-2022` (GitHub-hosted, real interactive WinSta0 desktop).
- `cargo build -p phantom-guest`.
- `scripts/verify-guest-capture.ps1`: started `phantom-guest.exe` in the workflow's
  interactive session, polled `/health`, fetched `/screenshot`, asserted PNG
  magic, dimensions ≥100px, and ≥8 distinct byte values (all-black/blank rejection).
- Screenshot uploaded as artifact `guest-capture`.
- `cargo run -p phantom-core --example bench` — **20 pass / 0 fail / 40 skipped**.

## Artifact verification (local, after download)

| Check | Result |
|---|---|
| File | `artifacts/guest-capture.png` (483,034 bytes) |
| PNG magic | `89 50 4E 47 0D 0A 1A 0A` ✅ |
| Dimensions | **1024 × 768** ✅ |
| Distinct byte values | **256** (not black/blank) ✅ |

This is the first live proof that the in-guest capture path produces a real,
non-black frame on an interactive Windows desktop. It closes the code-level
version of the failure that killed the hidden-desktop approach (W0.0).

## Limits of this evidence

- This proves capture + guest-agent liveness, **not** end-to-end LLM task success.
- The 20 desktop/browser golden tasks still need a live provider key and a
  persistent VM session; they remain honestly blocked in `release-gates.md`.
- No external RDP or reverse tunnel was used; everything ran inside the workflow.

## Reproduction

```bash
gh workflow run "Windows GUI golden (B4/B6)" --ref main
gh run watch <run-id> --exit-status
gh run download <run-id> --name guest-capture --dir artifacts
python -m unittest python.tests.test_gh_evidence -v
```
