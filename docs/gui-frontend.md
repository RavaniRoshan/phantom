# Desktop GUI frontend

The Phantom desktop GUI is a thin client of the daemon control plane. It lives
in `crates/phantom-app/` (Tauri v2) and its webview frontend is built from
`frontend-src/`.

## Stack

- **React 19** + **TypeScript** + **Vite 7**
- **Tailwind CSS 4** + **tw-animate-css**
- **Space UI** components (free primitives) installed through the shadcn CLI:
  `Button`, `Card`, `Badge`, `Input`, `Textarea`, `Separator`, `Dialog`
  (plus their transitive `Spinner` and `ScrollArea`).
- Base UI powers the primitives; `@usespaceui/squircle` provides the corner
  geometry; `class-variance-authority` drives variants.

The Space UI registry is configured in `frontend-src/components.json` as
`@spaceui` → `https://www.spaceui.one/r/{name}.json`.

> Only free registry items are used. Space UI's `isPro` components (blocks,
> shaders, most interactions, all templates) are **not** included — using them
> requires a separate license.

## Build

```powershell
cd frontend-src
npm install
npm run build
```

Vite emits into `../crates/phantom-app/frontend`, which is exactly what
`tauri.conf.json` declares as `frontendDist`. The built assets are checked in so
`cargo build`/`cargo test` work without Node. `cargo tauri dev` and
`cargo tauri build` run `npm run build` automatically via `beforeDevCommand` and
`beforeBuildCommand`.

Run `npx tsc --noEmit` in `frontend-src/` for a type check — `vite build`
transpiles with esbuild and does not type-check by itself.

## Adding another Space UI component

```powershell
cd frontend-src
npx shadcn@latest add https://www.spaceui.one/r/primitives-<name>.json --yes
npm run build
```

`src/index.css` holds the full Space UI token set from `lib-style.json`; the
shadcn CLI may append small per-component token patches, which is expected.

## Configuration is app-only

The Settings screen owns every user-facing control. The CLI and CI read the
same `~/.phantom/config.toml` but never present these controls to end users.

- **Provider** — chosen from a catalog in `src/models.ts` (Claude, OpenAI,
  Gemini, NVIDIA NIM, OpenRouter, Ollama, local, offline mock).
- **Model** — picked from the selected provider's catalog, or entered as a
  custom model ID. Catalog entries are labelled (e.g. "vision", "fast").
- **Endpoint URL** — shown for providers that need one (Ollama, local,
  OpenRouter).
- **Mode / max iterations / confidence gate / parallel workers** — saved to
  the same config the daemon uses.
- **API key** — saved to / cleared from Windows Credential Manager. The value
  is never written to `config.toml` or logs; `phantom_llm` resolves it per
  request, so a key saved after startup takes effect immediately.

`save_app_settings` persists to `config.toml` and mirrors the control-plane
copy; `get_app_settings` reads it back. `delete_api_key` clears the credential.

## Tauri IPC contract

`src/tauri.ts` exposes `invoke<T>(cmd, args)`. It prefers Tauri v2's
`__TAURI_INTERNALS__.invoke` and falls back to the v1 `__TAURI__.invoke` global.
Outside the desktop shell it rejects with a clear error instead of faking data.

The GUI calls exactly the commands the Rust shell registers:

| Command | Purpose |
|---|---|
| `list_tasks` | refresh the task list |
| `submit_task` | start a task from the composer |
| `cancel_task` | stop a task |
| `resolve_approval` | approve/deny a consequential action |
| `get_settings` / `set_settings` | control-plane mirror of provider/model/mode |
| `get_app_settings` / `save_app_settings` | load/save the full app config |
| `has_api_key` / `set_api_key` / `delete_api_key` | first-run key management |
| `vm_status` | VM backend/state badge |

## Verification

`python/tests/test_gui_shell.py` checks that the React source keeps the required
screens (`composer`, `activity`, `task-list`, `approval`, `settings`, `vm-pill`),
imports the Space UI components, calls the IPC commands, and that Vite still
emits into the Tauri `frontendDist`. `scripts/verify-all.ps1` runs it with the
full suite.
