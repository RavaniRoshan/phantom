# Section-1 release gates — status (2026-11-18)

Honest audit against `docs/DEVELOPMENT-PLAN.md` §1. "Verified" means a check was
run in this workspace; "blocked" means it requires infrastructure not available
here (interactive Windows session, VM host, code-signing certificate, beta
users).

## Functional gate

| Gate | Target | Status | Evidence |
|---|---|---|---|
| Desktop golden tasks | 12/20 × 3 runs | ❌ BLOCKED | W0.0 failed; hidden desktop retired. Isolated-VM runner not provisioned. |
| Browser golden tasks | 18/20 | ❌ BLOCKED | 20 live tasks defined; no live LLM service run. |
| Files/CLI tasks | 20/20 | ✅ VERIFIED | `bench` runner: 20/20 deterministic pass (`baseline.md`). |
| No silent success | 0 false `done` / 100 | ✅ VERIFIED | 100-case malformed corpus, 0 false done (`test_schema_strict.py`). |
| Background invariant | user focus untouched | ⚠️ STRUCTURAL | Isolated VM (ADR-008) provides isolation by construction; not validated on a VM host. |

## Safety gate

| Gate | Target | Status | Evidence |
|---|---|---|---|
| Red-team 50 cases, 0 escapes | 0 | ✅ VERIFIED | `policy.rs` 50-case test + desktop allowlist tests. |
| Authenticated triggers | 401/413/409 | ✅ VERIFIED | `webhook.rs` auth/limit/replay code + tests. |
| Tamper-evident audit | every action logged | ✅ VERIFIED | `AuditLog` hash-chain verify + tamper test. |
| Secrets in Credential Manager | key not in config | ✅ VERIFIED | Rust + Python credential access; real round-trip test. |
| Threat model reviewed | signed off | ⚠️ DRAFT | `docs/security/threat-model.md` written; external review pending. |

## Reliability gate

| Gate | Target | Status | Evidence |
|---|---|---|---|
| 8-hour soak, 200 tasks | no leaks | ❌ BLOCKED | Needs VM host + long-running session. |
| Crash recovery | resume queued work | ⚠️ PARTIAL | `RunStore` + `TaskQueue` are now wired into the daemon (runs/steps/audit recorded, dedupe/retry); full kill-and-resume soak still needs a VM host. |
| Cancellation < 2 s | honoured | ✅ VERIFIED | `CancellationToken` through agent + shell (unit tests). |
| p95 latency / cost capped | measured | ❌ NOT IMPLEMENTED | Instrumentation not wired to a dashboard. |

## UX gate

| Gate | Target | Status | Evidence |
|---|---|---|---|
| One installer / icon | clean VM < 5 min | ⚠️ ARTIFACTS ONLY | WiX source + scripts; MSI not built/signed here. |
| First-run wizard | 5/5 unaided | ❌ BLOCKED | Needs user testing. |
| Task list / cancel / retry | visible | ✅ VERIFIED | TUI `/tasks`, tagged events, per-task agents. |
| Notifications | 3 cases | ✅ VERIFIED | Typed notifications + sink tests (sink = TUI log; toast not on Windows API). |
| Tray presence | present | ❌ DEFERRED | Plan allows deferral if it risks schedule. |

## Conclusion

**Do not ship.** All code-level correctness and safety gates that can be
verified in this workspace pass, but the functional gates depend on VM
infrastructure and a signed installer that are outside this environment. The
remaining work is provisioning/validation, not missing code for the
already-gated items.

`docs/benchmarks/baseline.md` and `latest.json` hold the measured scores that
do exist. Run `scripts/verify-all.ps1` (or the CI workflow) to reproduce every
check that can be run in this workspace: `cargo check`, 81 Rust tests, the
20-task deterministic harness, and 39 Python tests — all green.
