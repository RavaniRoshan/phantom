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

---

# Appendix A — Low-RAM path: free cloud Windows VM for development/CI

**Added 2026-11-18** after the user reported a hard constraint: 16 GB physical RAM but only **4–5 GB usable**. Research method: 3 parallel research subagents (model `hy4-flash-free`) — cloud free tiers/credits, Windows 365 trials, and free GUI-capable CI runners. All findings are from official provider pages unless marked ◐.

## A.1 Why this changes the plan

A Docker Windows VM (QEMU/KVM on Docker Desktop/WSL2) needs ~4–8 GB RAM for the guest alone plus Docker/WSL overhead, which **exceeds our usable budget**. It is also `dockur/windows`/WAA-style tooling the end user will never install. Conclusion: **drop local Docker-Windows from the critical path**; use a free cloud Windows VM for guest-agent development and live golden-task runs, and keep the local machine for code, compilation and the Tauri/control-plane work (which fit in 4–5 GB). This supersedes the Docker suggestion in the earlier chat — it was a valid CI pattern but is not viable on this machine.

## A.2 Confirmed free-platform shortlist (ranked)

1. **Azure Free Account — best overall.** $200 credit for 30 days **plus 750 hrs/month of B2ats v2 (2 vCPU / 8 GB AMD x86 Windows) for 12 months** — effectively one Windows VM 24/7 for a year. Windows Server 2019/2022/2025 with Desktop Experience + RDP is first-class. Signup: phone + non-prepaid card + Microsoft/GitHub account, temporary $1 hold, one free account per new customer. After the credit/12 months: convert to pay-as-you-go or services stop. B2ats v2 Windows ≈ $0.0186/hr (East US). https://azure.microsoft.com/en-us/free/ · https://prices.azure.com/api/retail/prices
2. **Windows 365 Business trial — purpose-built, but 30 days.** 2 vCPU / 8 GB / 128 GB, **card required, auto-converts to paid at $36/user/month**, cannot be extended, data deleted if not converted. Real Windows 11, Win32 app installs, optional Intune, can enable local admin; thin HTML5 client at `windows.cloud.microsoft` keeps local RAM low. Constraints: hibernates after >1 h idle; “one per customer” likely but not stated on public pages ◐; acceptable-use concerns for a VNC server inside the guest ◐. **Windows 365 for Agents has no free tier** ($0.40/VM/hr + $5/VM/month always-available, US). https://www.microsoft.com/en-us/windows-365/business/windows-365-free-trial · https://learn.microsoft.com/en-us/windows-365/agents/pricing-paygo-always-available
3. **AWS Free Tier (new signups).** $100 immediate + up to $100 earned via activities, valid 6 months; no payment method required for most; Windows EC2 licensing billed separately (~$0.125/hr t3.large); resources lost at expiry with a 90-day recovery window. https://aws.amazon.com/free/
4. **Oracle Cloud Free Tier.** $300 trial credit / 30 days, card required, capacity errors common; **no usable free-forever Windows x86** (always-free AMD is 1 GB; Ampere ARM can't run Windows x86). https://www.oracle.com/cloud/free/
5. **Kamatera 30-day trial.** Up to $100 of any single server config, full platform access, card required, Windows + RDP (licensing add-on). Clean "full desktop now" alternative. https://www.kamatera.com/free-trial/
6. **Alibaba Cloud.** $90 credits / 3 months + 2C4G ECS 1-month trial; phone + card; company verification for enterprise offers. https://www.alibabacloud.com/free
7. **Google Cloud — blocked for our use.** $300 / 90 days, but **Windows Server VM images cannot be created while the billing account is a Free Trial** — must upgrade to paid billing first. https://cloud.google.com/free/docs/gcp-free-tier/#free-trial
8. **Hetzner / OVH — not viable:** no free trial credit; Hetzner Linux-only.

**Free-forever Windows x86 with a usable GUI: none.** The only long path is Azure's 750 hrs/month for 12 months.

## A.3 Free CI GUI runners for the 20-task golden suite

- **GitHub Actions `windows-2022` / pinned x64 `windows-latest` — primary.** Microsoft's runner-image maintainer confirms a genuinely interactive desktop (`UserInteractive=True`, `WinSta0`) on x64 x64 runners; WinAppDriver, Selenium and browsers are preinstalled; desktop screenshots as artifacts are proven. Free/unlimited for public repos; 6 h/job, 20 concurrent on Free. **Everything must run inside the workflow** — no inbound RDP; the reverse-RDP workaround repo was disabled by GitHub for a ToS violation. Pin the image and avoid `windows-11-arm` (OOBE/WSL/Start-menu popups steal foreground). https://github.com/actions/runner-images/issues/14049 · https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- **AppVeyor free OSS — for live watch/drive via RDP.** Documented RDP into the build worker, full admin, fresh VM; hard **60-minute job cap**, 1 concurrent job, 14-day no-card trial. https://www.appveyor.com/docs/how-to/rdp-to-build-worker/
- **Cannot work:** Azure Pipelines Microsoft-hosted ("visible UI testing not supported", no remote connect); AWS CodeBuild managed Windows (Server Core, no desktop); any external RDP into GitHub-hosted VMs (unsupported/ToS). https://learn.microsoft.com/en-us/azure/devops/pipelines/test/ui-testing-considerations · https://docs.aws.amazon.com/codebuild/latest/userguide/ec2-compute-images.html
- **CircleCI** has a `windows-server-2022-gui` machine image but no documented interactive-session guarantee or live view — proof-of-concept only ◐.

## A.4 Signup wall checklist (user action — I cannot do these)

- [ ] **Azure Free Account**: card (non-prepaid) + phone + Microsoft/GitHub account. Deploy `B2ats v2` Windows Server 2022 in an allowed region; confirm 8 GB RAM in portal; set auto-shutdown to avoid idle burn. **Prefer this.**
- [ ] **GitHub repo public** (or paid plan) for free unlimited `windows-2022` CI minutes; no card needed for public use.
- [ ] **Windows 365 trial** (optional, 30 days): Microsoft 365 tenant + card; set Day-27 cancellation reminder (auto-converts); enable local admin; plan to copy artifacts out before expiry.
- [ ] **Fallbacks only if Azure blocked**: AWS free tier (card may be requested), Kamatera (card), Oracle (card + capacity), Alibaba (phone + card).
- [ ] **If academic email available**: Azure for Students $100 credit, **no card**. https://azure.microsoft.com/en-us/free/students/
- [ ] **Signing (unchanged, B0.4)**: SignPath Foundation eligibility (free OSS) and Azure Artifact Signing eligibility (individual Public Trust US/Canada only) — check country/account type now.

## A.5 Revised workflow (how we actually work with this constraint)

**Local machine (4–5 GB usable):**
1. Write all code: `phantom-control`, Tauri UI, `phantom-vm` backends, `phantom-guest` source, tests.
2. Build/verify the **portable** Rust crates and Python tests: `scripts/verify-all.ps1` (cargo check, Rust tests, golden harness, Python tests) — no GUI VM needed.
3. Use Tauri **dev** mode for UI layout against mocked control-plane events; no live VM.
4. Commit per unit; keep CI green.

**Azure cloud VM (guest-agent proof + live runs):**
5. Deploy one B2ats v2 Windows Server 2022 VM; RDP with a thin client (guacamole/mstsc) — all heavy work is remote.
6. Enable autologon, install the built `phantom-guest`, run as a **per-user logon autostart** (never a service / Session 0).
7. Run B0.3: capture WGC → GDI fallback; verify non-black PNG + click inside the VM across 3 runs; record screenshot + logs.
8. Run the live desktop golden suite (20 tasks) remotely; measure latency/RAM.

**GitHub Actions (repeatable CI):**
9. Add a `windows-2022` job that runs the 20-task golden suite **inside the workflow** against a mock/prebuilt guest; pin the image; upload screenshots as artifacts. No local RAM cost.
10. Only use AppVeyor if a human must watch/drive via RDP (60-min cap).

**End-user beta (unchanged):** Hyper-V on the user's own Pro/Enterprise machine, or Windows 365 for users without Hyper-V ($36/user/mo) — the cloud VM is a **development/test tool**, not the shipped runtime.

## A.6 Decision log — everything returned, so nothing gets forgotten

| Topic | Returned finding | Where recorded |
|---|---|---|
| Local Docker Windows VM | Proven pattern (WAA/OSWorld) but needs 4–8 GB + Docker overhead → **rejected on RAM grounds**, superseded by cloud VM | §A.1 |
| Azure free | Best free path: 750 h/mo B2ats v2 Windows 12 months + $200/30 d | §A.2 #1 |
| Windows 365 trial | 30 d, 2vCPU/8GB, card, auto-converts, hibernates, local admin + Intune feasible, thin web client | §A.2 #2 |
| W365 for Agents | No free tier; $0.40/VM/h + $5/VM/mo; purpose-built MCP + screenshare | §A.2 #2 |
| AWS | $200/6 mo, Windows license extra | §A.2 #3 |
| Oracle | $300/30 d, no capacity guarantee, no free-forever Windows x86 | §A.2 #4 |
| Kamatera | $100/30 d any config, card | §A.2 #5 |
| Alibaba | $90/3 mo + 2C4G trial | §A.2 #6 |
| Google | Windows blocked on free trial until paid billing | §A.2 #7 |
| Hetzner/OVH | Not viable | §A.2 #8 |
| GitHub Actions | `windows-2022` interactive WinSta0, free, 6 h, no inbound RDP; pin image, avoid ARM | §A.3 |
| AppVeyor | Live RDP, 60-min cap | §A.3 |
| Azure Pipelines / CodeBuild | Cannot do headful GUI | §A.3 |
| Signing | SignPath free first; Artifact Signing $9.99/mo US/Canada individuals; no EV; Tauri NSIS, no MSIX | B5 + ADR-012 |
| Capture | WGC → GDI; DDA optional; interactive session only; coords desktop vs browser split | ADR-010 |
| Compliance | Local-by-default screenshots, consent, notices, VDP, EULA | B3/B5 |
| Verifier | 14 issues resolved, appendix in research report | research/phantom-beta-readiness.md |

## A.7 Updated immediate next action

1. **You complete the Azure signup** (§A.4) — this is the only external blocker; I cannot do signups or enter card/phone details.
2. In parallel I scaffold locally: `phantom-control` crate, `phantom-guest` WGC→GDI capture module with an abstraction over the live VM, and the `windows-2022` CI golden job.
3. Once the Azure VM exists, run B0.3 on it. If capture fails there too, we re-scope again before any GUI feature work.

**Honest note:** no free service removes the need for a real Windows interactive session — it just moves it off your 4–5 GB machine. Azure's 12-month free Windows VM is the best available way to get one.

## A.8 No-card options (verified 2026-11-18) — user chose AWS Free Tier

A follow-up verification stream checked strict no-credit-card signup. Ranked results:

1. **GitHub Actions `windows-2022` (public repo) — genuinely no card.** Free for public repos; 6 h/job; a workflow can launch a GUI app, capture the desktop screenshot and upload it as an artifact **with zero inbound RDP**. Best *first* no-card proof of B0.3 (non-black frame), though the interactive-session internals (WinSta0/session 1) are not officially documented — verify in-workflow with `query session` + pixel inspection. **Never use reverse-RDP/tmate into hosted runners** — third-party tmate debugging has caused real GitHub account suspensions. https://docs.github.com/billing/concepts/product-billing/github-actions · https://github.com/marketplace/actions/create-a-desktop-screenshot
2. **AppVeyor free OSS / 14-day trial — no card**, genuine live RDP with admin into the build worker, but **60-minute hard job cap** and RDP availability on the free OSS tier is unverified. https://www.appveyor.com/pricing/ · https://www.appveyor.com/docs/how-to/rdp-to-build-worker/
3. **AWS Free Tier (selected by user).** Payment method is **not required for most new customers**, but AWS "may request additional information, such as a payment method, to verify your identity" — card may be forced. Credentials: $100 at signup + up to $100 through activities, valid 6 months. **Windows Server license is bundled into the hourly EC2 price** (plus 2 RDS admin licenses, no CALs), so Windows runtime burns credits; no separate free Windows EC2 entitlement. https://aws.amazon.com/free/free-tier-faqs/ · https://aws.amazon.com/windows/resources/licensing/
4. **Azure for Students — no card**, $100 / 12 months, full subscription supports Windows VM + RDP, but requires 18+ full-time student status verified by school email. https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0170p
5. **Card required (excluded):** standard Azure free account, Google Cloud trial, Oracle Cloud Free Tier, Kamatera, Alibaba Cloud.

**Decision:** proceed with **AWS Free Tier** (user's choice). Fallbacks in order if identity verification forces a card or credits run out: GitHub Actions `windows-2022` (no card, in-workflow proof), AppVeyor (live RDP, 60 min), Azure for Students (if eligible). Signup page opened for the user at `https://signin.aws.amazon.com/signup?request_type=register`; credentials are handled by the user only.
