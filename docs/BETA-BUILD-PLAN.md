# Phantom — Windows beta build plan (verified research edition)

**Status:** ready to execute. **Basis:** `research/phantom-beta-readiness.md` — 8 deep-research streams + adversarial verifier, 14 issues resolved.
**Scope:** Windows-only, one installation, one GUI app, bring-your-own keys, isolated VM execution.
**Rule:** per work item: implement → test → verify → commit, same loop as W0–W8.

---

## 0. Decisions locked (revised after verification)

| # | Decision | Evidence / caveat |
|---|---|---|
| D1 | **Tauri 2** GUI + Rust daemon control plane; Electron runner-up | Tauri reuses Rust core; known tray/toast/WebView2 issues need spiking ✅/◐. Most comparable AI apps ship Electron (softened claim) |
| D2 | **Hyper-V golden image + in-guest agent** in the interactive console session | Hidden desktops and disconnected RDP cannot be captured; WAA/W365 prove the pattern ✅ |
| D3 | Capture = **Windows.Graphics.Capture → GDI fallback**; DDA only optional fast path with fallback | DDA black frames are GPU/RDP/context-dependent ✅ |
| D4 | **Tauri NSIS per-user installer**; signing = **SignPath Foundation (free OSS)** first, **Azure Artifact Signing $9.99/mo** fallback (individual Public Trust US/Canada only), OV last resort; signed updater | EV no longer buys SmartScreen; self-signed = unsigned; **Tauri cannot produce MSIX** ✅ |
| D5 | **BYOK only**; Gemini Flash-Lite free default + explicit data-use consent; Gemini 3.8 Flash paid; local Qwen3-VL optional; OpenRouter/Groq/NIM demo-only | Free-tier content used for training ✅; EEA/CH/UK free-tier for end users likely prohibited — legal review ⚠️ |
| D6 | Daemon owns tasks/agents; GUI is a client, with tray + live VM observer | Current TUI embeds the agent; control API is the missing seam |
| D7 | Screenshots/logs **local by default**, retention controls, per-app/sensitive-category scope, VDP + third-party notices | GDPR Art. 9, AI Act Art. 50, CRA reporting, provider ToS ✅ |

These are recorded in **ADR-009** (GUI/control plane), **ADR-010** (VM guest agent), **ADR-011** (BYOK/consent). ADR-009/011 need the verification corrections applied before B0 closes.

### Repo facts that constrain the design
- `phantom-daemon`: webhook + watcher only, no GUI control API; TUI embeds `Agent` per task with shared `ApprovalQueue`.
- Python sidecar deps: grpcio, provider SDKs, pydantic; proto stubs generated at build; bundling dominates installer size (~45–51 MB for portable CPython alone).
- `Config` already has provider/model/llm_endpoint/mode/folders/budgets; secrets in Credential Manager.
- `phantom-vm`: `VmBackend`/`VmPool`/mock only; no concrete provider.
- Verifier wired into `Agent::run`; planner does not yet emit explicit acceptance criteria (partial W7.1).

---

## Phase B0 — Spikes + ADR corrections (week 1)

| ID | Work | Acceptance |
|---|---|---|
| B0.1 | Apply verification corrections to ADR-009/010/011 and this plan's D1–D7 | ADRs match the verified report |
| B0.2 | **Tauri spike**: window + tray + toast + streamed logs + frame viewer + signed updater scaffold | Builds on Windows; tray/toast verified in a clean VM; JSON IPC batched |
| B0.3 | **Guest-agent spike**: Hyper-V VM from an evaluation ISO, autologon + interactive session, guest agent returns non-black PNG and executes a click | Frame non-black across 3 runs; host foreground untouched; **hard gate** |
| B0.4 | Signing eligibility check: SignPath Foundation application criteria; Azure Public Trust country/account type | Written go/no-go for each path |
| B0.5 | Decide Python sidecar bundling (portable CPython vs PyInstaller onedir vs Nuitka) | Measured size + AV smoke result |

**Gate:** B0.3 must pass before any GUI feature work.

---

## Phase B1 — Daemon control plane (weeks 1–2)

