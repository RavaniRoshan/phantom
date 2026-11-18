# Installing Phantom on Windows (no extra setup)

Phantom is designed to be a **single installed Windows app that runs in the
background**. After install there is no Python setup, no separate service, no
Chrome download, and no VM to configure.

## What the installed app contains

| Component | Why |
|---|---|
| `phantom-daemon.exe` | owns tasks and exposes the local control plane; registered as a per-user logon task |
| `Phantom.exe` (Tauri GUI) | task composer, live activity, task list, settings |
| `phantom.exe` (CLI) | optional terminal interface |
| `phantom-guest.exe` | captured desktop agent |
| `python/` | bundled runtime + `phantom_llm` service + generated proto stubs + dependencies |

The daemon starts `python/python.exe -m phantom_llm.server` itself (`--dry-run`
or `PHANTOM_NO_SIDECAR=1` disables that), so the user never launches Python.
Set `PHANTOM_SIDECAR_DIR` to point at a source tree during development.

## First run

1. Open Phantom from the Start Menu / desktop shortcut.
2. The first-run banner opens **Settings**.
3. Paste a provider API key into **Provider API key** and click **Save key**.
   It is stored in **Windows Credential Manager** under `phantom/api_key` —
   never in `config.toml` or logs. The GUI shows "Stored in Credential Manager".
4. Give Phantom a task. Background startup is registered by the installer, so
   tasks keep running after the window is closed.

The LLM service reads the same credential on every request, so a key saved
after startup takes effect immediately.

## Install from this checkout

```powershell
# build the Rust binaries once
cargo build -p phantom-daemon -p phantom-cli -p phantom-guest

# stage the Python sidecar, copy everything to %LOCALAPPDATA%\Phantom,
# register the per-user logon task and start the daemon
powershell -ExecutionPolicy Bypass -File scripts/install-local.ps1
```

`scripts/install-local.ps1` is idempotent. Use `-SkipSidecar` to keep an
existing staged Python folder.

For a distributable installer, CI runs `cargo tauri build` (NSIS) and signs the
result; the release workflow is `.github/workflows/release.yml`. Signing needs
SignPath/Artifact Signing secrets — without them the NSIS installer is still
buildable but Windows SmartScreen will warn on first install.

### Verified on bare Windows

`scripts/install-local.ps1` was run on the development machine (Windows 11
Home). Result: all binaries including `Phantom.exe` (GUI) installed into
`%LOCALAPPDATA%\Phantom`, the staged sidecar ran from the installed `python/`
folder, the `PhantomDaemon` scheduled task was `Ready`, and both the control
plane (`127.0.0.1:4546`) and the LLM service (`127.0.0.1:50051`) were listening
after startup. The daemon process path was the installed copy, not the repo.

## Background execution

Background mode uses the **invisible Windows desktop** (`CreateDesktop` in
`phantom-desktop`) in the user's own session. It does **not** need Hyper-V or
Windows Sandbox, so it works on Windows 11 Home. VM isolation remains an
optional power-user backend, not a requirement for the installed app.

Browser tasks use the Edge/WebView2 runtime already present on Windows; no
separate Chrome download is required.
