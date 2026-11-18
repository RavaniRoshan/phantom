# Phantom — Full deep-research report: Windows beta readiness

**Date:** 2026-11-18 · **Depth:** deep · **Status:** verified (8 research streams + 1 adversarial verifier)

## Method and integrity notes

This is the **complete** deep-research workflow: eight independent sub-question streams ran in parallel, then exactly one adversarial verification subagent reviewed every finding. All nine subagents initially failed on an account-level free-usage quota; they were relaunched with an explicitly selected model (`opencode/hy4-flash-free`) and completed. The verifier returned **14 issues**; all are resolved in §"Verification issues and resolutions" — none were silently dropped.

**Legend:** ✅ confirmed against the primary source by direct fetch or verifier · ◐ subagent-sourced with a cited URL, not re-fetched here · ⚠️ carried with an explicit caveat · ❌ corrected by the verifier.

---

## Executive summary

Phantom has working correctness/safety code but no deliverable: no GUI, no concrete VM backend, no signed installer, no provider onboarding, no beta compliance surface. The research converges on a concrete, mostly free path:

- **GUI:** Tauri 2 + a Rust daemon-owned control plane; Electron is the runner-up if Windows shell integration matters more than installer size. Comparable AI apps mostly ship Electron; Jan is the Tauri precedent.
- **VM:** local Hyper-V with a Windows golden image and an **in-guest control agent** running in the *interactive console session*. The hidden desktop fails for a fundamental OS reason; disconnected RDP fails the same way. Microsoft's own **Windows 365 for Agents** architecture validates the guest-agent + control-plane + separate human-observation channel design.
- **Capture:** Windows.Graphics.Capture or GDI as the reliable path; DXGI Desktop Duplication only as a GPU-dependent fast path with a fallback. Never host-side `PrintWindow`.
- **Signing/distribution:** Tauri NSIS per-user installer; **SignPath Foundation free OSS signing** first, **Azure Artifact Signing $9.99/month** fallback (individual Public Trust is US/Canada only), OV last resort. EV no longer buys SmartScreen reputation. Tauri cannot produce MSIX.
- **Models:** BYOK only. Gemini Flash-Lite free default with explicit data-use consent; paid Gemini 3.8 Flash for EU/no-training; OpenRouter/Groq/NVIDIA as constrained fallbacks; local Qwen3-VL optional.
- **Compliance:** screenshots stay local by default; consent, retention controls, per-app/per-category scoping, third-party notices, and a vulnerability disclosure policy are beta blockers, not polish.

**Dominant risk remains VM capture correctness** — the same area that already failed once. It is a hard gate before GUI work.

---

## Background / key terms

- **Control plane**: authenticated local API owning tasks/events; the GUI is only a client so background runs survive window close.
- **Guest agent**: process inside the VM's interactive user session (never Session 0) that captures, injects input and exposes UIA. WAA starts it via an on-logon script with AutoLogon.
- **WGC / DDA / GDI**: Windows.Graphics.Capture, DXGI Desktop Duplication, GDI BitBlt — three capture APIs with different session/GPU behavior.
- **BYOK**: bring-your-own-key; provider terms generally allow customer applications and end users but prohibit resale or pooled keys.
- **Sandbox vs approvals**: sandbox = what resources are reachable; approvals = when the agent pauses. Separating them is the current Codex/ChatGPT pattern.
- **NSIS / MSIX / MSI**: installer formats; MSIX gives package identity (notifications/background tasks) but requires signing and cannot be produced by Tauri.

---

## Findings by sub-question

### 1. Windows GUI stack

