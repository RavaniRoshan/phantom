# Phantom — Development Plan to Product-Ready v1

**AS_OF:** 2026-11-18
**Basis:** `docs/GAP-ANALYSIS.md` and the verified deep-research report `research/phantom-product-readiness.md` (readiness ≈ 30%, ~44 person-weeks of backlog; the critical path is ~30–35 pw if browser/app scope is trimmed)
**Target:** Windows-first private beta in ~10 weeks, GA in ~20–24 weeks with 2–3 engineers.

> **Revision 2 (2026-11-18):** Updated after the adversarial verification pass. Changes: readiness revised 34% → 30%; added W0.0 hidden-desktop feasibility spike with a go/no-go decision; added capture-integrity, failure-propagation, TUI task-isolation, and task-store prerequisites; corrected desktop input/capture findings. The plan now forks at the end of Phase 0 depending on the spike outcome.

---

## 1. Definition of "product ready"

Phantom v1 is ready when all of the following hold. These are release gates, not aspirations.

### 1.1 Functional gate

Given a plain-language task, Phantom completes it unattended in the background on a machine the user is actively using, and reports an outcome the user can trust.

Concretely:

- **Desktop:** 12/20 golden tasks pass on 3 consecutive runs across Notepad, Chrome (native), Excel, Explorer, and a settings/dialog flow.
- **Browser:** 18/20 golden web tasks pass (research, form fill, download, multi-page extraction).
- **Files/CLI:** 20/20 deterministic tasks pass, including cancel and resume.
- **No silent success:** 0 false `done` results across a 100-case malformed/adversarial model-output suite.
- **Background invariant:** the user's foreground window, focus, clipboard, and pointer are never disturbed during desktop tasks.

### 1.2 Safety gate

- Safe mode is a **policy boundary**, not a denylist: a 50-case red-team suite of shell, path, desktop, and prompt-injection escapes yields 0 escapes.
- All external triggers are authenticated (HMAC or bearer token) and replay-protected.
- Every executed action is recorded in a tamper-evident local audit log with task id, action, params hash, result, and timestamp.
- Secrets live in Windows Credential Manager, never in `config.toml`.
- A documented threat model exists and has been reviewed.

### 1.3 Reliability gate

- 8-hour soak: 200 sequential tasks, no desktop/handle/process leaks, memory growth < 10%.
- Crash recovery: a killed daemon resumes queued work and preserves run history.
- Every task has a hard wall-clock and token budget; cancellation is honoured within 2 seconds.
- p95 decision latency and per-task cost are measured and capped.

### 1.4 UX gate

- One installer, one icon, no terminal required.
- First-run wizard validates the provider key and permissions.
- Task list with status, artifacts, logs, cancel, and retry.
- Notifications on completion/failure/approval-needed.
- Tray presence (mascot can remain post-GA if it risks the schedule).

### 1.5 Out of scope for v1

- macOS/Linux desktop automation.
- Multi-user / hosted SaaS.
- Unattended destructive actions in Safe mode.
- Mobile control surface.
- Marketplace/skill ecosystem.

---

## 2. Strategy

**Sequence by risk, not by feature appeal.** The desktop backend is both the differentiator and the weakest area; it gets the first engineering investment after the correctness blockers. Safety work lands before any external alpha because the product can execute arbitrary commands. Packaging is last because it is well-understood and does not de-risk anything.

**Preserve the architecture.** The neutral schema, gRPC split, approval queue, and hidden-desktop model are sound. The plan extends them; it does not rewrite the stack.

**Build the benchmark before the features.** Without a golden-task suite, "it works" is anecdote. The harness is a Phase 0 deliverable and every later workstream reports against it.

---

## 3. Workstreams and backlog

Effort in person-days (pd), including tests and docs. "Deps" are hard prerequisites.

### W0 — Correctness and safety blockers (Phase 0)

