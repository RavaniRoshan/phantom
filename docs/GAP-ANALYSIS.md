# Phantom — Concept-to-Product Gap Analysis

**AS_OF:** 2026-11-18
**Scope:** Internal engineering audit of the repository at `C:\Users\shiva\Downloads\noobwork\phantom`
**Method:** Static code review of every Rust crate and Python module, README claim mapping, CI/workflow inspection. Deep-research workflow adapted for an internal codebase (question map → evidence packets → claim/evidence registry → counter-review).
**Snapshot:** 4,944 Rust LOC + 1,413 Python LOC; version `0.1.0`.
**Verification limits:** No Rust toolchain and no `grpc` Python package are installed in this environment, so no build or test run was possible. All findings below are source-level; runtime claims are labelled as such.

---

## 1. Executive summary

Phantom is a **credible architecture prototype with a working demo spine**, not a product.

The README describes a background computer-use agent with five pillars: a neutral action schema, an OmniAgent loop, confidence-gated autonomy, a Master Planner swarm, and an invisible Windows desktop. All five exist **as code**, and the vertical slice `task → plan → decide → execute → observe` is genuinely wired end to end through Rust ↔ gRPC ↔ Python.

What does **not** exist is the part that makes it usable without a demo script:

- The desktop backend — the product's core differentiator — is a **Notepad-shaped proof of concept**. Screenshots are BMP bytes sent to vision models labelled `image/png`; click fallbacks discard coordinates; text entry special-cases Notepad; the captured window is "first visible window", not the target app.
- The plan produced by the planner is **ignored** by the single-agent loop, and the swarm ignores task dependencies.
- Failure is indistinguishable from success: a malformed/empty model response normalizes to `done` with confidence `1.0`.
- There is no task persistence, cancellation, timeout, retry policy, verification step, audit log, or authenticated trigger surface.
- The "Master Planner swarm" and "multi-desktop pool" are library/example-only and not reachable from any product surface.

**Readiness score: ~30% of a product-ready v1** (weighted, see §3; revised down from 34% after the adversarial verification pass added capture/injection defects). Concept fidelity / demo fidelity is substantially higher (~65%) because the architecture matches the pitch even where the behaviour does not.

**Remaining effort estimate: ~44 person-weeks of backlog (≈30–35 pw critical path with trimmed scope)**, i.e. roughly **5–6 months with 2–3 engineers**. The estimate is dominated by the Windows desktop backend and the reliability/safety work, not by the agent loop.

> **Superseded for external/benchmark claims:** see the verified deep-research report at `research/phantom-product-readiness.md`. It corrects several benchmark figures and adds capture-integrity, failure-propagation, and TUI-isolation defects.

---

## 2. README claim → implementation reality

| README claim | Reality | Evidence |
|---|---|---|
| Neutral action schema, single source of truth | **Shipped.** One canonical schema + normalizers used by all providers. | `python/phantom_llm/schema.py:29-179` |
| One OmniAgent brain owns plan → route → execute | **Partial.** Loop exists, but the plan is emitted to the UI and then discarded; routing is a direct `match` on `action_type`, not the `router` module. | `crates/phantom-core/src/agent.rs:89-98`, `router.rs:1-11` |
| Confidence-gated autonomy + Approval Queue | **Shipped for the TUI path.** Safe mode gates actions, TUI approve/reject works, headless skips. | `agent.rs:164-208`, `approval.rs:55-121`, `tui/app.rs:405-441` |
| Master Planner swarm decomposes a task graph | **Demo-only.** Implemented as a library and example; not wired into CLI or daemon. Fan-out ignores dependencies. | `orchestrator.rs:55-107`, `examples/swarm_task.rs:50` |
| Proactive daemon, webhook + Inbox | **Shipped, unauthenticated.** Loopback webhook and file watcher work; no token, body limit, or replay protection. | `daemon/webhook.rs:20-60`, `daemon/watcher.rs:27-58` |
| Invisible Windows desktop, UIA-first, no focus theft | **Partial / fragile.** `CreateDesktopW` and UIA calls exist, but input and perception are not general-purpose. | `desktop/desktop.rs`, `desktop/input.rs` |
| Headless browser over CDP | **Basic.** Navigate/click/type/screenshot only; no waits, extraction, downloads, sessions, or tabs. | `browser/cdp.rs:188-228` |
| Safe / Hero modes | **Partial.** Path sandbox and a CLI denylist exist; the desktop backend bypasses both. | `security.rs:84-137`, `desktop/desktop.rs:111-119` |
| Interactive TUI | **Shipped as a thin chat client.** No task queue, cancel, history, image view, or multi-task visibility. | `tui/app.rs`, `tui/views/*` |
| NVIDIA NIM free vision provider | **Shipped (with the image-format defect below).** | `providers/nvidia.py:102-178` |
| Two CI workflows gate the project | **Shipped.** Linux check/tests + Windows compile and runtime smoke jobs. | `.github/workflows/ci.yml`, `windows-runtime.yml` |
| Animated mascot (Pillar I.3) | **Absent (acknowledged deferred).** | `daemon/main.rs:8-9` |

