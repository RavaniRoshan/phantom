# Phantom v1 — Threat model (W4.5)

**Status:** Draft for review before private alpha.
**Scope:** Windows-first private beta; isolated-VM desktop fork (ADR-008).

## Assets

- User's local files and credentials (API keys, webhook bearer token).
- The user's interactive desktop session (focus, clipboard, pointer).
- Run history and audit log (integrity matters for trust).
- Provider API quota / billing.

## Actors and trust boundaries

| Actor | Boundary | Trust |
|---|---|---|
| Model output (DecideAction) | LLM service → Rust agent | **Untrusted** — may be malformed or injected. |
| Web page / file / shell output | tools → model context | **Untrusted data** — never instructions (W4.2). |
| Local webhook caller | loopback HTTP → bus | Authenticated bearer + nonce (W0.8). |
| User | TUI / approval queue | Trusted, but fallible — gates protect them. |
| VM guest | isolated VM → host capture channel | Semi-trusted; host controls lifecycle. |

## Threats and mitigations

1. **False success** — model emits empty/garbage → old code reported `done`.
   Mitigated by fail-closed normalization (W0.2) and typed `RunOutcome` (W0.13).
2. **Shell injection** — desktop `open` via `cmd.exe /c start`; CLI chaining.
   Mitigated by `ShellExecuteW`/`CreateProcessW` + allowlists (W0.7) and the
   capability engine (W4.1).
3. **Prompt injection** — untrusted tool output issues instructions.
   Mitigated by delimiters, phrase stripping and data framing (W4.2).
4. **Credential exfiltration** — `Get-ChildItem Env:` in a model-triggered shell.
   Mitigated by env scrubbing (W4.3) and Credential Manager storage (W0.9).
5. **Foreground disturbance** — hidden desktop leaked apps to the user's screen.
   Mitigated structurally by the isolated-VM fork (ADR-008).
6. **Replay / unauthenticated trigger** — webhook POST without token.
   Mitigated by bearer + nonce + body limit + rate limit (W0.8).
7. **Audit tampering** — attacker edits run history.
   Mitigated by hash chain (W3).
8. **Capability escape** — action exceeds granted scope.
   Mitigated by explicit allowlists and a 50-case red-team test (W4.1).

## Residual risks

- Vision-grounding mistakes can still click the wrong control inside the VM.
- A compromised VM guest could attack the host through the capture channel;
  the VM should be hardened and network-restricted before beta.
- The policy engine's path checks are lexical; symlink/canonical-resolution
  hardening (W4.4) is still required.

## Review

- [ ] Security reviewer sign-off before private alpha.