| ID | Task | Acceptance | pd | Deps |
|---|---|---|---:|---|
| W0.0 | **Hidden-desktop feasibility spike (go/no-go).** On a real Windows session, drive Notepad, Chrome (native), Excel, Explorer, and a dialog-heavy app on `CreateDesktop`. Measure click accuracy, text-entry success, capture validity (non-black, correct window), UIA hang rate, and whether input reaches the target. | Written report with per-app pass/fail. Decision: **narrow** (supported app matrix) or **broad** (isolated VM/Cloud PC). No W1 investment before this decision. | 5 | — |
| W0.1 | **Image transport contract.** Convert desktop captures to PNG at the source (or add `mime_type` + `width`/`height` to `ActionRequest` and honor it in every provider). Prefer PNG at capture for provider compatibility and size. | Desktop screenshots decode as PNG in all five providers; contract test asserts magic bytes and mime; `screenshot()` returns a typed `Image` struct. | 2 | — |
| W0.2 | **Fail-closed action parsing.** `normalize_action_dict` must reject missing/invalid `action_type`/`action`; remove the `done` default; `done` requires explicit model intent. Server returns `INVALID_ARGUMENT`; Rust retries once then surfaces a task error. | 100-case malformed-output suite: 0 false `done`; 100% error surfacing. | 2 | — |
| W0.3 | **One inference per step.** Implement real token streaming for Claude/OpenAI/Gemini, or remove `StreamThinking` from the execution loop and stream locally from the decision. Never call `decide` twice. | Provider call count per step == 1 (instrumented test); streamed reasoning matches executed action. | 2 | W0.2 |
| W0.4 | **Typed action schema v2.** Replace `map<string,string>` params with per-action typed params (or a validated JSON object with a schema per action). Validate on the Rust side before execution. | Unknown/missing/wrong-typed params produce a structured validation error, not a silent no-op. | 4 | W0.2 |
| W0.5 | **Plan-driven execution.** Persist plan steps, execute them in order, mark completion per step, and re-plan on repeated failure. Stop discarding the planner output. | Trace shows each executed action bound to a step id; failure triggers at most one re-plan; plan is visible in run record. | 4 | W0.4 |
| W0.6 | **Loop detection + task budgets.** Hash (action, params, observation) per step; abort on 3 repeats. Add wall-clock, token, and step budgets to `Config`. | Stalled tasks abort with a typed `Stalled` outcome; budget breach cancels cleanly. | 3 | W0.4 |
| W0.7 | **Desktop policy + injection fix.** Replace `cmd.exe /c start {target}` with `ShellExecuteW`/`CreateProcessW` and an app allowlist. Extend `Security` to police desktop actions. | Red-team: 0 successful shell-injection targets; blocked desktop action returns typed denial. | 3 | — |
| W0.8 | **Authenticated triggers.** Webhook requires a per-install bearer token or HMAC signature, enforces body size and rate limits, and rejects replays. | Unauthenticated POST → 401; 1 MiB body → 413; replay → 409. | 2 | — |
| W0.9 | **Secret storage.** Move API keys to Windows Credential Manager; config holds only a reference. Env override retained. | Key never appears in `config.toml` or logs; migration path from existing config. | 2 | — |
| W0.10 | **Cancellation + timeouts.** `CancellationToken` through the agent loop and backends; timeout wrapper on provider RPCs and shell commands; output caps. | Cancel honoured < 2 s; hung shell command killed; provider timeout surfaces as retryable error. | 4 | W0.6 |
| W0.11 | **Golden-task harness.** YAML-defined tasks (setup, prompt, success check, artifacts) executed by a headless runner; baseline report committed. | 20 desktop + 20 browser + 20 file/CLI tasks runnable in CI (desktop jobs on Windows runner); baseline scores recorded. | 5 | — |
| W0.12 | **Capture integrity.** Fix `BitBlt` self-copy, `GetDIBits`-while-selected, ignored `PrintWindow`/`GetDIBits` returns, and black-as-success. Add a non-black + correct-window assertion. | Capture failure returns a typed error, never a black BMP success. | 2 | W0.0 |
| W0.13 | **Failure propagation.** `Agent::run` returns `Err` on decide failure and max-iteration exhaustion; daemon/TUI surface it; add a typed run outcome. | Injected decide failure reaches the caller and UI; no `Ok(())` on failure. | 1 | W0.2 |
| W0.14 | **TUI task isolation.** Stop retaining the first event receiver; give each task its own Agent/backend state or serialize tasks explicitly; add a visible task list. | Two submitted tasks both report progress; no shared page/desktop state. | 2 | — |