- Tauri 2 uses the OS WebView2 renderer; installer modes add ~1.8 MB (embedded bootstrapper), ~127 MB (offline) or ~180 MB (fixed runtime); WebView2 already ships with Windows 11 and most Windows 10 devices ✅.
- A single N=1 macOS benchmark measured Tauri 8.6 MiB vs Electron 244 MiB and 172 MB vs 409 MB RAM — directional only ◐.
- Comparable apps: **reportedly Electron** for Codex, Claude Desktop, LM Studio (Electron 37.2.0), Msty, and the VS Code-fork IDEs (Cursor/Windsurf/Antigravity); **Jan is Tauri 2** (@tauri-apps/cli ^2.7.0) ◐ (Codex stack softened by verifier issue #2).
- Tauri strengths: capability-scoped IPC + CSP; Rust backend reuses Phantom's existing crates; signed updater mandatory ✅.
- Tauri weaknesses with issue links: notification plugin only works for installed apps and shows "powershell" in development; Windows bug #3512 forces `Notification.permission = "denied"`; tray issues #14795/#16129/#7920; WebView2 absence bug #12929; JSON-serialized IPC needs batching for token/screenshot streams ✅/◐.
- Electron tray GUID behavior (corrected by verifier #6): a **signed** exe ties the GUID to the signature so it survives path changes; an **unsigned** exe ties it to the executable path, which persists only while the path does not change ✅.
- WinUI 3 unpackaged has no package identity → no Store auto-update/background tasks; many open issues (IME, single-file publish, memory) ◐. Windows 10 reached EOL 2025-10-14 ✅.
- Accessibility: Electron enables Chromium's a11y tree for assistive tech; WebView2 UIA has NVDA/JAWS issues disputed by the reporter; egui's AccessKit has gaps; Avalonia 12 has full UIA but is C#/XAML ◐.

**Decision:** Tauri 2 primary, Electron runner-up. Risk mitigations: batch IPC, pre-verify tray/toast in a clean VM, plan for mandatory signing.

### 2. Free/cheap isolated Windows environments

- Hyper-V: free in Win10/11 Pro/Enterprise (not Home), real interactive desktop, full PowerShell automation including `Checkpoint-VM` ✅. **Each Windows guest needs its own license** (Microsoft Q&A) ✅. 20×8 GB guests are not viable on a normal workstation ◐.
- Windows Sandbox: free, Pro/Enterprise/Education only, real desktop, configured by `.wsb`, **strictly ephemeral**, single instance, no snapshot API ✅.
- Windows 365: **$36 / $56 / $108.80 user/month** for 2/4/8 vCPU plans; 30-day trial (one per version per customer, card required, cancellation deletes data) ✅. Managed via Graph/Intune; real interactive desktop.
- Azure: $200/30-day free account plus 750 h/month B1s for 12 months (1 GB RAM is marginal); retail eastus D2s_v5 Windows $0.188/h PAYG, $0.0397/h Spot; Spot has 30-second eviction, no SLA, B-series unsupported, and Deallocate still bills disks ✅. Auto-shutdown exists but stops the desktop session.
- AWS new free tier (accounts from 2025-07-15): $100 + up to $100 more, 6-month credit cap; Windows consumes credits ◐.
- GitHub Actions `windows-latest` has a real graphical session and is documented for GUI tests ✅; jobs cap at 6 h, Free plan 20 concurrent, Windows $0.010/min. A runner maintainer says resolution is not controllable ◐ (single-source claim, **not** a disagreement). Self-hosted runners installed as a Windows service run non-interactively — the exact failure Phantom already hit ◐.
- VPS: Vultr 1 CPU/2 GB $10 + $16 Windows license, billed even when off; Hetzner has no official Windows; Oracle Always Free has no Windows image and reclaims idle instances ✅.
- ❌ Contabo correction (verifier #1): the cited page says Windows is a **paid add-on**, not a no-cost line item. Only the €4.40/month excl. VAT 24-month *Linux* price is supported; actual Windows pricing is **unknown** — carried as a limitation.
- Windows Server 2025 evaluation ISO: 180 days, must activate within 10 days, evaluation licensing not for customer-facing production ✅.

**Decision:** Hyper-V + evaluation guests for the first implementation (with the licensing caveat reviewed before external beta); Windows 365 only for users without Hyper-V and only if the per-seat cost is accepted. Cloud VPS pricing is unresolved.

### 3. Capture + input inside the VM — the critical stream

- Hidden `CreateDesktopW` desktops cannot be captured: no paint calls on an inactive desktop, stale thumbnails; `PW_RENDERFULLCONTENT` is per-window and cannot fix this ✅. This directly explains Phantom's three all-black captures.
- Disconnected/minimized RDP blanks GDI captures and stops input; the console-bound `tscon <id> /dest:console` workaround is community practice (Microsoft's "You can't connect to the console session" refers to connecting *to* console as a target, a different semantic — **not** a contradiction; verifier #9) ◐.
- Hyper-V Enhanced Session is RDP over VMBus: treat RDP as a **human viewer transport**, not the agent's control channel ✅.
- Capture APIs: DDA gives BGRA8 frames, dirty rects, pointer shape and per-output rotation, but needs `ACCESS_LOST` recovery ✅. It produces black/zero frames in some RDP/GPU/driver combinations; WGC works in some of those cases and ShareX fell back to `gdigrab` ✅. These are **context-dependent failure modes**, not contradictory claims (verifier #11). Always ship a fallback.
- **Microsoft Windows 365 for Agents** is the strongest architectural precedent: Create (Graph/Intune, pool, on-box agent), Get (checkout via gateway, `Ready` or 503), **Do** (MCP relay with **72 tools**: 3 session + 28 desktop + 41 browser — 62/65 figures dropped per verifier #7), **See** (WebRTC human observation on a separate link); reset on release, quarantine failures ✅.
- Tool contract corrected by verifier #8: desktop tool coordinates are in screenshot/screen pixels, but `browser_click_xy`/`browser_scroll_xy` use **CSS viewport pixels** — "not interchangeable" ✅.
- WAA precedent: QEMU/KVM, noVNC on :8006, Flask guest server on :5000 started by `on-logon.ps1`, AutoLogon (`LogonCount 65432`), pyautogui + PIL ImageGrab (GDI), `win32`/`uia` accessibility backends — explicitly an interactive session, never session 0 ✅.
- OSWorld separates VM lifecycle providers from guest observation/action; Anthropic's reference demo is Linux Docker + X11 + VNC and warns about weak separation/one session at a time ✅.
- Headless displays: RustDesk reports "Connected, waiting for image" with no active framebuffer; fixes are a real monitor, HDMI/DP dummy plug, or an IddCx virtual display; Windows sometimes creates an ≤800px dummy display that defeats detection; cursor can be lost. VDDs can break the Hyper-V VMConnect viewer, so keep the synthetic display primary ✅.
- Input: `SendInput` is subject to UIPI with **silent failures**, does not reset key state, is serialized, and RDP may need real scan codes ✅. Clipboard is contended (`OpenClipboard` failures); W365 defaults to clipboard paste with restore ✅.
- DPI: DPI-unaware threads get virtualized coordinates; use per-monitor-v2 awareness and set it before creating UI; return image dimensions with every screenshot ✅.

**Recommended architecture (text diagram):**

```
HOST (Windows app + daemon)
  ├─ orchestrator / model loop (coordinates in screenshot pixel space)
  ├─ control client: authenticated JSON-RPC/WS  → screenshot, click,
  │    type_text, uia_invoke, clipboard_*; acquire → ready → act → release
  └─ observer: WebRTC / H.264 over a SEPARATE link for human watch + takeover
                    │ control channel            │ media
                    ▼                            ▼
GUEST (Hyper-V Gen2 VM / custom-image Cloud PC)
  ├─ autologon at fixed resolution, 100% scaling; NO hidden desktop
  ├─ guest agent in INTERACTIVE session (on-logon, never a service)
  │   ├─ capture: Windows.Graphics.Capture → GDI fallback; DDA optional fast path
  │   ├─ input: SendInput (scan codes, key-state checks) + UIA fast path
  │   ├─ DPI: PMv2 aware; image size reported with every frame
  │   └─ clipboard: save/restore, retry, tolerate rdpclip
  └─ display: keep Hyper-V synthetic display primary; dummy plug / IddCx if headless
VM LIFECYCLE PLANE (separate): Hyper-V PowerShell or Graph/Intune
  create → checkout → wait Ready → act → reset/release → quarantine
```

**Top pitfalls:** (1) any non-active desktop → black frames; (2) RDP as agent transport; (3) agent in wrong session/integrity level; (4) coordinate/DPI mismatch; (5) pointer, clipboard and display plumbing.

### 4. Provider configuration / onboarding (BYO keys)

- Discovery is uneven: OpenAI `/v1/models` has no capability metadata; Anthropic exposes capabilities + lifecycle; Gemini exposes generation methods and limits with `models/` prefix; OpenRouter exposes pricing/context with `-1` sentinel that breaks naive price sorting ✅/◐.
- `GET /api/v1/key` is a low-cost validation + quota endpoint for OpenRouter ✅.
- Validate-on-save is implemented by Jan (distinguishes 401/403/429/network) and Chatbox; Cursor deliberately defers validation and users complain about the missing verify button; Msty uses "save, then test in chat" ◐.
- Base-URL traps: missing trailing `/v1` → 404; keyless local servers still need a placeholder key; "OpenAI-compatible" is a family, not a format; empty model lists are a recurring support case ◐.
- Storage: Credential Locker allows only **20 credentials per app** ✅ → one encrypted blob. Codex itself ships a plaintext `auth.json` file mode, so portability modes exist ◐.
- Fallback/cost: Claude Code uses ordered `fallbackModel`; `/usage` computes local list-price estimates ◐.

**Decision:** one provider record shape, validate on save, capability precedence live→table→unknown, one credential blob, model pill in composer.

### 5. Packaging / signing / updates

- **Artifact Signing** (formerly Trusted Signing) Basic **$9.99/month** (5,000 signatures), Premium **$99.99/month** (100,000), $0.005 overage, billed from account creation and not prorated ✅. Individual Public Trust is **US/Canada only**, requires an Individual Azure billing account matching government ID; free/trial/sponsored subscriptions rejected; validation 1–30 business days ✅. No EV certificates; keys in FIPS 140-3 L3; Signtool/GitHub Actions integration ✅.
- Tauri v2 supports `bundle.windows.signCommand` with `artifact-signing-cli` ✅.
- **SignPath Foundation** offers free code signing for qualifying OSS (OSI license, no commercial dual license/proprietary components, active maintenance, prior release, MFA + author/reviewer/approver roles, code-signing policy page, manual per-release approval, "verifiable reputation"); certificate publisher is "SignPath Foundation", not the app author ◐.
- Self-signed = same SmartScreen treatment as unsigned ✅. EV no longer provides special SmartScreen treatment — the Microsoft doc gives no year, so "since 2024" was dropped (verifier #4) ✅.
- Manual submission: the SmartScreen doc says there is no mechanism for consumer endpoints, while the Artifact Signing FAQ advises submitting to Microsoft Security Intelligence — **both are presented** rather than declaring silence (verifier #5) ✅.
- Smart App Control can block unknown executables even without a browser download ✅. Microsoft Store individual registration is currently free ($19 waived); Store-signed MSIX avoids SmartScreen, but **Tauri cannot produce MSIX** — its Store path links an externally signed EXE/MSI installer ◐.
- MSIX: clean install/uninstall, 64 KB block differential updates, package identity; **must be signed**; containerized; no drivers/custom actions ◐.
- Tauri NSIS installs per-user into `%LOCALAPPDATA%` without admin; `embedBootstrapper` ~1.8 MB; MSI bundler uses WiX v3 and builds only on Windows ◐.
- Squirrel.Windows is deprecated → Velopack; winget distribution is free but AV false positives are an explicit rejection reason ◐.
- Tauri updater: generated key pair, `.sig` + `latest.json`, passive install, signature verification cannot be disabled; rollback by repointing `latest.json` with a custom `version_comparator` ✅.
- Python sidecar: Tauri `externalBin` needs a target-triple suffix; python-build-standalone `install_only` Windows x64 ~45–51 MB compressed before dependencies; PyInstaller onefile extraction triggers AV heuristics (onedir better, Nuitka fewer false positives) ◐.

**Decision:** Tauri NSIS per-user + embedded WebView2 bootstrapper; SignPath first, Artifact Signing fallback, OV last resort; signed updater with rollback. MSIX is a later, separate packaging project, not a Tauri target.

### 6. Beta user flow

- ChatGPT's documented quickstart is four steps (install → sign in → choose where to work → first message); workspace choice is a first-class first-run step ✅. The "value in 10 seconds / task in 1 minute" quote was **dropped** — it is not in the cited page (verifier #3).
- Undiscoverable capability rules cause real abandonment: a Cursor user lost 2–3 days and said less patient users would quit in under a day; Cursor staff confirmed no onboarding wizard for rules ◐.
- Claude computer use: explicit enable toggle, **per-app permission prompts**, blocklist, sensitive categories blocked by default, screenshot privacy disclosure, and an explicit "no sandbox" statement ◐.
- Codex/ChatGPT make sandboxing the trust cue and separate sandbox from approvals; "Ask for approval" is the recommended default; the permission control sits below the composer ✅/◐.
- Expectations matter: Claude labels computer use beta, warns complex tasks may need a second try and the desktop must be awake; Operator front-loads research-preview limits ◐.
- Task creation is chat-led with saved prompts; Codex uses one-thread-one-task, inline plans, "Done when" criteria and plan mode ◐.
- NN/g: skipping clarifying questions led to 6 minutes of research and 11 minutes on a 2-minute form; screenshots build trust but source-pill behavior was inconsistent; too many decision gates erode the value proposition ◐.
- Copilot Studio offers session replay with screenshots, step logs (type/coordinates/timestamp), run summaries, export, configurable verbosity and retention, plus built-in credentials because authentication was a top stall reason ◐.
- Approval UX: name the exact action ("Submit the order?"), not "Continue"; Operator defines takeover for credentials/payments (no screenshots while typing), confirmations, declining high-stakes tasks, and watch mode ◐.
- Jules shows an expandable plan and auto-approves on a timer. This and Operator's explicit confirmations are **design contrasts**, not contradictory facts (verifier #12) ◐. Same for Codex/Copilot's isolated boundary vs Claude's no-sandbox.
- Stale progress UI is real: Codex issue #14390 reports a checklist frozen at "0 of 5" while later steps completed ◐.
- Background runs land in a review queue; threads persist across hard close ◐. No non-technical-facing cost UI was found. Watch mode / monitor models are the cited injection defense ◐.

**Decision:** tray + main window (task rail, composer with "Done when", live VM view, step timeline), approval modal with exact action + Edit & approve + Take over, history with replay, settings with permission/privacy sections, 3-screen first-run welcome with scope + screenshot consent.

### 7. Free/cheap LLM inference

- Gemini free tier includes 4 Hydrogen, 3.8 Flash, 3.6 Flash, 3.5/3.1 Flash-Lite; free-tier content **is used to improve products**, paid is not; 3.8 Flash paid $0.75 in/$3.75 out per 1M through 2026-12-31 ✅.
- Per-model RPM/RPD are not published; third-party claims range from 20 to ~1,500 RPD — **unresolved**, read the project's AI Studio quota ◐/⚠️.
- OpenRouter `:free`: 20 RPM and 50 RPD with <10 lifetime credits; 1,000 RPD with ≥10 ✅. ~8 vision-capable free models ◐.
- Groq free: `qwen/qwen3.8-27b` 30 RPM / 1,000 RPD / 8K TPM / 200K TPD; vision max 3 images (~2,048 tokens each), so ~3 screenshots/minute; no training by default, ZDR available ✅/◐.
- Cerebras: $5 trial for 30 days requiring a card; NVIDIA NIM: 1,000 credits/month, no card, OpenAI-compatible, but prototyping/evaluation terms only; **GitHub Models retired 2026-07-30** ✅.
- Local: Qwen3-VL (Apache-2.0, 2B–32B, Ollama 1.9–21 GB), UI-TARS-1.5-7B (OSWorld 27.5 / ScreenSpot-Pro 49.6), Holo2 4B–235B (ScreenSpot-Pro 57.2%–70.6%), with a large frontier-vs-local grounding gap on the leaderboard ◐.

**Decision:** Gemini Flash-Lite free + consent as default; Gemini 3.8 Flash paid; local Qwen3-VL for offline; OpenRouter/Groq/NIM demos only.

### 8. Legal / licensing / compliance

- Apache-2.0 obligations; `cargo-deny` + notice generators; MPL-2.0 file-level copyleft with source offer, LGPL-3.0 relink obligations; PSF license permits bundling CPython with notices and change summary; WebView2 SDK BSD-3 notice and runtime EULA/diagnostic-data disclosure; Chromium BSD + FFmpeg LGPL if bundled ✅.
- Since 2023-06-01, CA/B Forum requires code-signing keys in FIPS 140-2 L2+ hardware ✅.
- GDPR: Art. 6 legitimate-interest test, Art. 7 consent, **Art. 9 special-category data can appear in screenshots**, Art. 28 processor contract if data leaves the device, Art. 33 72-hour breach notification ✅. CCPA thresholds likely exclude a closed beta ◐.
- Provider ToS: OpenAI and Anthropic permit customer applications/end users but prohibit resale, key transfer and competing-model training; Anthropic requires informing end users of computer-use risks and obtaining consent; OpenRouter prohibits resale ✅.
- Gemini terms restrict to developer/professional use, 18+, and in EEA/CH/UK allow only **Paid Services** when making API clients available to users. ❌ Verifier #13: whether free-tier AI Studio access counts as "Paid Service" depends on the Cloud Project's active billing account, so the correct statement is **"likely prohibited — needs legal review"**, not a definitive breach finding.
- EU Consumer Rights Art. 16(m) requires express consent + withdrawal-right acknowledgment for digital content; AI Act Art. 50 transparency applies from 2026-08-02 (AI literacy since 2025-02-02); Cyber Resilience Act vulnerability reporting from 2026-09-11 ✅.
- CISA distinguishes VDP (intake) from CVD (triage/advisory); publish `SECURITY.md`/`security.txt` ✅.
- Export: BIS mass-market provisions (5D992.c / 740.17 self-classification); the PSF FAQ's "5D002 mass market" wording could not be re-checked because the cited page returned HTTP 503 — **carried as an unresolved limitation**, with the word "outdated" dropped (verifier #14) ⚠️.

**Decision:** minimum beta compliance = local-by-default screenshots + retention controls, privacy notice, provider ToS pass-through with BYOK only, explicit computer-use consent, EULA with EU withdrawal acknowledgment, third-party notices, security policy, AI disclosure.

---

## Analysis and discussion

**Patterns across sources.** Three independent ecosystems (Microsoft's W365 for Agents, WAA, OSWorld) converge on the same architecture: isolate the OS, keep the agent inside the interactive session, expose a small action/screenshot API, and separate human observation from the control channel. This is strong evidence that Phantom should not try to make RDP or `PrintWindow` work.

**Competing perspectives.** Electron wins on release maturity and tray/toast behavior (and is what most comparable apps ship); Tauri wins on installer size, Rust reuse and IPC security, but has documented Windows notification/tray/WebView2 gaps. The decision is therefore about which risk you prefer: shell-integration bugs vs. bundle size and a second runtime. Similarly, approval strictness differs by product (Operator's explicit confirmations vs Jules's auto-approve timer) — Phantom should choose based on action reversibility, not copy one.

**Strengths/weaknesses of the evidence.** Signing, pricing, provider terms and API limits are well sourced from primary documents. Weakest areas: local-model grounding numbers (vendor/leaderboard), cheap-VPS Windows costs (Contabo correction), Gemini free RPD (third-party conflict), and any claim about measured beta-user abandonment (qualitative only).

**Cost reality.** Free local Hyper-V is viable for development but guest licensing and hardware bound scale; Windows 365 is $36/user/month; Azure Spot is cheap per hour but interruptible; signing can be free (SignPath) or $9.99/month (Artifact Signing). Cost is not the dominant blocker — engineering correctness is.

---

## Conclusions and implications

1. The GUI cannot be built on the current daemon; a control plane is a prerequisite.
2. The VM guest-agent spike is the single highest-value validation. If it produces a stable non-black frame in the interactive session, the rest of the plan is low-risk engineering.
3. Signing and compliance are schedule blockers if started late; SignPath eligibility and Azure account type must be checked in week 1.
4. "Free" infrastructure shifts cost to engineering time and licensing review; do not promise free Windows VMs to 20 users.
5. Do not ship until live desktop golden tasks pass **inside the VM** and the §1 gates are honestly green.

## Recommendations — immediate actions

1. Run the guest-agent spike with WGC → GDI capture and an interactive autologon session; add DDA only as an optional fast path.
2. Build `phantom-control` before the GUI; keep the GUI a thin client.
3. Check SignPath eligibility and Azure Public Trust eligibility (US/Canada individual) in parallel; choose the signing path before packaging work.
4. Add a product-level consent flow: computer-use risks, screenshot capture, retention, provider data-use (especially Gemini free tier), and EEA paid-tier handling.
5. Rewrite `docs/BETA-BUILD-PLAN.md` to reflect verified signing/VM/licensing constraints (done in this repo).

## Further research

- Exact Artifact Signing price by region/entity and SignPath acceptance for Phantom.
- Real Hyper-V guest licensing cost for a closed beta.
- Tauri IPC throughput for per-token/per-frame streaming.
- Whether Windows.Graphics.Capture needs special consent for full-monitor capture in 24H2/25H2.
- Measured first-task-completion rate for 5 beta users.

---

## Disagreements and open questions (post-resolution)

**Resolved / relabeled by verifier:** Contabo licensing (dropped), Codex Electron (softened), "10 seconds" quote (dropped), EV year (dropped), SmartScreen manual submission (both docs presented), Electron tray GUID (rewritten), W365 tool count (72), coordinate spaces (desktop vs browser), tscon semantics (no disagreement), runner resolution (single source), DDA/WGC (context-dependent), Operator-vs-Jules and sandbox contrasts (design divergence), Gemini EEA (softened), PSF export (unresolved).

**Still open:** Gemini free RPD; Contabo Windows price; Windows Server eval EULA for external users; Tauri streaming throughput; WGC consent requirements; VDD inside Hyper-V; beta-user abandonment measurement; EU AI Act classification; exact WebView2 Runtime EULA terms.

---

## Full source list

**Primary/verified:** https://tauri.app/ · https://v2.tauri.app/distribute/windows-installer/ · https://v2.tauri.app/plugin/updater/ · https://v2.tauri.app/plugin/notification/ · https://v2.tauri.app/security/ · https://v2.tauri.app/distribute/microsoft-store/ · https://v2.tauri.app/distribute/sign/windows/ · https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution · https://learn.microsoft.com/en-us/lifecycle/products/windows-10-home-and-pro · https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/install-hyper-v · https://learn.microsoft.com/en-us/powershell/module/hyperv/checkpoint-vm · https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-overview · https://www.microsoft.com/en-us/windows-365/business/compare-plans-pricing · https://azure.microsoft.com/api/v3/pricing/artifact-signing/calculator/?culture=en-us&discount=mca · https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart · https://learn.microsoft.com/en-us/azure/artifact-signing/faq · https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation · https://learn.microsoft.com/en-us/windows/msix/overview · https://learn.microsoft.com/en-us/windows/apps/develop/security/credential-locker · https://github.com/microsoft/windows-365-for-agents (+ docs/architecture.md, sessions.md, screen-sharing.md, mcp-tools.md) · https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api · https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput · https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows · https://github.com/microsoft/WindowsAgentArena · https://github.com/xlang-ai/OSWorld · https://ai.google.dev/gemini-api/docs/pricing · https://openrouter.ai/docs/api-reference/limits · https://console.groq.com/docs/rate-limits · https://docs.github.com/en/github-models · https://developers.openai.com/codex/permission-modes · https://learn.chatgpt.com/docs/permission-modes · https://learn.chatgpt.com/docs/app · https://www.apache.org/licenses/LICENSE-2.0 · https://docs.python.org/3/license.html · https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.2903.40/License · https://gdpr-info.eu/art-9-gdpr/ · https://openai.com/policies/services-agreement/ · https://www.anthropic.com/legal/commercial-terms · https://ai.google.dev/gemini-api/terms · https://artificialintelligenceact.eu/article/50/ · https://www.cisa.gov/resources-tools/programs/coordinated-vulnerability-disclosure-cvd-program

**Subagent-sourced (cited, not re-fetched):** https://news.ycombinator.com/item?id=46859673 · https://www.dbreunig.com/2026/02/21/why-is-claude-an-electron-app.html · https://github.com/menloresearch/jan/blob/main/package.json · https://www.gethopp.app/blog/tauri-vs-electron · https://github.com/tauri-apps/plugins-workspace/issues/3512 · https://github.com/tauri-apps/tauri/issues/12929 · https://www.fluxzy.io/resources/blogs/electron-to-tauri-migration-fluxzy-desktop · https://prices.azure.com/api/retail/prices · https://learn.microsoft.com/en-us/azure/virtual-machines/spot-vms · https://learn.microsoft.com/en-us/windows/apps/develop/ai-assisted/testing · https://docs.github.com/en/actions/reference/limits · https://github.com/orgs/community/discussions/67003 · https://contabo.com/en/vps/ · https://www.vultr.com/pricing/ · https://www.microsoft.com/en-us/evalcenter/download-windows-server-2025 · https://signpath.org/terms · https://github.com/Levminer/artifact-signing-cli · https://github.com/velopack/velopack · https://github.com/astral-sh/python-build-standalone · https://www.pythonguis.com/faq/problems-with-antivirus-software-and-pyinstaller/ · https://stackoverflow.com/questions/4580520/ · https://stackoverflow.com/questions/5493200/ · https://superuser.com/questions/767397/ · https://github.com/robmikh/Win32CaptureSample/issues/47 · https://github.com/ShareX/ShareX/issues/9113 · https://rustdesk.com/blog/rustdesk-connected-waiting-for-image · https://github.com/VirtualDrivers/Virtual-Display-Driver · https://github.com/anthropic/claude-quickstarts/tree/main/computer-use-demo · https://platform.openai.com/docs/api-reference/models/list · https://platform.claude.com/docs/en/api/models/list · https://ai.google.dev/api/models · https://openrouter.ai/api/v1/models · https://docs.jan.ai/desktop/remote-models/custom-endpoint · https://cursor.com/help/models-and-usage/api-keys · https://forum.cursor.com/t/no-verify-button-when-setting-custom-openai-api-key-in-settings-models/140843 · https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork · https://openai.com/index/introducing-operator/ · https://jules.google/docs/review-plan/ · https://github.com/openai/codex/issues/14390 · https://www.nngroup.com/articles/impressions-chatgpt-agent/ · https://www.microsoft.com/en-us/copilot/blog/copilot-studio/computer-using-agents-now-deliver-more-secure-ui-automation-at-scale/ · https://github.com/QwenLM/Qwen3-VL · https://hcompany.ai/holo2 · https://gui-agent.github.io/grounding-leaderboard/ · https://cabforum.org/working-groups/code-signing/requirements/ · https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32011L0083 · https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act · https://media.bis.gov/learn-support/encryption-controls/mass-market

---

## Appendix — verification issues and resolutions (all 14)

| # | Issue | Action taken |
|---|---|---|
| 1 | Contabo Windows "no license line" contradicted source | Dropped; Windows price unknown |
| 2 | Codex = Electron rests on HN comment | Softened to "reportedly Electron" |
| 3 | "10 seconds / 1 minute" quote not in cited docs | Dropped |
| 4 | "EV lost SmartScreen since 2024" invented year | Dropped year, kept behavior |
| 5 | SmartScreen manual submission mischaracterized | Both MS docs presented |
| 6 | Electron tray GUID "only signed" misstatement | Rewritten: signed survives path change |
| 7 | W365 tool count 62/65/72 unsupported | Dropped 62/65; kept 72 |
| 8 | Coordinates overgeneralized | Split desktop pixels vs browser CSS pixels |
| 9 | tscon labeled disagreement | Label dropped (different semantics) |
| 10 | Runner resolution labeled disagreement | Label dropped (single source) |
| 11 | DDA vs WGC labeled disagreement | Relabeled context-dependent failure modes |
| 12 | Product approval/isolation differences labeled disagreement | Relabeled design contrasts |
| 13 | "EU free-tier breach" legal inference | Softened to likely prohibited / legal review |
| 14 | PSF export claim source unreachable | Dropped "outdated"; carried as unresolved |