---

## 3. Readiness scorecard

Weights reflect what a buyer of a "background computer-use agent" actually depends on. Scores are analyst judgement anchored to the evidence in §4.

| Dimension | Weight | Readiness | Weighted | Rationale |
|---|---:|---:|---:|---|
| Core agent loop | 15% | 45% | 6.75 | Loop works, but plan is ignored, no verification, no loop detection, 2× LLM calls/step. |
| Browser backend | 10% | 55% | 5.50 | Small but coherent action set; unusable for real web tasks without waits/extraction. |
| Windows desktop backend | 25% | 25% | 6.25 | Hidden desktop exists; perception/input are demo-grade and partially incorrect. |
| Safety & policy | 15% | 30% | 4.50 | Denylist heuristics + path sandbox; desktop and trigger surfaces are holes. |
| Multi-agent / swarm | 10% | 35% | 3.50 | Code exists, product does not; no dependency semantics, pool not wired. |
| Autonomy / HITL | 5% | 60% | 3.00 | TUI queue is solid; no edit-approve, no remote approval, no notifications. |
| Product surface / UX | 10% | 30% | 3.00 | TUI + headless daemon only; no tray, installer, mascot, task history. |
| Reliability / ops | 10% | 15% | 1.50 | No persistence, cancel, timeouts, audit, metrics, cost controls. |
| **Total** | **100%** | | **30.2%** | |

**Interpretation**

- **Demo-ready:** yes, with the `mock` provider and carefully chosen tasks.
- **Private alpha:** blocked by P0 defects in §5 (desktop image contract, silent `done`, security holes).
- **Public beta:** blocked by reliability/UX work in §7.
- **GA:** blocked by packaging, security review, and a benchmark suite.

---

## 4. Deep-dive findings

### 4.1 Core loop

**Works:** `plan_task` → stream → `decide_action` → `execute` → feed screenshot/context/history back. History, iteration cap, and error events are present (`agent.rs:110-234`).

**Material defects**

1. **The plan is decorative.** `Agent::run` sends the plan to the UI, then calls `execute_loop(task)` with no reference to plan steps (`agent.rs:89-98`). The planner's decomposition never constrains execution. For a single agent this means "planning" is a paid extra call with no behavioural effect.
2. **Two LLM calls per step.** The loop calls `stream_thinking` (`agent.rs:146-152`) and then `decide_action` (`agent.rs:155`). Every provider inherits the base `stream`, which itself calls `decide` (`providers/base.py:72-83`). Result: 2× latency/cost and the streamed reasoning can describe a different action than the one executed.
3. **`done` is trusted, never verified.** `agent.rs:210-213` terminates on the model's word. There is no acceptance check, artifact check, or second-opinion verifier. A model that gives up early reports success.
4. **No loop/stall detection.** Identical failing actions repeat until `max_iterations` (`config.rs:80`), consuming quota.
5. **No per-task time budget, RPC timeout, or cancellation.** Only an iteration count.
6. **Fail-open normalization.** `normalize_action_dict` defaults missing fields to `done`/`done`, and a `done` action gets confidence `1.0` (`schema.py:139-163`). If Claude returns no tool block, the task silently "succeeds". If OpenAI/Gemini return none, the providers raise and the loop aborts (`openai.py:49,65`, `gemini.py:48`). The two failure modes are opposite and both wrong.
7. **No re-planning.** A failed sub-task never triggers plan revision.

### 4.2 Windows desktop backend (the differentiator)

**Works:** `CreateDesktopW`, host process, `PrintWindow` capture, UIA `Invoke`/`ValuePattern`, dedicated capture thread (`desktop.rs`, `input.rs`).

**Material defects**