**Phase 0 total: ~44 pd.** With 2 engineers, 2.5–3 weeks calendar. Exit requires: W0.0 decision recorded; W0.1–W0.3, W0.7–W0.8, W0.12, W0.13 green. W0.4–W0.6 and W0.14 can overlap into Phase 1.

**Fork at the end of Phase 0:** if the spike says hidden desktops cannot reliably drive the target app matrix, W1 is replaced by an isolated-VM/Cloud-PC workstream (add ~4–6 weeks and re-scope W8 packaging). Do not start W1 without the decision.

---

### W1 — Desktop backend (highest risk, highest value)

| ID | Task | Acceptance | pd |
|---|---|---|---:|
| W1.1 | **Target-window selection.** Enumerate windows per desktop; select by title/class/process; add `window` param and a `list_windows` action. | Agent can target a named app among 3 open windows; capture matches the target. | 4 |
| W1.2 | **Coordinate mapping.** Define one coordinate space (client area of the target window), convert to screen for UIA/input, return the mapping in the observation. Fix `LPARAM(0)`, missing `MOUSEEVENTF_ABSOLUTE`, and bitblt-from-self. | Click accuracy test: 20/20 clicks land within the target control. | 3 |
| W1.3 | **Full input vocabulary.** `key`, `hotkey`, `scroll`, `drag`, `hover`, `clipboard_set/get`, `focus_window`, `close_window`, `wait_for_window`, `wait`. | Each action has a behavioural test on Notepad/Explorer/Chrome. | 8 |
| W1.4 | **General text entry.** UIA ValuePattern → `WM_SETTEXT`/`EM_REPLACESEL` on the focused control → `SendInput` with verified focus. Remove Notepad hard-coding. | Types into Notepad, Chrome address bar, Excel cell, and a WinForms textbox. | 4 |
| W1.5 | **UIA observation + Set-of-Marks.** Emit a compact accessibility tree (role, name, bounds, enabled) and a screenshot with numbered overlays; add `click_mark(n)`. | Model can choose `click_mark` without pixel coordinates; 12/20 desktop tasks pass. | 6 |
| W1.6 | **App profiles.** Declarative profiles (launch command, window matcher, readiness check, hotkeys) for Chrome, Excel, Explorer, Notepad, Outlook/Teams. | Profiles selectable by name; launch→ready in < 5 s. | 5 |
| W1.7 | **Wire the desktop pool.** Use `DesktopPool` for agent runs and swarm workers instead of raw `launch_named` per agent; return leases on task end. | Pool reuse proven in soak; no desktop leaked after 200 tasks. | 3 |
| W1.8 | **Multi-monitor / DPI.** Per-monitor DPI awareness; capture at native scale; downscale for the model with a documented cap. | High-DPI and dual-monitor click tests pass. | 3 |

**W1 total: ~36 pd.** This is the critical path.

---

### W2 — Browser backend

| ID | Task | Acceptance | pd |
|---|---|---|---:|
| W2.1 | **Bounded text extraction.** Readability-style DOM→Markdown, links, forms, and tables; cap tokens and include a truncation marker. | Page context is ≤ 8k tokens; extraction accuracy test on 20 pages. | 4 |
| W2.2 | **Waits and readiness.** `wait_for_selector`, `wait_for_navigation`, `wait_for_network_idle`, per-action timeout. | 0 race failures in 50 sequential navigations. | 3 |
| W2.3 | **Action coverage.** `scroll`, `press_key`, `select_option`, `upload_file`, `download`, `evaluate_js` (Safe-mode gated), `new_tab`/`switch_tab`, `back`/`forward`. | Each action covered by e2e; downloads land in a task-scoped folder. | 6 |
| W2.4 | **Session profile.** Persistent `user-data-dir` per profile; cookie import/export documented; incognito vs profile mode. | Login persists across runs; profile isolation test passes. | 3 |
| W2.5 | **Selector grounding.** Generate candidate selectors for interactive elements and expose them in the observation; prefer semantic selectors over coordinates. | Click success rate on 20 pages improves vs baseline (measure). | 4 |
| W2.6 | **Screenshot policy.** Viewport + full-page options; downscale; JPEG/PNG choice by provider. | Cost per browser step reduced ≥ 30% vs baseline. | 2 |

