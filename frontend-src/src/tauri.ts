// Phantom GUI — thin React client of the daemon control plane.
// Tauri v2 exposes invoke on __TAURI_INTERNALS__; keep the v1 global as a
// fallback so the same code works on both runtimes.

type W = Window & {
  __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
  __TAURI__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
}

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const w = window as W
  const fn = w.__TAURI_INTERNALS__?.invoke ?? w.__TAURI__?.invoke
  if (!fn) {
    return Promise.reject(new Error("Run inside the Phantom desktop app"))
  }
  return fn(cmd, args) as Promise<T>
}

export type TaskRecord = {
  id: string
  prompt: string
  status: string
  created_at?: string
}

export type VmStatus = {
  backend: string
  state: string
}

export type SubmitResult = { id: string }

export type AppSettings = {
  provider: string
  model: string
  mode: string
  max_iterations: number
  llm_endpoint: string
  confidence_gate: number
  max_parallel_workers: number
  key_configured: boolean
}

export type Approval = {
  id: string
  title?: string
  body?: string
}
