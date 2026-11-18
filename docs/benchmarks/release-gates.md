# Section-1 release gates — status (2026-11-18, final B6 audit)

Honest audit against `docs/DEVELOPMENT-PLAN.md` §1 and the beta build plan.
"Verified" means the check ran in this workspace; "blocked" means it needs
infrastructure or people not available here.

## Functional gate

| Gate | Target | Status | Evidence |
|---|---|---|---|
| Desktop golden tasks | 12/20 × 3 runs | ⚠️ CAPTURE PROVEN, TASKS NOT RUN | GitHub Actions `windows-2022` run `44296179855` succeeded: live non-black 1024×768 PNG artifact verified (`github-actions-capture.md`). The 20 LLM-driven desktop tasks still need a provider key + persistent VM session. |
| Browser golden tasks | 18/20 | ❌ BLOCKED | 20 live tasks defined; no live LLM service run. |
| Files/CLI tasks | 20/20 | ✅ VERIFIED | `bench` runner: 20/20 deterministic pass. |
| No silent success | 0 false `done` / 100 | ✅ VERIFIED | 100-case malformed corpus, 0 false done. |
| Background invariant | user focus untouched | ⚠️ STRUCTURAL + LIVE CAPTURE | Guest agent runs inside the VM interactive session; daemon owns tasks. `windows-2022` run proved capture in an isolated hosted session; foreground isolation on a user's own machine still untested. |

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
| 8-hour soak, 200 tasks | no leaks | ⚠️ PARTIAL | Accelerated offline mock soak passed on bare Windows: 200/200 tasks, 2.5% working-set growth (`local-soak.md`). The full 8-hour live-VM soak still needs a Hyper-V/Cloud PC host. |
| Crash recovery | resume queued work | ⚠️ PARTIAL | RunStore + TaskQueue wired; full kill/resume soak not run. |
| Cancellation < 2 s | honoured | ✅ VERIFIED | CancellationToken tests. |
| p95 latency / cost capped | measured | ❌ NOT IMPLEMENTED | No dashboard. |

## UX gate

| Gate | Target | Status | Evidence |
|---|---|---|---|
| One installer / icon | clean VM < 5 min | ⚠️ ARTIFACTS ONLY | Tauri NSIS config + signed release workflow; not built/signed here (secrets). |
| First-run wizard | 5/5 unaided | ❌ BLOCKED | Screens exist in the app shell; no user testing. |
| Task list / cancel / retry | visible | ✅ VERIFIED | React/Space UI Tauri GUI + control plane + TUI; rendered GUI verified (`artifacts/gui-react-spaceui.png`). |
| Notifications | 3 cases | ⚠️ PARTIAL | Typed notifications + sink; tray present; Windows toast not yet wired. |
| Tray presence | present | ✅ VERIFIED | `TrayIconBuilder` in `crates/phantom-app`. |

## Verified local state

`scripts/verify-all.ps1` is green: `cargo check --workspace --all-targets`,
**92 Rust tests**, the 20-task deterministic golden harness, and **70 Python
stdlib tests**. Storage: `docs/benchmarks/baseline.md`, `latest.json`, and
`docs/benchmarks/github-actions-capture.md` (live 1024×768 non-black capture,
run `44296179855`, conclusion `success`).

Bare-Windows (real user machine, Windows 11 Home): `local-windows-validation.md`
records the mock sidecar, full daemon task loop, live desktop capture
(`artifacts/local-windows-capture.png`, 1536×864 non-black), local Edge browser
smoke, and the 200-task soak. These prove real Windows execution, not VM
isolation (Hyper-V/Sandbox unavailable on Home).

## Conclusion

**Do not ship yet.** Every code-level deliverable of B0–B6 is implemented and
verified locally, and the GitHub Actions `windows-2022` run proved live capture
in a real interactive desktop. The remaining gates still require the LLM-driven
desktop/browser suites, the soak, a signing identity, and beta users. This
report will not be marked green until those checks actually run.