**W2 total: ~22 pd.**

---

### W3 — Reliability, persistence, and observability

| ID | Task | Acceptance | pd |
|---|---|---|---:|
| W3.1 | **Run store.** SQLite schema: tasks, steps, actions, artifacts, approvals, token/cost. Migrations. | Every run survives restart; queries for history and replay. | 5 |
| W3.2 | **Task queue.** Durable FIFO with priority, dedupe key, retry policy, dead-letter, and concurrency limits. | Daemon restart resumes pending tasks; duplicate webhook is deduped. | 5 |
| W3.3 | **Audit log.** Append-only JSONL + hash chain; export command. | Tamper detection test; every action present. | 3 |
| W3.4 | **Structured logging + metrics.** Task id correlation, step timings, cost, success/failure counters; OpenTelemetry optional. | A single task can be reconstructed from logs. | 3 |
| W3.5 | **Crash recovery.** Orphaned desktop/process cleanup on boot; resume or fail-forward policy per task. | Kill -9 test: no orphan processes/desktops. | 2 |
| W3.6 | **Retry semantics.** Distinguish transient (network/rate limit) vs permanent (validation/policy) errors; exponential backoff with jitter. | Injected 429/500 suite: tasks recover without duplication. | 3 |

**W3 total: ~21 pd.**

---

### W4 — Safety engineering

| ID | Task | Acceptance | pd |
|---|---|---|---:|
| W4.1 | **Capability policy engine.** Per-task capability scopes (read paths, write paths, allowed apps, allowed domains, shell allowlist, network). Replace the substring denylist. | 50-case red-team suite: 0 escapes in Safe mode. | 8 |
| W4.2 | **Prompt-injection isolation.** Treat tool output/web/file content as untrusted data; delimit and instruct the model; strip control instructions; never let data alter policy. | Injection corpus (web pages, emails, files) cannot trigger a policy-violating action. | 4 |
| W4.3 | **Shell hardening.** Constrained PowerShell mode, command timeouts, output caps, working-directory jail, environment scrubbing. | `powershell -enc`, `iwr | iex`, `mshta`, `certutil` cases blocked under Safe. | 4 |
| W4.4 | **File-op safety.** Symlink/canonical-path resolution, trash-by-default for delete, dry-run diff for bulk writes, backup before overwrite. | Path traversal and symlink escape tests pass; delete is recoverable. | 3 |
| W4.5 | **Threat model + review.** Document assets, actors, trust boundaries, prompt-injection paths, and trigger exposure. External review before beta. | Signed-off document in `docs/security/`. | 3 |

**W4 total: ~22 pd.**

---

### W5 — Product surface

| ID | Task | Acceptance | pd |
|---|---|---|---:|
| W5.1 | **Task manager UI.** Multi-task list, status, step timeline, artifacts, logs, cancel/retry, approval inbox. TUI first; tray app in Phase 3. | Two concurrent tasks visible and independently controllable. | 6 |
| W5.2 | **Notifications.** Windows toast on completion/failure/approval-needed; configurable. | Toast fires in all three cases. | 2 |
| W5.3 | **Artifact handling.** Task-scoped output folder, screenshot viewer, report preview. | Artifacts open from UI; paths recorded in run store. | 3 |
| W5.4 | **Approval UX v2.** Edit-and-approve, approve-with-scope, reject-with-reason, remote approval hook. | Edited action executes with the edit recorded in audit. | 4 |
| W5.5 | **Error surfaces.** Actionable messages (provider down, quota, policy denial, permission denied) with remediation steps. | No raw gRPC errors in UI. | 2 |

**W5 total: ~17 pd.**

