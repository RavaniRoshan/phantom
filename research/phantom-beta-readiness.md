# Phantom — Beta readiness research (Windows-only, 2026-11-18)

**Depth:** deep. **Method:** 8 decomposed sub-questions researched in parallel, then adversarial verification; subagent quota failure forced the remaining primary research and the verification pass into the main session.

**Verification legend:** ✅ verified by fetching the primary source in this session · ⚠️ reported by a research subagent with a source URL but **not re-verified** here · ❌ contradicted/corrected.

---

## Executive summary

Phantom's code-level correctness and safety work is done, but three gaps stand between the repo and a beta a user can actually install and trust: **(1)** there is no Windows application — only a TUI and a trigger-only daemon; **(2)** the isolated-VM backend is a trait plus a mock, with no concrete Hyper-V or Cloud PC implementation; **(3)** there is no signed, auto-updating installer, provider onboarding UI, or beta compliance surface.

The good news is that every one of these has a well-trodden path, and most of the infrastructure can be free: local **Hyper-V is built into Windows 10/11 Pro/Enterprise** ✅, the **Windows 11 Enterprise Evaluation ISO** is a legal free VM image for a golden image ✅, **Gemini Flash-Lite / OpenRouter `:free` / Groq / NVIDIA NIM** provide a free model budget ✅, **Azure Artifact Signing** provides managed code signing ✅, and **Tauri 2** gives a small Rust-native GUI that reuses the existing `phantom-core` ✅. The dominant risks are not cost — they are VM capture correctness (the exact area that already failed once), GUI↔daemon integration, and free-tier data-privacy terms (Gemini free tier uses submitted content to improve products ✅).

---

## Findings by sub-question

### 1. Windows desktop GUI stack

