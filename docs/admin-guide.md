# Phantom — Admin Guide (v1 private beta)

## Installation

- `packaging/wix/Product.wxs` builds the per-user MSI. Build with WiX `candle`
  + `light`, then **code-sign** with the release certificate before shipping.
- Bundle the Rust binaries and a `python-build-standalone` sidecar. Do not use
  PyOxidizer or one-file extraction (ADR-006).
- Register autostart with `scripts/install-service.ps1` (per-user scheduled
  task, no admin rights needed at runtime).

## Configuration

Config lives at `~/.phantom/config.toml` but contains **no secrets**. Keys are
in Windows Credential Manager (`phantom/api_key`) and the webhook token at
`phantom/webhook_token`. Env overrides: `PHANTOM_API_KEY`, `PHANTOM_PROVIDER`,
`PHANTOM_WEBHOOK_TOKEN`, `PHANTOM_GRPC_PORT`.

## Webhook

The loopback endpoint `POST /event` requires:

- `Authorization: Bearer <token>` (the per-install token),
- `X-Phantom-Nonce: <unique>` (replay protection, 5-minute window),
- JSON body ≤ 64 KiB, 60 requests/minute.

Status codes: 401 unauthenticated, 409 replay, 413 too large, 429 rate limited,
202 accepted.

## VM provisioning (isolated-VM fork)

`phantom-vm` abstracts Hyper-V and Windows 365 Cloud PC behind `VmBackend`.
Configure VM credentials in Credential Manager (targets named in `VmConfig`);
the host only stores references. Harden and network-restrict the VM before
rollout — a compromised guest is a residual risk in the threat model.

## Updating

Signed update channel with rollback: stage the new MSI, verify signature,
install, run a smoke task; keep the previous MSI for rollback rehearsal.
