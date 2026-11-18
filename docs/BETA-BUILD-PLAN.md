# Phantom — Windows beta build plan

**Status:** ready to execute. **Source:** `research/phantom-beta-readiness.md` (verified findings + flagged limitations).
**Scope:** Windows-only, one installation, one GUI app, bring-your-own keys, isolated VM execution, free infrastructure first.
**Rule:** each phase ends with build → test → verify → commit, exactly like the W0–W8 work.

---

## 0. Decisions locked before code

| # | Decision | Rationale | Alternative |
|---|---|---|---|
| D1 | **Tauri 2** GUI (Rust core + web frontend) | Reuses `phantom-core`; ~600 KB base app ✅; tray + updater | Electron if streaming UI needs mature widgets |
| D2 | **Local Hyper-V golden image + guest agent** first | Hyper-V is free in Win10/11 Pro/Enterprise ✅; WAA proves the pattern ✅ | Windows 365 / Cloud PC adapter second |
| D3 | **Windows 11 Enterprise Evaluation ISO** for the golden VHDX | Legal 90-day free image ✅ (renew/rebuild before expiry) | Windows Server evaluation |
| D4 | **Azure Artifact Signing** (formerly Trusted Signing) + signed updater | Managed cert lifecycle, Basic SKU 5k signatures/mo ✅ | OV cert; MSIX for wider beta |
| D5 | **Gemini Flash-Lite free default + explicit data consent**; paid Gemini 3.8 Flash; local Qwen3-VL via Ollama | Free tier ✅, but free content is used for training ✅ | OpenRouter `:free` / NVIDIA NIM demo-only |
| D6 | **Control plane in the daemon**, GUI is a client | TUI currently embeds `Agent` directly; background tasks must survive window close | Embed agent in GUI (breaks tray/background) |

These become **ADR-009** (GUI + control plane), **ADR-010** (VM guest agent), **ADR-011** (provider/onboarding + data consent).

### Repo integration facts that constrain the design

- `phantom-daemon` has only `webhook` (`POST /event`, authenticated) + a file watcher — **no GUI control API**.
- `phantom-cli` creates one `Agent` per task with a shared `ApprovalQueue`; this pattern should move behind the control plane.
- Python sidecar deps: `grpcio`, `anthropic`, `openai`, `google-generativeai`, `ollama`, `pydantic`; proto stubs are generated at build time. Bundling this sidecar dominates installer size.
- `Config` has `provider`, `model`, `llm_endpoint`, `mode`, allowed folders, budgets, `max_replans`; secrets already live in Credential Manager.
- `phantom-vm` currently defines `VmBackend` + `VmPool` + `MockVmBackend` only — no concrete provider.
- The verifier is wired into `Agent::run`; acceptance criteria are not yet produced by the planner (partial W7.1).

---

## Phase B0 — Architecture spikes and ADRs (week 1)

**Goal:** retire the two remaining unknowns before committing to UI work.

| ID | Work | Acceptance |
|---|---|---|
| B0.1 | Write ADR-009/010/011 (D1–D6) | ADRs merged; goal state updated |
| B0.2 | **Tauri spike**: blank window + tray + toast + streaming log + image viewer + signed updater scaffold | Builds with `cargo tauri dev`; tray and toast fire on Windows 11 |
| B0.3 | **Guest-agent spike**: Hyper-V VM from a Windows 11 Evaluation ISO; guest Rust service returns a non-black PNG + executes a click; host calls it through `VmBackend` | Screenshot is non-black and click moves the cursor **in the VM only**; host foreground unchanged |
| B0.4 | Decide Python sidecar fate: keep bundled for beta vs. port 5 providers to Rust | Written decision with measured installer size |

**Gate:** B0.3 must pass. If capture is black again, stop and re-scope (do not build UI on a broken backend).

**Files:** `docs/adr/ADR-009.md`…`ADR-011.md`, `apps/phantom-app/` spike, `crates/phantom-vm/src/hyperv.rs` spike, `docs/spikes/W10.0-guest-agent.md`.

---

## Phase B1 — Daemon control plane (weeks 1–2)

**Goal:** one authenticated local API that any UI can use.

| ID | Work | Acceptance |
|---|---|---|
| B1.1 | New crate `phantom-control`: loopback HTTP + WebSocket/SSE server, bearer token from `phantom_core::secrets`, 64 KiB body cap, rate limit | Unauthenticated requests get 401; replayed nonce 409 |
| B1.2 | Endpoints: `POST /tasks`, `GET /tasks`, `GET /tasks/{id}`, `POST /tasks/{id}/cancel`, `POST /approvals/{id}`, `GET /artifacts/{id}`, `GET /settings`, `PATCH /settings`, `GET /vm/status`, `GET /events` (stream) | Integration test covers submit → event stream → done |
| B1.3 | Move task ownership into the daemon: `TaskQueue` + per-task `Agent` + `RunStore` + `AuditLog` (already wired) exposed over the API; single-instance guard | Two tasks can be queued and cancelled independently |
| B1.4 | Event DTOs: plan, step, action, screenshot (artifact path + base64 thumbnail), approval request, outcome, error, VM status | Typed serde schema with JSON tests |

