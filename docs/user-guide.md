# Phantom — User Guide (v1 private beta)

## What it does

Phantom runs computer-use tasks in the background inside an isolated Windows
VM (ADR-008). Your own desktop is never driven. Give it a plain-language task
and it reports a verifiable outcome.

## Getting started

1. Install the MSI and launch Phantom from the desktop icon.
2. On first run, open **Settings** (`/settings`) and choose a provider. Store
   the API key there — it goes into Windows Credential Manager, never into
   `config.toml`. `PHANTOM_API_KEY` still overrides it when set.
3. Type a task and press Enter. Progress streams in the chat view.
4. Use `/tasks` to see all tasks and their status; approvals appear in the
   approval view when the confidence gate triggers.

## Commands

| Command | Meaning |
|---|---|
| `/help` | Show help |
| `/tasks` | List tasks with status |
| `/settings` | Edit provider, mode, model, budgets, folders |
| `/safe`, `/hero` | Switch operating mode |
| `/provider <name>` | Switch LLM provider |
| `/clear`, `/quit` | Clear transcript / exit |

## Modes

- **Safe** (default): capability-scoped actions; uncertain ones pause for
  approval; no destructive file/shell operations.
- **Hero**: full access inside the VM. Only use for tasks you trust.

## Troubleshooting

See `docs/troubleshooting.md`. For a redacted support bundle run
`scripts/support-bundle.ps1` and review the output before sharing.