| ID | Work | Acceptance |
|---|---|---|
| B1.1 | Crate `phantom-control`: loopback HTTP + WS/SSE, bearer token from `phantom_core::secrets`, 64 KiB cap, rate limit | 401 unauthenticated, 409 replay |
| B1.2 | Endpoints: tasks submit/list/get, cancel, approvals, artifacts, settings, VM status, `GET /events` stream | Integration test: submit → stream → outcome |
| B1.3 | Daemon owns per-task `Agent` + `TaskQueue` + `RunStore` + `AuditLog`; single-instance guard | Two tasks queued/cancelled independently |
| B1.4 | Typed event DTOs: plan, step, action, screenshot (path + thumbnail), approval request, outcome, error, VM status | serde round-trip tests |
| B1.5 | Local event batching (frames ≤10 fps, token/log chunks) to respect Tauri JSON IPC | No per-token IPC call in test harness |

---

## Phase B2 — Windows app (weeks 2–4)

Screens:
1. **Tray** — idle/running/needs-approval; open; quit.
2. **Main home** — task rail (Active / Needs you / Completed / All), task rows with last screenshot, elapsed time, approval badge; "New task" + templates.
3. **Composer** — "What should be done", "Where / which app", "Done when"; Plan-first toggle; permission mode **below the composer**.
4. **Live task detail** — step timeline, live VM view / latest frame, short narration; **Stop** and **Take over VM** always visible; "No progress for 60s — take over / retry / stop" state instead of a spinner.
5. **Approval modal** — names the exact action ("Submit the order?"), shows last frame + target + text; **Approve / Edit & approve / Deny / Take over**; for credentials/payments/CAPTCHA force takeover and suppress screenshots while typing; one notification per pending approval.
6. **History/artifacts** — replay, step logs, screenshots, outputs, retention setting; sorted by task.
7. **Settings** — capabilities, VM selector, permission mode, app allow/blocklist + sensitive categories, privacy (screenshot retention, delete-all, training opt-out), transparency summary.

| ID | Work | Acceptance |
|---|---|---|
| B2.1 | Tauri scaffold + web frontend + command bridge | Window, tray, task list end-to-end |
| B2.2 | Live event renderer + frame viewer + stuck detector | Frame shown within 1 s of capture |
| B2.3 | Approval flows incl. edit-and-approve (audit records edit) + takeover | 4 paths tested |
| B2.4 | Windows notifications for complete/failed/approval-needed | All three fire; dev-mode caveat handled |
| B2.5 | History/replay + support bundle button | Bundle contains no secrets |

---

## Phase B3 — Provider onboarding (weeks 3–4)

| ID | Work | Acceptance |
|---|---|---|
| B3.1 | Extend gRPC `DecideAction` with `provider`, `model`, `key_ref`; Python resolves keys per request via Credential Manager | Model switch takes effect next step, no restart |
| B3.2 | 5-provider registry (OpenAI, Anthropic, Gemini, OpenRouter, Local/OpenAI-compatible): auth, base URL, discovery, capability precedence, price table with `-1` sentinel handling | Each provider validates against live endpoints where keys exist |
| B3.3 | 3-screen first-run welcome + 7-step provider wizard; validate-on-save with six outcomes; model picker with capability chips; optional fallback | 5/5 non-technical testers onboard unaided |
| B3.4 | Consent layer: computer-use risks, screenshot capture + retention, free-tier data use, EEA paid-tier handling, EU withdrawal acknowledgment | Consent flags recorded and auditable |
| B3.5 | Cost estimate labeled "estimated at list price"; no `-1` shown as free | Test with OpenRouter sentinel prices |
| B3.6 | Keys: one DPAPI-encrypted blob in one Credential Locker entry; mask after save; portable mode labeled unencrypted | No key in config/logs/support bundle (tests) |

---

## Phase B4 — Concrete VM backend (weeks 3–6)

| ID | Work | Acceptance |
|---|---|---|
| B4.1 | `HyperVBackend`: create/start/stop/restore from golden VHDX with `Checkpoint-VM`; `VmPool` leases | 3 sequential tasks restore clean state |
| B4.2 | `phantom-guest` Rust service in the **interactive** session (on-logon, never Session 0): WGC capture → GDI fallback; DDA optional; SendInput (scan codes, key-state) + UIA; UIA tree; artifact upload | Non-black PNG; 20/20 deterministic actions pass in guest |
| B4.3 | Coordinate contract: desktop frames in screen pixels; browser actions in CSS viewport pixels; per-monitor-v2 awareness; frame dimensions returned | Coordinate test across 100%/150% scaling |
| B4.4 | Golden image build script: evaluation ISO + autologon + fixed resolution + guest service + allowlisted apps | Unattended build < 30 min; licensing caveat documented |
| B4.5 | Host channel: internal virtual switch, token auth, compressed frames ≤1080p/10 fps, reconnect; **observer stream separate** (WebRTC/H.264) for human watch/takeover | Viewer works without focusing VM |
| B4.6 | `CloudPcBackend` adapter behind `VmBackend` (config-only first); Graph/Intune custom image path researched, not implemented | Mock + HyperV + CloudPc selectable by config |
| B4.7 | Lifecycle: per-task checkpoint reset, pool sizing, leak tests | 200-task soak: no orphaned VMs/handles |