**Files:** `crates/phantom-control/{Cargo.toml,src/lib.rs,src/api.rs,src/events.rs,src/auth.rs}`, `crates/phantom-daemon/src/main.rs` (mount control server), `Cargo.toml` (workspace members).

---

## Phase B2 — Windows app shell (weeks 2–4)

**Goal:** a Codex-app-like control surface, no terminal required.

Screens:
1. **Tray** — status (idle/running/needs approval), open window, quit.
2. **Main window** — composer + model pill; task list with status/progress; live activity pane with VM screenshot viewer (VNC-style) and step timeline; cancel/retry buttons.
3. **Approval modal** — action, params, risk reason, Approve / Edit & approve / Reject with reason.
4. **History / artifacts** — run list from `RunStore`, screenshots and reports from `ArtifactStore`, audit hash chain verify button.
5. **Settings** — providers/keys, mode (Ask / Auto / Full — mirroring Codex's sandbox+approval split), folders, budgets, VM, updates.
6. **First-run wizard** — see Phase B3.

| ID | Work | Acceptance |
|---|---|---|
| B2.1 | Tauri scaffold + frontend (React or Svelte) + command bridge to `phantom-control` | Window, tray and task list work end-to-end |
| B2.2 | Live event stream renderer + screenshot viewer | Running task shows steps and current VM frame within 1 s |
| B2.3 | Approval modal + edit-and-approve (audit records the edit) | 3 approval paths tested |
| B2.4 | Notifications (complete/failed/approval-needed) | All three fire |
| B2.5 | Artifact viewer + history + support bundle button | No secrets in exported bundle |

**Files:** `apps/phantom-app/**` (new workspace member), `crates/phantom-control` client SDK.

---

## Phase B3 — Provider configuration + onboarding (weeks 3–4)

| ID | Work | Acceptance |
|---|---|---|
| B3.1 | Extend gRPC `DecideAction` with per-request `provider`, `model`, `key_ref`; Python resolves keys from Credential Manager per request | Switching model in UI takes effect on next step without restart |
| B3.2 | Provider registry for OpenAI, Anthropic, Gemini, OpenRouter, Local/OpenAI-compatible: base URLs, key prefixes, discovery endpoints, capability precedence, static price table | 5 providers validated against live endpoints where keys exist |
| B3.3 | Seven-step wizard: data disclosure → provider card → key paste → **validate with six distinct outcomes** → model picker (capability chips) → optional fallback → done | 5/5 non-technical testers complete unaided |
| B3.4 | Free-tier consent screen: "free tier may use your content to improve the model — switch to paid to opt out" (✅ source in report) | Consent recorded in settings; GPT-free default disabled until accepted |
| B3.5 | Cost estimate + per-task token readout labeled "estimated at list price" | OpenRouter `-1` sentinel prices never shown as free |
| B3.6 | Keys: single DPAPI-encrypted blob in one Credential Locker entry (20-credential cap ✅); mask after save; portable mode labeled unencrypted | No key in config.toml, logs, or support bundle (tests) |

**Files:** `proto/phantom.proto`, `python/phantom_llm/{server.py,providers/*,secrets.py}`, `crates/phantom-core/src/provider_config.rs`, `apps/phantom-app/frontend/src/settings/**`.

---

## Phase B4 — Concrete VM backend (weeks 3–6, parallel with B2/B3)

| ID | Work | Acceptance |
|---|---|---|
| B4.1 | `HyperVBackend` implementing `VmBackend`: create VM from golden VHDX checkpoint, start/stop/restore, lease via `VmPool` | 3 sequential tasks restore clean state |
| B4.2 | `phantom-guest` Rust service inside the VM: console-session screenshot (DXGI/GDI), SendInput/UIA click/type/key, UIA tree dump, artifact upload, heartbeat | Non-black PNG + 20/20 deterministic actions pass in guest |
| B4.3 | Golden image build script: Windows 11 Evaluation ISO + autologon + guest service + allowlisted apps (Notepad, Chrome, Excel, Explorer) | Fresh golden image builds unattended in < 30 min |
| B4.4 | Host channel: internal virtual switch, token auth, frame compression, 1080p 10 fps ceiling, reconnect on guest restart | Viewer shows live VM without focusing it |
| B4.5 | `CloudPcBackend` adapter behind the same trait (config-only first, real provisioning second) | Mock + HyperV + CloudPc selected by config |
| B4.6 | VM lifecycle: per-task snapshot restore, pool sizing, budget guard, leak tests | 200-task soak: no orphaned VMs/handles |

**Files:** `crates/phantom-vm/src/{hyperv.rs,guest.rs,cloudpc.rs,channel.rs,image.rs}`, `scripts/build-golden-image.ps1`, `crates/phantom-guest/**` (new member).

---

## Phase B5 — Packaging, signing, updates, compliance (weeks 6–7)

| ID | Work | Acceptance |
|---|---|---|
| B5.1 | Tauri NSIS/MSI bundle: Rust app + daemon + Python sidecar + WebView2 bootstrap | Clean VM: install → first task < 5 min, no terminal |
| B5.2 | Sign with Azure Artifact Signing (Basic SKU; confirm price in calculator ⚠️); publish update manifest with signature + rollback | SmartScreen warning understood; signed hash verifies |
| B5.3 | Signed updater with staged rollout + rollback rehearsal | Old version restorable |
| B5.4 | Privacy policy, beta EULA, third-party notices, SECURITY.md, telemetry opt-in, in-app data disclosure | Reviewed before first beta user |
| B5.5 | Docs: user/admin/troubleshooting updated for GUI + VM + providers | 5 testers onboard unaided |

**Files:** `packaging/**`, `.github/workflows/release.yml`, `docs/legal/**`, existing docs.

---

## Phase B6 — Beta validation and release (weeks 7–8)

| ID | Work | Acceptance |
|---|---|---|
| B6.1 | Run 20 desktop + 20 browser live golden tasks **inside the VM**, 3 consecutive runs | 12/20 desktop, 18/20 browser (plan §1) |
| B6.2 | 8-hour soak: 200 tasks, no VM/process/handle leaks, memory growth < 10% | Measured report |
| B6.3 | Re-run 50-case red team + 100-case malformed corpus through the GUI paths | 0 escapes, 0 false `done` |
| B6.4 | 5-user closed beta with feedback capture and cost dashboard | Onboarding 5/5; p95 latency and per-task cost measured |
| B6.5 | Update `docs/benchmarks/release-gates.md` honestly | Only genuinely green gates marked green |

**Gate:** expand to 20 users only when B6.1–B6.3 pass and privacy/compliance sign-off is recorded.

---

## Cost and free-resource summary

| Resource | Cost now | Note |
|---|---|---|
| Hyper-V + Windows 11 Evaluation ISO | **$0** | Needs Win10/11 Pro/Enterprise; ISO is 90-day evaluation ✅ |
| Windows 365 / Cloud PC | Paid; trial for evaluation | Not re-verified ⚠️ — price before promising |
| Azure Artifact Signing | Basic SKU 5,000 signatures/mo; price not rendered ⚠️ | $200/30-day Azure trial ✅ |
| Gemini Flash-Lite free | **$0** | Content used to improve products ✅ — consent required |
| Gemini 3.8 Flash paid | $0.75 in / $3.75 out per 1M ✅ | Cheap paid tier |
| OpenRouter `:free` | **$0**, 20 RPM / 50 RPD (<10 credits) ✅ | 1,000 RPD after ≥10 credits ✅ |
| Groq free | **$0**, 30 RPM / 1,000 RPD / 8K TPM ✅ | Good for verification steps, not full screenshot loops |
| NVIDIA NIM | **$0**, 1,000 credits/mo ⚠️ | Prototyping terms only |
| Local Qwen3-VL-8B | **$0** (hardware) | Apache-2.0; grounding gap remains ⚠️ |
| GitHub Models | **Unavailable** | Retired 2026-07-30 ✅ |

---

## Definition of done for "beta deliverable"

1. `scripts/verify-all.ps1` stays green after every commit (cargo check, Rust tests, golden harness, Python tests).
2. One signed installer, one icon, no terminal; first task < 5 minutes.
3. GUI can submit, watch, approve, cancel, retry and inspect every task; tray keeps work alive.
4. Desktop tasks run inside an isolated VM; host foreground never touched.
5. Five providers selectable in-app with validated keys; no secret on disk in plaintext.
6. Free-tier data consent and privacy policy shipped.
7. Release-gates report reflects measured live results, not aspirations.

---

## Immediate next action (single unit of work)

Create `docs/adr/ADR-009.md`, `ADR-010.md`, `ADR-011.md` from decisions D1–D6, then add the B0–B6 tasks to the persistent goal state. After that, begin **B0.2** (Tauri spike) and **B0.3** (guest-agent spike) — in that order, because a black capture invalidates the whole GUI plan. Each gets its own test → verify → commit cycle.