---

### W6 — Orchestration (post-alpha)

| ID | Task | Acceptance | pd |
|---|---|---|---:|
| W6.1 | **Plan DAG.** Steps carry `depends_on`; scheduler respects dependencies; independent branches run in parallel. | Diamond-DAG test: correct order, max parallelism observed. | 5 |
| W6.2 | **Enforced backends.** A step's backend is a constraint; cross-backend escape requires an explicit handoff action. | Backend mismatch produces a typed error. | 2 |
| W6.3 | **Product surface for swarm.** `/swarm <task>` in TUI, `--swarm` in daemon, swarm runs in run store with per-worker subtrees. | Swarm task produces one parent run with N child runs. | 4 |
| W6.4 | **Failure isolation + salvage.** Per-step retries, partial results, synthesis that reports gaps. | One failing branch does not fail the whole run; synthesis names the gap. | 4 |
| W6.5 | **Pool + RAM budgeting end to end.** `DesktopPool` leases, queue backpressure, worker admission control. | 4-worker swarm on an 8 GB box does not oversubscribe; leases returned. | 3 |

**W6 total: ~18 pd.**

---

### W7 — Verification and recovery

| ID | Task | Acceptance | pd |
|---|---|---|---:|
| W7.1 | **Acceptance criteria extraction.** Planner produces explicit, checkable success criteria per task. | Criteria shown in UI and stored in run record. | 3 |
| W7.2 | **Verifier pass.** Before `done`, a verifier (cheap model + deterministic checks + artifact inspection) confirms criteria. | False-success rate on adversarial suite < 2%. | 6 |
| W7.3 | **Re-planning.** On verification failure, re-plan from the last good state (bounded attempts). | 70% of injected mid-task failures recover. | 5 |
| W7.4 | **Reversibility.** Trash/backup for file mutations; browser download quarantine; desktop actions flagged irreversible. | Undo works for file and download tasks. | 4 |

**W7 total: ~18 pd.**

---

### W8 — Packaging and GA

| ID | Task | Acceptance | pd |
|---|---|---|---:|
| W8.1 | **Installer.** MSI/WiX or NSIS bundling the Rust binaries + a `python-build-standalone` sidecar + model SDKs. Do **not** use PyOxidizer (unmaintained) or one-file extraction (Defender rescan). Code signing via Azure Artifact Signing / OV certificate. | Clean VM install → first task in < 5 minutes, no terminal. | 8 |
| W8.2 | **Service/autostart.** Daemon as a per-user scheduled task or service; tray app launcher; single-instance guard. | Survives reboot; tray shows state. | 4 |
| W8.3 | **First-run wizard.** Provider selection, key validation, permission scopes, folder/app allowlists, test task. | 5/5 non-technical testers complete onboarding unaided. | 5 |
| W8.4 | **Updater.** Signed update channel with rollback. | Staged rollout + rollback rehearsed. | 4 |
| W8.5 | **Support bundle.** Redacted logs/config/diagnostics export. | Bundle contains no secrets (tested). | 2 |
| W8.6 | **Docs.** User guide, admin guide, security model, troubleshooting, provider setup. | Docs reviewed against a fresh install. | 5 |
| W8.7 | **Release QA.** Full benchmark, soak, security re-test, performance pass. | All §1 gates green. | 6 |

**W8 total: ~34 pd.**

---

## 4. Phases, milestones, and calendar

| Phase | Content | Duration | Exit milestone |
|---|---|---:|---|
| **Phase 0 — Stop the bleeding + feasibility** | W0.0 decision, W0.1–W0.3, W0.7–W0.14 | 2.5–3 weeks | No false success, correct images, authenticated triggers, benchmark baseline, desktop strategy chosen |
| **Phase 1 — Private alpha** | W1 (desktop) or isolated-VM fork, W2 (browser), W3 (reliability), W4 (safety), W5 (surface) | 7–9 weeks | 12/20 desktop, 18/20 browser, 0 red-team escapes; 5 internal users for 2 weeks |
| **Phase 2 — Beta** | W6 (orchestration), W7 (verification), desktop breadth, cost controls | 6–8 weeks | 50 external beta users; crash-free sessions > 99%; verified success > 85% |
| **Phase 3 — GA** | W8 packaging + release QA | 5–6 weeks | Installer, updater, support, all gates green |

