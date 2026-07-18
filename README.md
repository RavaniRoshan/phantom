# Phantom

> The background-mode computer-use agent that works while you don't watch.

[![CI](https://github.com/RavaniRoshan/phantom/actions/workflows/ci.yml/badge.svg)](https://github.com/RavaniRoshan/phantom/actions/workflows/ci.yml)
[![Windows Runtime](https://github.com/RavaniRoshan/phantom/actions/workflows/windows-runtime.yml/badge.svg)](https://github.com/RavaniRoshan/phantom/actions/workflows/windows-runtime.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-stable-orange.svg)](https://www.rust-lang.org/)
[![Python](https://img.shields.io/badge/python-3.11%2B-blue.svg)](https://www.python.org/)
![Platform](https://img.shields.io/badge/platform-Windows--first-lightgrey.svg)

Phantom is a **background-mode computer-use agent**. You give it a task in plain
language; it plans the task, then runs an **observe → decide → execute** loop
using a provider-neutral action vocabulary that any LLM can drive. Phantom works
in the background — headless browser, file system, shell, and an invisible
Windows desktop — so you keep using your machine while it runs.

## Table of Contents

- [What is Phantom?](#what-is-phantom)
- [Highlights](#highlights)
- [Architecture](#architecture)
- [Repository Layout](#repository-layout)
- [Requirements](#requirements)
- [Installation & Build](#installation--build)
- [Usage](#usage)
  - [Interactive TUI](#interactive-tui)
  - [Headless daemon (proactive mode)](#headless-daemon-proactive-mode)
  - [Master Planner swarm](#master-planner-swarm)
  - [Offline / mock provider](#offline--mock-provider)
- [Configuration](#configuration)
- [Modes: Safe & Hero](#modes-safe--hero)
- [Confidence-Gated Autonomy & Approval Queue](#confidence-gated-autonomy--approval-queue)
- [Provider Neutrality](#provider-neutrality)
- [NVIDIA NIM (free vision)](#nvidia-nim-free-vision)
- [Testing & CI](#testing--ci)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## What is Phantom?

Phantom turns a one-line instruction into a completed task. A Rust core
(`phantom-core`) owns the plan → route → execute loop and the security policy;
a Python service (`phantom_llm`) adapts any LLM provider onto a single shared
action schema over gRPC. Because every provider speaks the same neutral
contract, **model behavior stays comparable and there is no vendor lock-in**.

Two ways to run it:

- **Interactive** — a terminal UI (TUI) where you type tasks, watch the plan and
  the model's streamed reasoning, and approve uncertain steps.
- **Headless / proactive** — the `phantom-daemon` reacts to cloud webhooks and
  dropped files on its own, running tasks in the background without a human at
  the keyboard.

## Highlights

- **One neutral action schema ("the singularity").** Every provider — Claude,
  OpenAI, Gemini, Ollama — maps its *native* tool mechanism onto one shared
  schema (`python/phantom_llm/schema.py` is the single source of truth). Swap
  models without touching the agent loop.
- **One OmniAgent brain.** Rust `phantom-core` owns plan → route → execute,
  the security policy, and the gRPC client to the Python LLM service.
- **Confidence-gated autonomy + Approval Queue.** In Safe mode an action the
  model is unsure about is *paused* for human approval (TUI) instead of blindly
  executing — or skipped headlessly. Tunable with one `confidence_gate` value.
- **Master Planner swarm.** A task is decomposed into a sub-task graph and fanned
  out across concurrent workers, each on its own isolated hidden desktop, then
  merged into a final summary.
- **Proactive daemon.** `phantom-daemon` listens for cloud webhooks (`POST
  /event`) and watches an Inbox folder, turning triggers into agent tasks on
  their own.
- **Invisible Windows desktop.** `phantom-desktop` launches a hidden Win32
  desktop via `CreateDesktopW`, captures it with `PrintWindow`, and injects input
  **UI-Automation-first** (no focus theft, works off-screen).
- **Headless browser backend.** `phantom-browser` drives Chromium over the
  Chrome DevTools Protocol with no visible window.
- **Safe / Hero modes.** Safe mode restricts writes to allowed folders; Hero mode
  grants full system access with no prompts.
- **Interactive TUI.** A `ratatui` terminal UI shows the plan, each action, the
  streamed reasoning, and a live, editable settings form (provider, mode, model,
  API key, endpoints, allowed folders).
- **NVIDIA NIM provider (zero-cost vision).** An OpenAI-compatible adapter that
  drives free-tier vision models through Phantom's neutral schema — prove the
  whole loop on real screenshots at no cost, with no lock-in.

## Architecture

```
User task (TUI)  ──or──  Webhook / Inbox file (phantom-daemon, headless)
   │                                  │
   ▼                                  ▼
phantom-core  ── OmniAgent ──► PlanTask RPC  ──► LLM decomposes into SubTasks
   │  (router + security            │
   │   + approval queue)            ▼
   │                    Python LLM service (neutral schema)
   │                      ├─ Claude   : tool_use + our schema
   │                      ├─ OpenAI   : function calling + our schema
   │                      ├─ Gemini   : functionDeclarations + our schema
   │                      ├─ Ollama   : tools / JSON mode + our schema
   │                      └─ NVIDIA NIM: OpenAI-compatible JSON + our schema (free vision)
   │
   ├─ route SubTask.backend ──► phantom-browser  (chromiumoxide CDP, headless)
   │                         ──► phantom-fs       (file ops + PowerShell, cfg(windows))
   │                         ──► phantom-desktop  (invisible desktop, cfg(windows))
   │
   └─ per-step: DecideAction RPC (screenshot+context+history) → next Action
      loop: plan → route → execute → observe(screenshot) → DecideAction → repeat
      StreamThinking RPC → real-time reasoning chunks to the TUI
```

The **Master Planner swarm** wraps this loop: one `PlanTask` call yields a
sub-task graph, and each sub-task runs on its own worker `Agent` (isolated hidden
desktop) bounded by `max_parallel_workers` and available RAM, then results are
synthesized.

## Repository Layout

```
phantom/
├── Cargo.toml                # workspace (Windows-first; cross-platform crates type-check elsewhere)
├── proto/phantom.proto       # shared gRPC contract (DecideAction / PlanTask / StreamThinking)
├── crates/
│   ├── phantom-cli/          # ratatui TUI ("phantom" binary: settings, chat, status, slash cmds)
│   ├── phantom-core/         # OmniAgent, router, config, security, ApprovalQueue, orchestrator (swarm)
│   │   └── examples/         # swarm_task.rs — drives the Master Planner
│   ├── phantom-browser/      # chromiumoxide CDP backend (headless)
│   ├── phantom-fs/           # file ops (cross-plat) + PowerShell (cfg(windows))
│   ├── phantom-desktop/      # invisible desktop via CreateDesktop (cfg(windows))
│   ├── phantom-daemon/       # V3 proactive context engine (webhook + Inbox watcher)
│   └── phantom-proto/        # generated gRPC code (tonic-build)
└── python/phantom_llm/       # neutral LLM service (grpcio server + providers)
    ├── schema.py             # THE neutral action schema (single source of truth)
    ├── providers/            # claude, openai, gemini, ollama, nvidia, mock
    ├── server.py             # grpc.aio servicer
    └── tests/                # provider neutrality + end-to-end tests
```

## Requirements

- **Rust** (stable) with the `x86_64-pc-windows-msvc` target for a full Windows build.
- **Python 3.11+** for the LLM service.
- A **Chromium/Chrome** binary on the host (used headlessly by `phantom-browser`).
  Snap-packaged Chromium is auto-detected via a generated `snap run` wrapper;
  otherwise set `PHANTOM_CHROME` to the binary path.
- A provider **API key** (Claude/OpenAI/Gemini) or a running **Ollama** instance.
  The `mock` provider needs neither (see [Offline / mock provider](#offline--mock-provider)).

> **Platform.** Phantom is **Windows-first**. The Windows-only backends
> (`phantom-fs` PowerShell exec, `phantom-desktop`) are gated behind
> `cfg(windows)`; the shared crates still type-check and are tested on other
> platforms (Linux CI runs the portable crates plus a full cross-stack e2e over
> the `file` backend). The full build and runtime live on Windows.

## Installation & Build

```powershell
# from the repo root, on Windows
rustup target add x86_64-pc-windows-msvc
cargo build --release
```

The Python service is built separately:

```powershell
cd python
python -m venv .venv && .venv\Scripts\Activate.ps1
pip install -e .
```

## Usage

### Interactive TUI

1. **Start the Python LLM service** (one terminal):

   ```powershell
   cd python
   $env:PHANTOM_API_KEY = "sk-..."        # or set in config
   python -m phantom_llm.server
   ```

   It listens on `http://127.0.0.1:50051` by default.

2. **Launch the TUI** (another terminal):

   ```powershell
   cargo run -p phantom-cli --release
   ```

3. **Use it.** Type a task, e.g. `summarize the top story at example.com`.
   Slash commands:

   | command | effect |
   |---------|--------|
   | `/help` | list commands |
   | `/settings` | open the editable settings form (↑/↓ select, Enter edit, `s` save, Esc back) |
   | `/safe` | switch to Safe mode |
   | `/hero` | switch to Hero mode |
   | `/provider <name>` | switch provider (claude/openai/gemini/ollama/nvidia/mock) |
   | `/mode <name>` | switch mode (safe/hero) |
   | `/clear` | clear the transcript |
   | `/quit`, `/exit` | quit |

### Headless daemon (proactive mode)

`phantom-daemon` boots three concurrent tasks — a **webhook** receiver, a
**filesystem watcher** for an Inbox folder, and the **engine** that turns
triggers into agent tasks — wired through an in-process event bus.

```powershell
# start the Python service first, then:
phantom-daemon --port 4545
```

- **Webhook:** `POST http://127.0.0.1:4545/event` (loopback only). `GET
  /health` is a liveness probe.

  ```json
  {
    "event_type": "email_received",
    "source": "gmail",
    "priority": "high",
    "context": "Email from CEO: 'We need the competitor analysis by 5 PM.'",
    "attachments": []
  }
  ```

  Only `event_type` is required; the rest are optional.

- **Inbox watcher:** drop a file into `~/Phantom/Inbox` and it becomes a task
  ("Process the newly dropped file: …"). Override with `--inbox <dir>`.

- Other flags: `--mode safe|hero`, `--grpc-endpoint <url>`, `--config <path>`,
  `--dry-run` (log the generated prompt without invoking the LLM).

The daemon logs each `plan:`, `action:`, `result:`, and saved screenshot
(`PHANTOM_SHOT_DIR`).

### Master Planner swarm

The swarm is a library capability in `phantom-core`
(`MasterPlanner::run`). Decompose a task, fan its sub-tasks across isolated
workers, and synthesize the results:

```powershell
cargo run -p phantom-core --example swarm_task --release
```

Concurrency is bounded by `max_parallel_workers` (default `4`) and available RAM
(~2 GiB/worker), so the swarm never oversubscribes the machine.

### Offline / mock provider

The `mock` provider is fully offline and deterministic — no SDK, no API key.
Ideal for CI, demos, and testing the Rust↔Python gRPC contract. Point the server
and the TUI at it:

```powershell
$env:PHANTOM_PROVIDER = "mock"
python -m phantom_llm.server      # offline, scripted decisions
cargo run -p phantom-cli --release
```

## Configuration

Phantom reads `~/.phantom/config.toml` (created with defaults on first run).
Fields:

| key | meaning |
|-----|---------|
| `provider` | `claude` \| `openai` \| `gemini` \| `ollama` \| `nvidia` \| `mock` |
| `model` | optional model override (blank = provider default) |
| `llm_endpoint` | base URL override (Ollama / self-hosted / NIM) |
| `api_key` | provider key (prefer env `PHANTOM_API_KEY`) |
| `mode` | `safe` (default) \| `hero` |
| `allowed_folders` | write roots permitted in Safe mode |
| `grpc_endpoint` | address of the Python service |
| `max_iterations` | upper bound on DecideAction iterations per task |
| `max_parallel_workers` | max concurrent swarm workers (further capped by RAM) |
| `confidence_gate` | Phase D autonomy threshold, `0.0`–`1.0` (see below) |

Environment overrides: `PHANTOM_API_KEY`, `PHANTOM_PROVIDER`, `PHANTOM_CHROME`,
`PHANTOM_NVIDIA_MODEL`, `PHANTOM_NVIDIA_ENDPOINT`, `PHANTOM_SHOT_DIR`.

## Modes: Safe & Hero

- **Safe** (default): reads everywhere; writes restricted to `allowed_folders`.
- **Hero**: full system access, no permission prompts.

Toggle live with `/safe`, `/hero`, or from the settings form.

## Confidence-Gated Autonomy & Approval Queue

Every `ActionResponse` carries a `confidence` score. In **Safe mode**, an action
the model is *less* confident about than `confidence_gate` is **paused** rather
than executed:

- **With a TUI attached** — the action is enqueued in the `ApprovalQueue` and
  surfaced for the operator to **approve** or **reject** (resolve-all supported).
- **Headless (daemon / swarm)** — no human is available, so the uncertain action
  is **skipped** and the task continues.

`Hero` mode ignores the gate (everything auto-runs). Set `confidence_gate = 0.0`
to disable it entirely.

Defaults are tuned so the loop never stalls by accident:

- `confidence_gate` defaults to **`0.70`** — real LLM confidences cluster
  `0.6`–`0.9`, so this pauses only genuinely-unsure steps.
- The Python service applies a **server-side fallback** (`~0.85`) when a provider
  omits confidence, so providers that never emit it still auto-run in Safe mode.

## Provider Neutrality

`python/phantom_llm/schema.py` defines the canonical action schema. Each provider
adapter converts it into its native tool format and funnels results back through
`normalize_action_dict` / `normalize_plan_dict`, so every provider emits the same
`ActionResponse` / `SubTask` shapes. The Rust side never knows which model is
running — that is the guarantee of no vendor lock-in.

## NVIDIA NIM (free vision)

The `nvidia` provider talks to NVIDIA NIM's OpenAI-compatible endpoint
(`https://integrate.api.nvidia.com/v1`) and drives free-tier vision models such
as `meta/llama-3.2-90b-vision-instruct`. It is the cheapest way to exercise the
**entire** observe→decide→execute loop on *real* screenshots — proving the
architecture generalizes to any vision LLM before you wire in a paid model.

Because many NIM vision models lack tool/function calling, the adapter asks the
model for a single JSON object matching Phantom's neutral schema and funnels the
result through `normalize_action_dict`. The output is the **same**
`ActionDecision` every other provider returns — no schema drift, no lock-in.

```powershell
$env:PHANTOM_PROVIDER = "nvidia"
$env:NVIDIA_API_KEY    = "nvapi-..."          # or PHANTOM_API_KEY
# optional overrides:
$env:PHANTOM_NVIDIA_MODEL    = "meta/llama-3.2-90b-vision-instruct"
$env:PHANTOM_NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1"
python -m phantom_llm.server
```

The bundled offline tests (`python/tests/test_nvidia_provider.py`) prove the JSON
extraction and schema normalization without needing a key or network.

## Testing & CI

Two GitHub Actions workflows gate the project:

- **`ci.yml`** (Linux) — `cargo check`, portable Rust crate tests
  (`phantom-fs`, `phantom-proto`, `phantom-core`), Python provider-neutrality
  tests, and a **full cross-stack e2e** that boots the mock gRPC server and drives
  the real Rust `agent ↔ client` loop over the `file` backend.
- **`windows-runtime.yml`** (Windows) — compiles the real Windows-only backends
  and runs the desktop / multi-desktop-pool / NVIDIA runtime jobs on a real
  Windows session.

Run locally:

```powershell
# Rust: cross-platform crates
cargo test -p phantom-fs -p phantom-proto -p phantom-core

# Python: provider neutrality + full gRPC end-to-end (offline, mock provider)
cd python
pytest tests/

# Full-stack Rust ↔ gRPC ↔ Python e2e (Linux; boots the mock server)
PHANTOM_E2E=1 PHANTOM_PYTHON=python cargo test -p phantom-core --test e2e_mock -- --test-threads=1
```

## Roadmap

Phantom is built toward a "Grand Vision" of a proactive, multi-surface agent:

- **Pillar I.1 — Cloud triggers:** `phantom-daemon` webhook (`POST /event`) for
  remote/email/calendar triggers. *(shipped)*
- **Pillar I.2 — Local triggers:** filesystem Inbox watcher. *(shipped)*
- **Pillar I.3 — Animated mascot window:** a friendly always-on presence.
  *(deferred)*
- **V3 hardening:** confidence-gated autonomy + Approval Queue, Master Planner
  swarm, multi-desktop resource pool. *(shipped)*

## Contributing

Issues and pull requests are welcome. To build and test locally, follow
[Installation & Build](#installation--build) and [Testing & CI](#testing--ci).

- Keep provider adapters behind the neutral schema in
  `python/phantom_llm/schema.py`.
- The Windows-only backends must stay gated behind `cfg(windows)`; shared crates
  must remain cross-platform-compilable.
- Run `cargo clippy --workspace` and `pytest tests/` before opening a PR.

## License

Apache License 2.0. See [LICENSE](LICENSE).