**Note:** each Windows guest needs its own license; evaluation images are not for customer-facing production. Resolve licensing before external beta.

---

## Phase B5 — Packaging, signing, compliance (weeks 6–7)

| ID | Work | Acceptance |
|---|---|---|
| B5.1 | Tauri NSIS per-user installer, `embedBootstrapper`, sidecar via `externalBin`, no terminal | Clean VM: install → first task < 5 min |
| B5.2 | Signing path from B0.4: SignPath free OSS or Artifact Signing $9.99/mo; timestamp signature; verify SmartScreen/Smart App Control in clean VM | `signtool verify /pa` passes; warnings documented |
| B5.3 | Signed updater with `latest.json` + `.sig`; rollback by repointing to last known good | Rehearsed rollback |
| B5.4 | Compliance: privacy notice, beta EULA (18+, as-is, EU Art. 16(m)), AI disclosure, third-party notices (`cargo-deny`), `SECURITY.md`/`security.txt`, CRA intake runbook, telemetry opt-in | Reviewed before first beta user |
| B5.5 | Docs for GUI + VM + providers; winget manifest after AV-clean build | 5 testers onboard unaided |

**Explicitly not in B5:** MSIX via Tauri (not supported); EV certificate (no SmartScreen benefit).

---

## Phase B6 — Beta validation (weeks 7–8)

| ID | Work | Acceptance |
|---|---|---|
| B6.1 | Live desktop/browser golden suites **inside the VM**, 3 runs | 12/20 desktop, 18/20 browser (plan §1) |
| B6.2 | 8-hour soak, 200 tasks, no leaks, memory growth < 10% | Measured report |
| B6.3 | Red-team 50 + malformed 100 re-run through GUI/API paths | 0 escapes, 0 false `done` |
| B6.4 | 5-user closed beta with onboarding and cost telemetry | 5/5 first task; p95 latency + per-task cost measured |
| B6.5 | Update `docs/benchmarks/release-gates.md` honestly | Only genuinely green gates marked green |

**Gate:** expand to 20 users only when B6.1–B6.3 pass and privacy/licensing/signing sign-off is recorded.

---

## Cost summary (verified)

| Resource | Cost | Caveat |
|---|---|---|
| Hyper-V + eval ISO | $0 host marginal | Guest license required; eval not for production ⚠️ |
| Windows 365 | $36 / $56 / $108.80 per user/month ✅ | 30-day trial, card required |
| Azure Spot D2s_v5 | $0.0397/h ✅ | 30 s eviction, no SLA |
| Contabo Windows VPS | Linux €4.40/mo; **Windows price unknown** ❌ | Verifier corrected "no license line" claim |
| SignPath Foundation | $0 | Eligibility + manual approval ⚠️ |
| Azure Artifact Signing | $9.99/mo Basic ✅ | Individual Public Trust US/Canada only |
| Gemini free / paid | $0 / $0.75+$3.75 per 1M ✅ | Free tier trains on content |
| OpenRouter `:free` | $0; 20 RPM/50 RPD (<10 credits) ✅ | 1,000 RPD after ≥10 credits |
| Groq free | $0; 30 RPM/1K RPD/8K TPM ✅ | ~3 screenshots/minute |
| GitHub Models | Unavailable ✅ | Retired 2026-07-30 |

---

## Definition of done for a beta deliverable

1. `scripts/verify-all.ps1` green after every commit.
2. One signed NSIS installer, one icon, no terminal; first task < 5 min.
3. GUI can submit, watch, approve/cancel/retry, take over, and inspect every task.
4. Desktop tasks run inside an isolated VM; host foreground never touched.
5. Five providers selectable in-app with validated keys; no plaintext secret on disk.
6. Consent, privacy, notices, VDP, EULA shipped; licensing question resolved.
7. Release-gates report reflects measured live results.

## Immediate next action

Apply the 14 verification corrections to ADR-009/010/011 (B0.1), then run **B0.3 guest-agent spike before B0.2 GUI work** — capture is the hard gate. The real VM proof needs a Windows Pro/Enterprise host with Hyper-V; scaffolding compiles here but the non-black-frame proof must be run on your machine.