- Tauri 2.0 is a Rust-backed, frontend-independent framework using the OS web renderer; an app can be as small as **600 KB** before assets, and it targets Windows from one codebase ✅ (https://tauri.app/).
- This matches Phantom unusually well: `phantom-core`, `phantom-vm`, and the gRPC client are all Rust, so the GUI can drive them directly through Tauri commands instead of inventing a second IPC protocol.
- Codex itself is now surfaced primarily through the **ChatGPT desktop app** (with CLI/IDE/web variants), i.e. a GUI with a permissions control below the composer ✅ (https://developers.openai.com/codex/, https://developers.openai.com/codex/permission-modes).
- ⚠️ Electron remains the most mature path for complex streaming UIs (Codex/Claude Desktop/Cursor-class apps), at the cost of bundle size and a separate Node runtime; Jan, LM Studio and Msty were cited as smaller open-source AI app precedents.
- ❌ Correction: "Azure Trusted Signing" is now branded **Azure Artifact Signing** in Microsoft's 2026 docs ✅ (https://learn.microsoft.com/en-us/azure/artifact-signing/overview).
- ⚠️ Tauri WebView2 bootstrap, tray/notification quirks and updater signing pain are the reported integration risks; these need a one-week spike, not a six-month bet.

**Decision:** Tauri 2 primary, Electron runner-up if the streaming UI proves too constrained.

### 2. Free / cheap isolated Windows environments

- Hyper-V is built into Windows 10/11 **Pro or Enterprise** (not Home), needs SLAT + VT-c and ≥4 GB RAM, and can be enabled with `Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All` ✅ (https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/install-hyper-v).
- Windows Agent Arena (Microsoft, MIT) builds a **30 GB Windows 11 golden image** from the free **Windows 11 Enterprise Evaluation ISO (90-day trial)**, hosts a Python server inside the guest that executes agent commands, and exposes the VM over a browser at `localhost:8006`; local runs default to 8 GB RAM / 8 cores and can be cut to 4 GB / 4 cores ✅ (https://github.com/microsoft/WindowsAgentArena).
- WAA's own cost table cites **~$8 for an Azure Standard_D8_v3 VM** for a 40-task parallel benchmark, with GPT-4o-mini inference ~$15 ✅ (same source). That is a credible upper bound for occasional cloud bursts, not a monthly bill.
- OSWorld documents host–client VM providers (VMware, VirtualBox, Docker/KVM, AWS, Modal, Daytona) and explicitly recommends **injecting secrets at VM startup rather than baking them into the guest image** ✅ (https://github.com/xlang-ai/OSWorld).
- ⚠️ Windows Sandbox is ephemeral (state discarded on close), which makes it good for a one-shot task but bad for multi-step tasks needing installs; Windows 365 / cheap Windows VPS (Hetzner/Vultr/Contabo-class) are the paid fallback but were **not re-verified** in this session.

**Decision:** Phase 1 = Hyper-V local golden image (free, Pro/Enterprise hosts). Phase 2 = Windows 365 / Cloud PC adapter for Home machines and beta users without Hyper-V. Cloud bursting = Azure spot VM, optional.

### 3. Capture + input inside the VM

- WAA's architecture is the most directly applicable prior art: **guest-side Python server receives commands**, screenshot delivered through a browser/VNC endpoint, optional **Set-of-Marks (Omniparser)** and **UIA/win32 accessibility trees** as grounding aids; its best configuration mixes Omniparser with UIA ✅ (https://github.com/microsoft/WindowsAgentArena).
- OSWorld's environment exposes screenshots, actions, and video recordings as first-class artifacts and treats the VM as a resettable environment ✅ (https://github.com/xlang-ai/OSWorld).
- ❗ The product implication of Phantom's failed `PrintWindow` spike is straightforward: **capture must run inside the guest's real console session**, not from the host against a hidden window. A guest agent using the VM's own display (DXGI Desktop Duplication / GDI BitBlt on the console session) is the lowest-risk path, with `SendInput` or UIA for input — exactly the WAA pattern.
- ⚠️ RDP disconnect blanking, `tscon` session reconnection, virtual display drivers, DPI transforms and clipboard were investigated by the subagent with sources (RustDesk/OSWorld/WAA-class projects) but are **not re-verified** here. Treat them as a spike checklist, not settled design.

**Decision:** implement a guest agent (HTTP/WS over an internal virtual switch) as part of `phantom-vm`; host never calls `PrintWindow`. Add a live VNC/RDP-style viewer in the GUI so users can *see* what the agent sees.

### 4. BYO-key model configuration

- Provider discovery is uneven: OpenAI's `/v1/models` has **no capability metadata** ⚠️ (https://platform.openai.com/docs/api-reference/models/list); Anthropic's returns capabilities and lifecycle ⚠️ (https://platform.claude.com/docs/en/api/models/list); Gemini's returns generation methods and token limits ⚠️ (https://ai.google.dev/api/models); OpenRouter's returns pricing/context and warns that sentinel `-1` prices sort first ⚠️ (https://openrouter.ai/docs/api-reference/list-available-models).
- OpenRouter's `GET /api/v1/key` returns usage, limits and `free_model_daily_requests`, making it a clean pre-flight validation endpoint ✅ (https://openrouter.ai/docs/api-reference/limits).
- Windows Credential Locker allows only **20 credentials per app** ✅ (https://learn.microsoft.com/en-us/windows/apps/develop/security/credential-locker) → store one encrypted blob under one credential, not one entry per key.
- ⚠️ Validate-on-save (Jan, Chatbox) vs validate-on-first-use (Cursor, Msty) both ship; Cursor's docs explicitly say custom keys apply only to chat models, and users complain about the missing verify affordance — so **Phantom should validate on save with six distinct outcomes** ⚠️ (https://docs.jan.ai/desktop/remote-models/custom-endpoint, https://cursor.com/help/models-and-usage/api-keys).
- Codex's permission model separates **sandbox** (files/network) from **approvals** (when to pause) ✅ (https://developers.openai.com/codex/permission-modes) — a clean model for Phantom's Safe/Hero + confidence gate.

**Decision:** one provider record shape, capability precedence = live metadata → shipped table → unknown (never assume), validate on save, keys in one Credential Manager blob, model pill in composer.

### 5. Packaging / signing / updates

- MSIX gives a package identity required for notifications, background tasks and Store/enterprise distribution; **all MSIX packages must be signed before install**; WinApp CLI can generate certs, build and sign from the command line ✅ (https://learn.microsoft.com/en-us/windows/msix/overview).
- Azure Artifact Signing offers fully managed certificates in FIPS 140-3 HSMs, Basic (5,000 signatures/month) and Premium (100,000) SKUs ✅ (https://learn.microsoft.com/en-us/azure/artifact-signing/overview, https://azure.microsoft.com/en-us/pricing/details/artifact-signing/). **The dollar figures did not render in the fetched pricing page**, so do not quote a price without checking the calculator.
- Azure free trial includes **$200 credit for 30 days** ✅ (https://azure.microsoft.com/en-us/pricing/details/artifact-signing/).
- ❗ WiX MSI source already exists in the repo but has never been built or signed; MSI has no package identity, so in-app toasts and clean background lifecycle are harder than MSIX.
- ⚠️ Tauri's NSIS/MSI bundler + updater with signature verification and rollback, python-build-standalone vs PyInstaller/Nuitka trade-offs, and Defender false-positive reports came from the subagent and were **not re-verified** here.

**Decision:** ship a **signed NSIS/MSI via Tauri** for the closed beta (fastest, no Store dependency); target **MSIX + Artifact Signing** for the wider beta. Keep the Python sidecar bundled for beta; migrate providers to Rust later to shrink the package.

### 6. Beta user flow

- Codex's shipped permission UX is a mode selector **below the composer** with Ask for approval / Approve for me / Full access / Custom, and explicit separation of sandbox vs approvals ✅ (https://developers.openai.com/codex/permission-modes).
- Codex is task-first: "Start with a goal, idea, or task" ✅ (https://developers.openai.com/codex/).
- ⚠️ Onboarding/consent, live activity views, approval modals, history, notification and cost-transparency patterns from Codex app, Claude computer use, Cursor, Devin, Manus, Copilot were reported by the subagent with sources but **not re-verified** here.
- Repo-specific gap: the current daemon exposes only an authenticated webhook and a file watcher; there is **no control API** for a GUI, and the TUI embeds `Agent` directly. A GUI-compatible control plane (submit/list/cancel/approve/events/artifacts/settings/VM status) is required regardless of GUI framework.

**Decision:** tray + main window (composer + task list + live VM view), approval modal, history/artifacts view, settings/providers view, first-run wizard; all actions stream through a local authenticated event channel.

### 7. Free / cheap model inference

- Gemini free tier: Flash-class models including **3.8 Flash, 3.6 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite** are "free of charge" ✅; free-tier content **is used to improve products**; paid tier is not ✅ (https://ai.google.dev/gemini-api/docs/pricing). Paid 3.8 Flash is $0.75 in / $3.75 out per 1M tokens through 2026-12-31 ✅.
- ❗ Free-tier **RPD is not published** in the docs; third-party claims range from 20 to ~1,500 RPD ⚠️ (https://ai.google.dev/gemini-api/docs/rate-limits, https://www.aifreeapi.com/en/posts/gemini-api-rate-limits-per-tier). Read the actual quota in AI Studio before promising anything.
- OpenRouter `:free`: **20 requests/minute and 50/day** with <10 lifetime credits, **1,000/day** with ≥10 ✅ (https://openrouter.ai/docs/api-reference/limits). ~8 vision-capable free models were listed by the subagent ⚠️ (https://openrouter.ai/api/v1/models).
- Groq free plan: `qwen/qwen3.8-27b` at **30 RPM / 1,000 RPD / 8K TPM / 200K TPD** ✅ (https://console.groq.com/docs/rate-limits); vision requests allow few images and ~2,048 tokens each ⚠️ (https://console.groq.com/docs/vision).
- **GitHub Models is fully retired as of 2026-07-30** ✅ (https://docs.github.com/en/github-models) — do not use it.
- ⚠️ NVIDIA NIM: 1,000 credits/month, no card, OpenAI-compatible endpoint, but prototyping/evaluation terms only (https://build.nvidia.com/, https://docs.api.nvidia.com/nim/reference/llm-apis).
- ⚠️ Local: Qwen3-VL (Apache-2.0, 2B–32B Ollama builds), UI-TARS-1.5-7B and Holo2 were benchmarked by the subagent with a large frontier-vs-local grounding gap (https://github.com/QwenLM/Qwen3-VL, https://ollama.com/library/qwen3-vl, https://hcompany.ai/holo2, https://gui-agent.github.io/grounding-leaderboard/).

**Decision:** default free = Gemini Flash-Lite (with an explicit in-app consent: "free tier may use your data for model improvement"); paid = Gemini 3.8 Flash; local = Qwen3-VL-8B via Ollama; fallback = OpenRouter `:free` / NVIDIA NIM for demos only.

### 8. Legal / licensing / compliance

- Credential Locker best practice: save only after successful sign-in and explicit opt-in; never plaintext in app data ✅ (https://learn.microsoft.com/en-us/windows/apps/develop/security/credential-locker).
- ❗ Free-tier data training is a **product UX issue, not just a legal one**: the app must disclose it before the user pastes screenshots ✅ (https://ai.google.dev/gemini-api/docs/pricing).
- ⚠️ Rust/Python OSS license inventory, PSF Python redistribution, WebView2 redistribution, GDPR/CCPA basics for screenshots, beta EULA, provider ToS for BYO keys, and a security disclosure policy were reported by the subagent with sources but **not re-verified** here.

**Decision:** minimum beta compliance = privacy policy + in-app data disclosure + telemetry opt-in + security.txt/SECURITY.md + third-party notices + beta EULA. Get counsel review before public beta.

---

## Adversarial verification — issues found

The separate verifier subagent could not run (account quota), so this pass was done by re-fetching primary sources. Six issues were found and are carried explicitly into the plan:

1. **Naming correction:** "Azure Trusted Signing" → **Azure Artifact Signing** (✅).
2. **Unverifiable price:** Artifact Signing pricing page renders `$-`; no price can be quoted from it (✅).
3. **Gemini free RPD conflict:** 20 vs ~1,500 RPD from third parties; official docs do not publish it (⚠️). Plan says "read your AI Studio quota," not a hard number.
4. **Codex app name:** "Codex desktop app" is now the ChatGPT desktop app with Codex inside; design guidance is drawn from the current docs (✅).
5. **Local benchmark numbers** (Holo2/UI-TARS/ScreenSpot-Pro) come from vendor/leaderboard pages, not independent reproduction (⚠️). Treat as directional.
6. **VM cost figures** beyond WAA's Azure table (Windows 365 and VPS prices) were not re-verified (⚠️). Keep cloud as optional.

No findings were silently dropped; each is reflected in the plan's decision points and open questions.

---

## Conclusions & implications

- The product can be built on free infrastructure, but "free" shifts cost to **engineering time**: a golden-image + guest-agent pipeline is real work, and it is the same work that the failed hidden-desktop spike showed cannot be skipped.
- The GUI is the binding constraint on user adoption, not the agent loop. Without a control plane and a proper window, none of the existing safety/reliability code is reachable by a beta user.
- Privacy is a first-class design requirement because screenshots are the product's input: free tiers that train on content change the user contract.
- Do not ship until the live desktop golden suite passes **inside the VM**; passing deterministic file/CLI tasks is not evidence the differentiator works.

## Recommendations (immediate)

1. Lock four decisions in an ADR: Tauri 2 GUI, local Hyper-V golden image + guest agent, Artifact Signing/MSIX path, Gemini Flash-Lite default with consent.
2. Build the daemon control plane before the GUI — it is the integration seam everything else needs.
3. Spike the guest agent against the existing 20 golden tasks; only then build the full VM pool.
4. Ship the first beta to 5 users with a signed installer, onboarding wizard and live VM viewer; gate expansion on the §1 release gates.

---

## Full source list

Verified in this session:
- https://tauri.app/
- https://learn.microsoft.com/en-us/azure/artifact-signing/overview
- https://azure.microsoft.com/en-us/pricing/details/artifact-signing/
- https://learn.microsoft.com/en-us/windows/msix/overview
- https://learn.microsoft.com/en-us/windows/apps/develop/security/credential-locker
- https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/install-hyper-v
- https://github.com/microsoft/WindowsAgentArena
- https://github.com/xlang-ai/OSWorld
- https://developers.openai.com/codex/
- https://developers.openai.com/codex/permission-modes
- https://ai.google.dev/gemini-api/docs/pricing
- https://openrouter.ai/docs/api-reference/limits
- https://console.groq.com/docs/rate-limits
- https://docs.github.com/en/github-models

Reported by research subagents (source URLs supplied, not re-verified here):
- https://platform.openai.com/docs/api-reference/models/list
- https://platform.claude.com/docs/en/api/models/list
- https://ai.google.dev/api/models
- https://openrouter.ai/docs/api-reference/list-available-models
- https://openrouter.ai/api/v1/models
- https://openrouter.ai/docs/features/privacy-and-logging
- https://docs.jan.ai/desktop/remote-models/custom-endpoint
- https://cursor.com/help/models-and-usage/api-keys
- https://forum.cursor.com/t/no-verify-button-when-setting-custom-openai-api-key-in-settings-models/140843
- https://docs.msty.ai/studio/managing-models/online-providers
- https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/
- https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/custom_endpoint
- https://developers.openai.com/codex/auth
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/costs
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://console.groq.com/docs/vision
- https://console.groq.com/docs/your-data
- https://inference-docs.cerebras.ai/support/pricing
- https://build.nvidia.com/
- https://docs.api.nvidia.com/nim/reference/llm-apis
- https://github.com/QwenLM/Qwen3-VL
- https://ollama.com/library/qwen3-vl
- https://huggingface.co/ByteDance-Seed/UI-TARS-1.5-7B
- https://github.com/bytedance/UI-TARS-desktop
- https://github.com/OS-Copilot/OS-Atlas
- https://hcompany.ai/holo2
- https://gui-agent.github.io/grounding-leaderboard/

## Appendices — open questions

- Actual per-project Gemini free-tier RPM/RPD in Nov 2026.
- Does opting out of OpenRouter training leave vision models available?
- Does NVIDIA's free developer program permit a distributed agent?
- How much does a 3-step agentic loop close the local-model grounding gap?
- Exact Artifact Signing price and individual eligibility.
- Windows 365 / Windows VPS pricing for 20 beta users.
- Legal review of screenshot handling and free-tier training consent.
