# Phantom

> The agent that works while you don't watch.

Phantom is a background-mode computer-use agent for Windows. You give it a task
in plain language; it plans the task, then runs an observe → decide → execute
loop using a neutral action vocabulary that any LLM provider can drive. Phantom
operates in the background — headless browser, file system, shell — so you can
keep using your machine while it works.

## Highlights

- **Neutral action schema (the "singularity").** Every provider — Claude,
  OpenAI, Gemini, Ollama — maps its *native* tool mechanism onto one shared
  schema (`python/phantom_llm/schema.py` is the single source of truth). There is
  no vendor lock-in; model behavior is comparable across providers.
- **One OmniAgent brain.** Rust `phantom-core` owns the plan → route → execute
  loop, the security policy, and the gRPC client to the Python LLM service.
- **Safe / Hero modes.** Safe mode restricts writes to allowed folders; Hero
  mode grants full system access with no prompts.
- **Interactive TUI.** A `ratatui` terminal UI shows the plan, each action, the
  model's streamed reasoning, and a live, editable settings form.
- **Headless browser backend.** `phantom-browser` drives Chromium over the
  Chrome DevTools Protocol (CDP) with no visible window.

## Architecture

```
User task (TUI)
   │
   ▼
phantom-core  ── OmniAgent ──► PlanTask RPC  ──► LLM decomposes into SubTasks
   │  (router + security)         │
   │                              ▼
   │                    Python LLM service (neutral schema)
   │                      ├─ Claude   : tool_use + our schema
   │                      ├─ OpenAI   : function calling + our schema
   │                      ├─ Gemini   : functionDeclarations + our schema
   │                      └─ Ollama   : tools / JSON mode + our schema
   │
   ├─ route SubTask.backend ──► phantom-browser  (chromiumoxide CDP, headless)
   │                         ──► phantom-fs       (file ops + PowerShell, cfg(windows))
   │                         ──► phantom-desktop  (V2: CreateDesktop, cfg(windows))
   │
   └─ per-step: DecideAction RPC (screenshot+context+history) → next Action
      loop: plan → route → execute → observe(screenshot) → DecideAction → repeat
      StreamThinking RPC → real-time reasoning chunks to the TUI
```

## Repository layout

```
phantom/
├── Cargo.toml                # workspace (Windows target)
├── proto/phantom.proto       # shared gRPC contract
├── crates/
│   ├── phantom-cli/          # ratatui TUI (settings, chat, status, slash cmds)
│   ├── phantom-core/         # OmniAgent, router, config, security, gRPC client
│   ├── phantom-browser/      # chromiumoxide CDP backend (headless)
│   ├── phantom-fs/           # file ops (cross-plat) + PowerShell (cfg(windows))
│   ├── phantom-desktop/      # V2: invisible desktop via CreateDesktop
│   └── phantom-proto/        # generated gRPC code (tonic-build)
└── python/phantom_llm/       # neutral LLM service (grpcio server + providers)
    ├── schema.py             # THE neutral action schema (single source of truth)
    ├── providers/            # claude, openai, gemini, ollama
    ├── server.py             # grpc.aio servicer
    └── tests/                # provider neutrality tests
```

## Requirements

- Rust (stable) with the `x86_64-pc-windows-msvc` target installed.
- Python 3.11+ for the LLM service.
- A Chromium/Chrome binary on the host (used headlessly by `phantom-browser`).
- A provider API key (Claude/OpenAI/Gemini) or a running Ollama instance.

> **Platform.** Phantom targets Windows only (`x86_64-pc-windows-msvc`). The
> Windows-only backends (`phantom-fs` PowerShell exec, `phantom-desktop`) are
> gated behind `cfg(windows)`; shared crates still type-check on other
> platforms, but the full build and runtime live on Windows.

## Build

```powershell
# from the repo root, on Windows
rustup target add x86_64-pc-windows-msvc
cargo build --release
```

## Run

1. **Start the Python LLM service** (in one terminal):

   ```powershell
   cd python
   python -m venv .venv && .venv\Scripts\Activate.ps1
   pip install -e .
   $env:PHANTOM_API_KEY = "sk-..."        # or set in config
   python -m phantom_llm.server
   ```

   The service listens on `http://127.0.0.1:50051` by default.

2. **Launch the TUI** (in another terminal):

   ```powershell
   cargo run -p phantom-cli --release
   ```

3. **Use it.** Type a task, e.g. `summarize the top story at example.com`,
   or `/help` for commands. `/settings` opens an editable form (↑/↓ to
   select, Enter to edit, `s` to save, Esc to return).

## Configuration

Phantom reads `~/.phantom/config.toml` (created with defaults on first run).
Fields:

| key | meaning |
|-----|---------|
| `provider` | `claude` \| `openai` \| `gemini` \| `ollama` \| `mock` |
| `llm_endpoint` | base URL override (Ollama / self-hosted) |
| `api_key` | provider key (prefer env `PHANTOM_API_KEY`) |
| `mode` | `safe` (default) \| `hero` |
| `allowed_folders` | write roots permitted in Safe mode |
| `grpc_endpoint` | address of the Python service |
| `max_iterations` | upper bound on DecideAction iterations per task |

## Modes

- **Safe** (default): reads everywhere; writes restricted to `allowed_folders`.
- **Hero**: full system access, no permission prompts.

Toggle live with `/safe`, `/hero`, or from the settings form.

## Schemas & neutrality

`python/phantom_llm/schema.py` defines the canonical action schema. Each provider
adapter converts it into its native tool format and funnels results back through
`normalize_action_dict` / `normalize_plan_dict`, so every provider emits the same
`ActionResponse` / `SubTask` shapes. The Rust side never knows which model is
running.

### Offline mode (no API key)

The `mock` provider is fully offline and deterministic — it needs no SDK and no
API key. It is ideal for running the entire stack end-to-end in CI, for demos,
and for testing the Rust↔Python gRPC contract without a paid model. Point the
server and the TUI at it:

```powershell
$env:PHANTOM_PROVIDER = "mock"
python -m phantom_llm.server      # offline, scripted decisions
cargo run -p phantom-cli --release
```

## Testing

```powershell
# Rust: cross-platform crates (sandbox, security, proto, providers' wire shapes)
cargo test -p phantom-fs -p phantom-proto -p phantom-core

# Python: provider neutrality + full gRPC end-to-end run (offline, mock provider)
cd python
pytest tests/
```

## License

Apache License 2.0. See [LICENSE](LICENSE).