**Total: ~44 person-weeks of backlog; ~21–27 weeks calendar with 3 engineers** (≈ 48–52 person-weeks including buffer). With 2 engineers, plan for 28–34 weeks. If the spike forces the isolated-VM fork, add 4–6 weeks.

```text
Week  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27
P0   ██████
W1        ████████████████████████████
W2                  ██████████████████
W3                        ████████████████
W4                              ████████████████
W5                                    ██████████████
W6                                          ████████████████
W7                                                ████████████████
W8                                                      ██████████████████████
```

Critical path: **W0.0 decision → W0.1 → W1.2 → W1.5 → W1.3 → benchmark → W4.1 → beta → W8.1**.

---

## 5. First 10 working days (concrete)

### Days 1–2

1. `W0.1` Desktop image contract:
   - `crates/phantom-desktop/src/desktop.rs`: return PNG (use the `image` crate or `windows` GDI+ encoder); add magic-byte test.
   - `proto/phantom.proto`: add `string screenshot_mime = 7` (forward-compatible field).
   - Python providers: honor `screenshot_mime`; add a shared `encode_image()` helper replacing five copy-pasted `image/png` strings.
2. `W0.2` Fail-closed normalization:
   - `python/phantom_llm/schema.py`: `normalize_action_dict(..., strict=True)` raises `ValueError` on missing required fields; no `done` default.
   - `server.py`: map `ValueError` → `grpc.INVALID_ARGUMENT`.
   - Test: malformed-output corpus.

### Days 3–4

3. `W0.3` Remove the double call:
   - `crates/phantom-core/src/agent.rs`: delete the `stream_thinking` pre-call or make it non-inferential.
   - `python/phantom_llm/providers/base.py`: base `stream` must not call `decide`.
4. `W0.7` Desktop `open` hardening:
   - Replace `cmd.exe /c start` with `ShellExecuteW` + app allowlist.
   - `security.rs`: add a `desktop` branch that validates target/app.

### Days 5–6

5. `W0.8` Webhook auth + limits; `W0.9` Credential Manager.
6. Add CI secret-scanning and `cargo deny`/`pip-audit` jobs.

### Days 7–8

7. `W0.11` Golden-task harness skeleton: YAML format, runner in `crates/phantom-core/examples/bench.rs`, 5 desktop + 5 browser tasks.
8. Record baseline numbers in `docs/benchmarks/baseline.md`.

### Days 9–10

9. `W0.10` Cancellation token through `Agent::execute_loop` and backends; shell timeout.
10. `W1.1`/`W1.2` design review: window targeting + coordinate contract; write the ADR before coding.

**End-of-sprint demo:** desktop task with a real vision provider, PNG screenshots, no double inference, one authenticated trigger, baseline benchmark report.

---

## 6. Architecture decisions to lock before Phase 1

| ADR | Decision | Why now |
|---|---|---|
| ADR-001 | Image transport: PNG normalized at capture; MIME carried in the contract; model-side downscale. | Blocks all vision work. |
| ADR-002 | Typed action schema v2 with per-action validation. | Stringly-typed params cause silent no-ops. |
| ADR-003 | Capability-based policy engine with per-task scopes. | Denylists cannot be secured. |
| ADR-004 | Local SQLite run store, append-only audit log. | Required for trust, debugging, and recovery. |
| ADR-005 | Coordinate contract: client-area pixels, explicit screen mapping. | Eliminates the current ambiguity. |
| ADR-006 | Packaging: sidecar embedded Python vs PyOxidizer. | Determines installer size, startup, and update strategy. |
| ADR-007 | Verification: acceptance criteria + verifier pass. | Prevents false success at the product level. |

---

## 7. Quality strategy

### 7.1 Test pyramid