1. **Image contract is broken.** Desktop captures are 24-bit BMP (`desktop.rs:198-209, 283-347`), but every provider labels screenshot bytes as `image/png` (`claude.py:71-75`, `openai.py:33`, `gemini.py:38`, `nvidia.py:130`). Paid vision APIs validate the payload; BMP-in-PNG will be rejected or ignored. This breaks the advertised observe→decide loop on the desktop backend for every real vision model. The mock provider masks it because it never looks at pixels.
2. **Coordinate space is ambiguous.** The model sees a client-area screenshot; `uia_click` uses `ElementFromPoint(x, y)` in desktop screen coordinates (`input.rs:55-64`), and the click fallback posts `WM_LBUTTONDOWN` with `LPARAM(0)` — i.e. at (0,0) — discarding `x,y` entirely (`desktop.rs:144-145`). `send_input_click` sets `dx/dy` without `MOUSEEVENTF_ABSOLUTE`, so it is interpreted as relative motion (`input.rs:85-100`).
3. **Text entry is Notepad-specific.** The reliable `WM_CHAR` fallback resolves only Notepad's `Edit` child (`desktop.rs:173-177, 384-413`). Any other app falls through to `SendInput`, which is documented as unreliable on a hidden desktop (`input.rs:102-119`).
4. **Perception targets the wrong window.** `find_window()` returns the *first visible window with a client area* (`desktop.rs:363-382`). The desktop host is a visible `cmd.exe` ping console (`desktop.rs:91-95`), so captures can show the host, not the app under test.
5. **No input vocabulary beyond click/type.** No key presses, hotkeys, scroll, drag, clipboard, window focus/activate/close, or waits. Real GUI tasks are not expressible.
6. **No accessibility-tree observation.** The agent gets pixels only; there is no UIA tree dump, role/name list, Set-of-Marks, OCR, or DOM-like context to ground actions. Small models cannot reliably ground raw screenshots.
7. **`open` is a command-injection primitive.** Targets are interpolated into `cmd.exe /c start {target}` (`desktop.rs:111-119`). `Security::check_action` only inspects CLI and file-write actions (`security.rs:84-105`), so Safe mode does not restrict desktop `open` at all.
8. **Resource lifecycle is unmanaged in the product.** `DesktopPool` exists and is smoke-tested (`pool.rs`, workflow `pool-smoke`) but the orchestrator creates raw desktops per worker (`orchestrator.rs:119-126`) and never uses the pool.

### 4.3 Browser backend

**Works:** launch (including Linux snap handling), navigate, selector/point click, type, screenshot, HTML snapshot (`cdp.rs:110-228`).

**Defects**

- `current_context` is the full page HTML (`cdp.rs:177-179, 226`), unbounded. This is the main token-cost and context-overflow risk.
- No `wait_for_selector`, `wait_for_navigation`, or network-idle handling; actions race the page.
- No JS evaluation, DOM-to-text extraction, link enumeration, scrolling, downloads, file upload, tab management, cookie/session persistence, or authenticated profiles.
- No selector generation/grounding, so the model must invent CSS selectors; failures are silently fed back as context.
- `extract_content` is observation-only and ignores its `selector` param (`cdp.rs:219-222`).
- One page per backend, fixed at `about:blank`; no session isolation between tasks.

### 4.4 Safety & policy

| Control | Status | Evidence |
|---|---|---|
| Write sandbox for `file` actions | Works (lexical, no symlink resolution) | `fs/sandbox.rs:39-69` |
| CLI denylist in Safe mode | Heuristic only | `security.rs:24-58` |
| Read restriction | None by design | `sandbox.rs:31-35` |
| Desktop action policy | **Missing** | `security.rs:84-91` |
| Webhook authentication | **Missing** | `webhook.rs:55-59` |
| Command execution timeout/output cap | **Missing** | `fs/powershell.rs:7-23` |
| Secret storage | Plaintext TOML | `config.rs:44-46`, `server.py:28-49` |
| Audit trail | Console logs only | `daemon/engine.rs:62-102` |
| Prompt-injection boundary | None | `daemon/event.rs:42-60` |

The CLI denylist is bypassable by design (aliases, encoded commands, `cmd /c`, `mshta`, `certutil`, .NET one-liners). Today, Safe mode is a speed bump, not a security boundary.

### 4.5 Orchestration / swarm

