# Section-1 release gates — status (2026-11-18, final B6 audit)

Honest audit against `docs/DEVELOPMENT-PLAN.md` §1 and the beta build plan.
"Verified" means the check ran in this workspace; "blocked" means it needs
infrastructure or people not available here.

## Functional gate

| Gate | Target | Status | Evidence |
|---|---|---|---|
| Desktop golden tasks | 12/20 × 3 runs | ⚠️ READY, NOT RUN | `phantom-guest` + `windows-2022` capture workflow exist; live suite has not been executed (AWS launch externally blocked; CI workflow not dispatched from this environment). |
| Browser golden tasks | 18/20 | ❌ BLOCKED | 20 live tasks defined; no live LLM service run. |
| Files/CLI tasks | 20/20 | ✅ VERIFIED | `bench` runner: 20/20 deterministic pass. |
| No silent success | 0 false `done` / 100 | ✅ VERIFIED | 100-case malformed corpus, 0 false done. |
| Background invariant | user focus untouched | ⚠️ STRUCTURAL | Guest agent runs inside the VM interactive session; daemon owns tasks. Not validated on a real VM host here. |

## Safety gate

| Gate | Target | Status | Evidence |
|---|---|---|---|
| Red-team 50 cases, 0 escapes | 0 | ✅ VERIFIED | `policy.rs` 50-case test + desktop allowlist tests. |
| Authenticated triggers | 401/413/409 | ✅ VERIFIED | Webhook + control plane bearer/nonce tests. |
| Tamper-evident audit | every action logged | ✅ VERIFIED | Hash chain + tamper test; daemon writes every action. |
| Secrets in Credential Manager | key not in config | ✅ VERIFIED | Rust + Python credential access; GUI token ref; `key_ref` proto field. |
| Threat model reviewed | signed off | ⚠️ DRAFT | Written; external review pending. |
| Privacy/EULA/notices | shipped | ✅ VERIFIED | `docs/legal/`, `SECURITY.md`, notice generator. |

## Reliability gate

| Gate | Target | Status | Evidence |
|---|---|---|---|
| 8-hour soak, 200 tasks | no leaks | ❌ BLOCKED | Needs a live VM host. |
| Crash recovery | resume queued work | ⚠️ PARTIAL | RunStore + TaskQueue wired; full kill/resume soak not run. |
| Cancellation < 2 s | honoured | ✅ VERIFIED | CancellationToken tests. |
| p95 latency / cost capped | measured | ❌ NOT IMPLEMENTED | No dashboard. |

## UX gate

| Gate | Target | Status | Evidence |
|---|---|---|---|
| One installer / icon | clean VM < 5 min | ⚠️ ARTIFACTS ONLY | Tauri NSIS config + signed release workflow; not built/signed here (secrets). |
| First-run wizard | 5/5 unaided | ❌ BLOCKED | Screens exist in the app shell; no user testing. |
| Task list / cancel / retry | visible | ✅ VERIFIED | Tauri GUI + control plane + TUI. |
| Notifications | 3 cases | ⚠️ PARTIAL | Typed notifications + sink; tray present; Windows toast not yet wired. |
| Tray presence | present | ✅ VERIFIED | `TrayIconBuilder` in `crates/phantom-app`. |

## Verified local state

`scripts/verify-all.ps1` is green: `cargo check --workspace --all-targets`,
**92 Rust tests**, the 20-task deterministic golden harness, and **59 Python
stdlib tests**. Storage: `docs/benchmarks/baseline.md` and `latest.json`.

## Conclusion

**Do not ship yet.** Every code-level deliverable of B0–B6 is implemented and
verified locally. The remaining gates require a live Windows VM, a signing
identity, and beta users: run the `windows-gui-golden` workflow, execute the
live desktop/browser suites, complete the soak, then obtain privacy/security
sign-off. This report will not be marked green until those checks actually run.