- **Unit:** schema validation, policy engine, coordinate math, parsing, budget accounting.
- **Contract:** provider neutrality (same schema in/out), image MIME, gRPC error mapping.
- **Behavioural:** per-action desktop tests on a real Windows session (UIA tree, click accuracy, typing into 4 app classes).
- **Golden tasks:** 60 scenarios, run nightly on a Windows runner; score tracked per commit.
- **Adversarial:** prompt injection, shell escape, path escape, malformed model output, replay.
- **Soak:** 8-hour, 200-task run before each release candidate.

### 7.2 Release gates

1. Compile + unit + contract green on Linux and Windows.
2. Golden-task score ≥ target for the phase.
3. Red-team suite 0 escapes.
4. Soak: no leaks, no orphan processes/desktops.
5. Cost per task within budget.
6. Manual 30-minute dogfood on a clean VM.

### 7.3 Instrumentation

Every run records: task id, plan, steps, actions, params hash, observation hash, model, tokens in/out, cost, latency, outcome, verification result. This data is the source for the benchmark and the cost model.

---

## 8. Staffing and responsibilities

| Role | FTE | Owns |
|---|---:|---|
| Rust/platform engineer | 1.0 | Desktop backend, pool, input, coordinate/UIA work |
| Agent/backend engineer | 1.0 | Loop, planner, providers, verification, policy engine |
| Product/UX engineer | 0.5–1.0 | TUI/tray, task manager, onboarding, installer |
| QA/automation | 0.5–1.0 | Golden tasks, Windows runtime matrix, adversarial suites |
| Security reviewer | 0.2 | Threat model, red-team, policy review |

Two engineers can execute Phases 0–1 if QA is partially covered by automation; three is the realistic GA pace.

---

## 9. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Desktop automation unreliable across apps | High | Critical | UIA-first + Set-of-Marks; app profiles; benchmark early; limit v1 app list |
| Vision grounding quality | High | High | Accessibility-tree observation; stronger grounding model; `click_mark` instead of raw coordinates |
| Cost/latency per task | Medium | High | Single inference/step; context budgets; downscaled images; cheap verifier; per-task caps |
| Security incident via prompt injection | Medium | Critical | Policy engine, trigger auth, untrusted-data isolation, red-team before alpha |
| Scope creep (agent "can do anything") | High | High | Frozen v1 scope: Windows, 5 apps, browser, files, shell; explicit non-goals |
| Provider API drift | Medium | Medium | Pin SDKs; contract tests; adapter isolation |
| Packaging Python runtime | Medium | Medium | Decide ADR-006 in Phase 1; prototype installer by mid-beta |
| No local Rust toolchain for contributors | Medium | Low | CI is authoritative; document toolchain setup; add devcontainer |

---

## 10. Metrics to track from day one

| Metric | Baseline | Private alpha | GA |
|---|---:|---:|---:|
| Golden desktop success (3-run) | measure in W0.11 | 8/20 | 12/20 |
| Golden browser success | measure | 12/20 | 18/20 |
| False-success rate (adversarial) | unknown (likely high) | < 5% | < 2% |
| LLM calls per step | 2 | 1 | 1 |
| Median task cost | measure | ≤ $0.50 | ≤ $0.25 |
| Crash-free sessions | unknown | 95% | 99% |
| Red-team escapes | unknown | 0 | 0 |
| Time to first task (clean VM) | ~30 min manual | 15 min | < 5 min |

---

## 11. Immediate next actions (this week)

1. **Run W0.0**, the hidden-desktop feasibility spike, and record the narrow-vs-isolated-VM decision. This gates all desktop investment.
2. Approve the v1 scope and the §1 release gates.
3. Create ADR-001/002/005 and assign owners.
4. Land W0.1, W0.2, W0.3, W0.12, W0.13 behind tests (image contract, fail-closed parsing, single inference, capture integrity, failure propagation).
5. Stand up the benchmark harness and record the baseline (even if the baseline is bad).
6. Schedule the desktop backend design review (window targeting + coordinates + UIA observation).

The gap analysis and this plan are the decision artifacts. Implementation should start with W0.1/W0.2/W0.3 — they are small, independent, and remove the three defects most likely to produce a false "it works" demo.