- Plan steps are described as an ordered graph in the README, but `MasterPlanner` spawns **all** steps concurrently (`orchestrator.rs:79-90`); `order` is only used to sort results afterwards (`orchestrator.rs:100`). Dependent steps will run against incomplete state.
- No per-step backend override is enforced: each worker is a fresh `Agent` that can emit any `action_type`; `SubTask.backend` is metadata only.
- No retry/failure isolation beyond a boolean; no partial-result salvage.
- Not exposed in the TUI, daemon, or a CLI flag — only `cargo run --example swarm_task`.
- Desktop pool/worker RAM budgeting is not applied to the swarm path.

### 4.6 Product surfaces & operations

- **TUI:** single-task event channel that is replaced on each submission (`tui/app.rs:339-357`); a second task silently orphans the first task's stream. No task list, cancel, pause, resume, history, artifacts, or screenshot rendering (`app.rs:365-367`).
- **Daemon:** strictly sequential (`daemon/engine.rs:7-10`), no queue depth, no dedupe, no replay, no dead-letter, no persistence across restarts.
- **No installer, service registration, auto-start, tray icon, notification, or update channel.** Users must run a Python service and a Rust binary in two terminals.
- **No task/run database.** Nothing survives a restart; there is no way to answer "what did it do last night?".
- **No cost governance.** No token accounting, budget limits, or per-task spend caps.

### 4.7 Providers & vision

- Provider neutrality is real and tested (`python/tests/test_providers.py`, `test_server_e2e.py`).
- No timeouts, retry/backoff, or rate-limit handling on provider SDK calls.
- No real token streaming; `StreamThinking` doubles as a second inference call.
- No image downscaling/compression, no text-only fallback. `vision.py:17-20` is dead code that explicitly says "vision pipeline not yet implemented".
- Default models are hard-coded and already aging (`claude-sonnet-4-5`, `gpt-4o`, `gemini-1.5-pro`); no capability/version probing.

### 4.8 Build, test, CI

- CI is real and appropriate for the current stage: Linux check/tests + mock e2e, Windows compile + runtime smoke (`ci.yml`, `windows-runtime.yml`).
- Test coverage is concentrated in the schema/approval/config/security layers. The desktop backend has **no automated behavioural tests**, only smoke examples that assert screenshots are non-blank and differ.
- No benchmark suite, no golden tasks, no regression corpus for computer-use reliability.
- Python packaging requires a separate `generate_proto.py` step that is not part of `pip install -e .`; the README's install section omits it (`server.py:3-5`, `pyproject.toml`).

---

## 5. P0 defects — fix before any external user

| # | Defect | Impact | Evidence |
|---|---|---|---|
| P0-1 | BMP screenshots sent as `image/png` | Desktop vision loop fails or degrades on every paid provider | `desktop.rs:283-347` vs `claude.py:71-75` |
| P0-2 | Empty/malformed model output → `done` @ 1.0 confidence | Silent false success; user believes work was done | `schema.py:139-163` |
| P0-3 | Desktop click drops coordinates / relative motion | Clicks land in the wrong place; task corrupts state | `desktop.rs:144-145`, `input.rs:85-100` |
| P0-4 | First-visible-window capture | Screenshot may show the host console, not the app | `desktop.rs:363-382` |
| P0-5 | Desktop `open` shell interpolation + no policy | Arbitrary command execution in Safe mode | `desktop.rs:111-119`, `security.rs:84-91` |
| P0-6 | Unauthenticated webhook behind a tunnel | Remote task injection / prompt injection / RCE chain | `webhook.rs:55-59` |
| P0-7 | Two LLM calls per step | 2× cost, inconsistent reasoning vs action | `agent.rs:146-155`, `base.py:72-83` |
| P0-8 | Plan ignored by execution loop | "Planning" has no effect; no recovery structure | `agent.rs:89-98` |
| P0-9 | No task persistence/cancel/timeout | Cannot operate unattended or debug failures | repo-wide absence |
| P0-10 | API key in plaintext config | Credential leakage on shared machines | `config.rs:44-46` |

---

## 6. What is genuinely done (do not rebuild)

1. **Neutral schema + normalization contract** across five providers, with tests.
2. **Working gRPC service** (`PlanTask`, `DecideAction`, `StreamThinking`) and retrying Rust client.
3. **Observe→decide→execute loop** with history and per-action perception.
4. **Confidence gate + approval queue**, including headless skip semantics and e2e tests.
5. **Safe/Hero path sandbox** with lexically normalized write roots.
6. **Hidden Win32 desktop lifecycle**, UIA-first invoke/set-value, BMP capture, multi-desktop naming and RAM-based worker recommendation.
7. **Headless Chromium automation** with snap-Chromium handling and a real e2e test.
8. **Proactive daemon skeleton** (webhook + Inbox watcher + event bus + engine).
9. **TUI with editable settings**, slash commands, streaming transcript, approval view.
10. **CI on two platforms** with a full mock e2e.

