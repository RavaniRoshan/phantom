# Phantom — Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "LLM service is not reachable" | Python service not running | `python -m phantom_llm.server` and retry. |
| "API key missing or invalid" | No key in credential store | `/settings` → API key; or set `PHANTOM_API_KEY`. |
| "Blocked by Safe-mode policy" | Action outside capability scope | Use `/hero` only if you trust the task. |
| "Provider quota reached" | 429 / RESOURCE_EXHAUSTED | Wait, retry, or switch provider. |
| "The model returned an invalid action" | `INVALID_ARGUMENT` from server | Retry; if persistent, change provider. |
| Task appears stuck | Awaiting approval | Check the approval view. |
| Webhook returns 401/409 | Missing token / replayed nonce | Add bearer token and a fresh nonce. |
| No task progress in TUI | Fixed in W0.14 | Each task now has its own agent and tagged events. |
| Capture is black | Hidden-desktop approach retired (W0.0) | Use the isolated-VM backend (ADR-008). |

For anything else, run `scripts/support-bundle.ps1`, **review it for secrets**,
and attach it to the issue.