This is a strong foundation. The plan should extend it, not restart it.

---

## 7. What "product ready" additionally requires

Grouped by the workstreams used in the development plan:

| Area | Missing capability |
|---|---|
| Correctness | Image format contract, fail-closed parsing, single inference per step, plan-driven execution, verification, loop detection, time/token budgets |
| Desktop | Target-window selection, client↔screen mapping, full input set (key/hotkey/scroll/drag/clipboard), general text entry, UIA tree + Set-of-Marks perception, app profiles, waits, multi-window handling |
| Browser | Bounded text extraction, waits, JS eval, downloads, uploads, sessions, tabs, selector grounding |
| Safety | Desktop/CLI policy, authenticated triggers, secret storage, command timeouts/output caps, audit log, prompt-injection isolation, per-task capability scopes |
| Orchestration | Plan as a DAG with dependencies, enforced backends, retries, partial failure handling, desktop pool integration, product surface |
| Reliability | Persistent run store, queue, cancel/resume, crash recovery, structured logs, metrics, cost accounting |
| UX | Task list/history, notifications, tray + mascot presence, installer, auto-start, bundled Python, first-run wizard |
| Quality | Golden-task benchmark, desktop behavioural tests, soak tests, security review, threat model |

---

## 8. Threat model highlights

The current design lets a language model execute shell commands and drive a GUI. That is the product. It also means:

1. **Prompt injection is the primary attack.** Any web page, email, or dropped file can carry instructions. Today there is no separation between "data" and "instructions" in prompts (`providers/base.py:87-99`), no allowlist of actions per task, and no post-hoc policy on desktop actions.
2. **Trigger surface is remote.** A tunneled webhook with no shared secret lets anyone on the internet enqueue a task. Event context flows verbatim into the prompt (`daemon/event.rs:42-60`).
3. **Safe mode is not a boundary.** CLI filtering is substring-based; desktop execution is unfiltered. Only file writes are actually constrained.
4. **Secrets are at rest in plaintext** in a predictable path.
5. **No audit trail** means incidents cannot be reconstructed.

Product-ready requires a documented threat model, a real policy engine, and authenticated triggers. This is not optional for a background agent that can type into anything.

---

## 9. Confidence and limitations

| Claim class | Confidence | Basis |
|---|---|---|
| Repository structure and LOC | High | Direct file enumeration |
| Feature presence/absence | High | Full read of all Rust/Python sources |
| Defect root causes | High | Code paths traced end to end |
| Runtime behaviour on Windows | Medium | Static review only; Windows runtime unavailable here |
| Effort estimates | Medium | LOC + integration complexity + comparable agent projects; ±30% |
| Readiness weights | Analyst judgement | Explicitly documented in §3 so they can be challenged |

**Not verified:** compilation, test execution, actual vision-model rejection of BMP-in-PNG, UIA behaviour across third-party apps, webhook exploitability through a specific tunnel.

---

## Appendix A — Repository inventory

| Component | LOC | Maturity |
|---|---:|---|
| `phantom-core` | 1,166 | Core loop, config, security, approval, orchestrator |
| `phantom-cli` | 894 | Functional thin TUI |
| `phantom-desktop` | 934 (incl. examples) | Demo-grade backend |
| `phantom-daemon` | 315 | Skeleton |
| `phantom-browser` | 302 (incl. test) | Basic automation |
| `phantom-fs` | 209 | Small, tested |
| `phantom-proto` | 25 | Generated bindings |
| Python service | 1,413 (incl. tests) | Provider adapters + gRPC |

## Appendix B — Evidence index

Key files read in full: `README.md`, `proto/phantom.proto`, `agent.rs`, `orchestrator.rs`, `security.rs`, `approval.rs`, `config.rs`, `client.rs`, `router.rs`, `desktop.rs`, `input.rs`, `pool.rs`, `cdp.rs`, `sandbox.rs`, `operations.rs`, `powershell.rs`, `tui/app.rs`, `cli/main.rs`, `daemon/{main,engine,event,watcher,webhook}.rs`, `e2e_mock.rs`, `schema.py`, `server.py`, `base.py`, `providers/{claude,openai,gemini,nvidia,mock}.py`, `prompts.py`, `vision.py`, `pyproject.toml`, `ci.yml`, `windows-runtime.yml`.
