import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card"
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

import { PROVIDERS, providerById } from "@/models"
import { invoke, type AppSettings, type Approval, type SubmitResult, type TaskRecord, type VmStatus } from "@/tauri"

function statusVariant(status: string): "default" | "success" | "destructive" | "warning" | "secondary" {
  const s = status.toLowerCase()
  if (s.includes("done") || s.includes("complete") || s.includes("success")) return "success"
  if (s.includes("fail") || s.includes("error") || s.includes("blocked")) return "destructive"
  if (s.includes("run") || s.includes("pending") || s.includes("wait")) return "warning"
  return "secondary"
}

export default function App() {
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [vm, setVm] = useState<VmStatus>({ backend: "…", state: "connecting" })
  const [prompt, setPrompt] = useState("")
  const [settings, setSettings] = useState<AppSettings>({
    provider: "claude",
    model: "",
    mode: "safe",
    max_iterations: 25,
    llm_endpoint: "",
    confidence_gate: 0.7,
    max_parallel_workers: 4,
    key_configured: false,
  })
  const [customModel, setCustomModel] = useState("")
  const [approval, setApproval] = useState<Approval | null>(null)
  const [frame, setFrame] = useState("No VM frame yet. The agent view streams here when a task runs.")
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<"tasks" | "settings">("tasks")
  const [apiKey, setApiKey] = useState("")
  const [saved, setSaved] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [list, status] = await Promise.all([
        invoke<TaskRecord[]>("list_tasks"),
        invoke<VmStatus>("vm_status"),
      ])
      setTasks(list)
      setVm(status)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    void invoke<AppSettings>("get_app_settings")
      .then((s) => {
        setSettings(s)
        if (s.model && !providerById(s.provider)?.models.some((m) => m.id === s.model)) {
          setCustomModel(s.model)
        }
      })
      .catch(() => {
        // Settings are optional on first run.
      })
  }, [])

  const onRun = async () => {
    const text = prompt.trim()
    if (!text) return
    try {
      const res = await invoke<SubmitResult>("submit_task", { prompt: text })
      setActiveId(res.id)
      setPrompt("")
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onStop = async () => {
    if (activeId) {
      try {
        await invoke("cancel_task", { id: activeId })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    setActiveId(null)
    await refresh()
  }

  const onCancelTask = async (id: string) => {
    try {
      await invoke("cancel_task", { id })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onSaveSettings = async () => {
    const model = customModel.trim() || settings.model
    try {
      await invoke("save_app_settings", { settings: { ...settings, model, key_configured: settings.key_configured } })
      setSettings((s) => ({ ...s, model }))
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onSaveApiKey = async () => {
    const key = apiKey.trim()
    if (!key) return
    try {
      await invoke("set_api_key", { key })
      setSettings((s) => ({ ...s, key_configured: true }))
      setApiKey("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onClearApiKey = async () => {
    try {
      await invoke("delete_api_key")
      setSettings((s) => ({ ...s, key_configured: false }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onResolveApproval = async (approve: boolean) => {
    if (approval) {
      try {
        await invoke("resolve_approval", { id: approval.id, approve })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    setApproval(null)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="font-heading text-lg font-semibold">Phantom</div>
        <Badge id="vm-pill" variant="secondary">
          VM: {vm.backend} · {vm.state}
        </Badge>
      </header>

      {error && (
        <div className="mx-5 mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!settings.key_configured && (
        <div className="mx-5 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm">
          <span>One-time setup: add your provider API key so Phantom can run tasks.</span>
          <Button size="sm" variant="outline" onClick={() => setView("settings")}>
            Open Settings
          </Button>
        </div>
      )}

      <main className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
        <Card id="composer">
          <CardHeader>
            <CardTitle>What should Phantom do?</CardTitle>
            <CardDescription>Give the agent a task. Consequential actions can require approval.</CardDescription>
          </CardHeader>
          <CardPanel className="flex flex-col gap-3">
            <Textarea
              id="prompt"
              rows={3}
              value={prompt}
              placeholder="e.g. Open Notepad and write a short release note"
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Mode"
                className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
                value={settings.mode}
                onChange={(e) => setSettings((s) => ({ ...s, mode: e.target.value }))}
              >
                <option value="safe">Ask before consequential actions</option>
                <option value="hero">Full VM access</option>
              </select>
              <Button id="run" onClick={() => void onRun()}>
                Start task
              </Button>
            </div>
          </CardPanel>
        </Card>

        <Card id="activity">
          <CardHeader>
            <CardTitle>Live activity</CardTitle>
            <CardDescription>The agent view streams here when a task runs.</CardDescription>
          </CardHeader>
          <CardPanel className="flex flex-col gap-3">
            <div id="frame" className="min-h-45 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              {frame}
            </div>
            <ol id="timeline" className="max-h-48 space-y-1 overflow-y-auto text-sm" />
            <div className="flex gap-2">
              <Button id="stop" variant="outline" disabled={!activeId} onClick={() => void onStop()}>
                Stop task
              </Button>
              <Button
                id="takeover"
                variant="outline"
                disabled={!activeId}
                onClick={() => setFrame("Take over: connect to the VM with the viewer shown in Settings.")}
              >
                Take over VM
              </Button>
            </div>
          </CardPanel>
        </Card>

        <Card id="tasks" className={view === "tasks" ? "" : "hidden"}>
          <CardHeader>
            <CardTitle>Tasks</CardTitle>
            <CardDescription>Everything submitted to the control plane.</CardDescription>
          </CardHeader>
          <CardPanel>
            <div id="task-list" className="flex flex-col divide-y divide-border">
              {tasks.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No tasks yet.</p>
              ) : (
                tasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 py-2">
                    <strong className="min-w-0 truncate text-sm">{t.prompt}</strong>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                      <Button size="sm" variant="ghost" onClick={() => void onCancelTask(t.id)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardPanel>
        </Card>

        <Card id="settings" className={view === "settings" ? "" : "hidden"}>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>Provider, model and execution mode.</CardDescription>
          </CardHeader>
          <CardPanel className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              This app is the only place you configure Phantom. Command-line and CI tooling are internal.
            </p>
            <label className="grid gap-1 text-sm">
              Provider
              <select
                id="provider"
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                value={settings.provider}
                onChange={(e) => {
                  setSettings((s) => ({ ...s, provider: e.target.value, model: "" }))
                  setCustomModel("")
                }}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Model
              <select
                id="model"
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                value={customModel ? "__custom__" : settings.model || providerById(settings.provider)?.models[0]?.id || ""}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    setCustomModel("custom-model")
                  } else {
                    setCustomModel("")
                    setSettings((s) => ({ ...s, model: e.target.value }))
                  }
                }}
              >
                {(providerById(settings.provider)?.models ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.label}{m.note ? ` - ${m.note}` : ""}</option>
                ))}
                <option value="__custom__">Custom model ID…</option>
              </select>
            </label>
            {customModel && (
              <Input
                id="model-custom"
                placeholder="provider/model-id"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
              />
            )}
            {providerById(settings.provider)?.needsEndpoint && (
              <label className="grid gap-1 text-sm">
                Endpoint URL
                <Input
                  id="endpoint"
                  placeholder="http://127.0.0.1:11434/v1"
                  value={settings.llm_endpoint}
                  onChange={(e) => setSettings((s) => ({ ...s, llm_endpoint: e.target.value }))}
                />
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-sm">
                Mode
                <select
                  id="mode"
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                  value={settings.mode}
                  onChange={(e) => setSettings((s) => ({ ...s, mode: e.target.value }))}
                >
                  <option value="safe">Safe (ask first)</option>
                  <option value="hero">Hero (full access)</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                Max iterations
                <Input
                  id="max-iterations"
                  type="number"
                  min={1}
                  value={settings.max_iterations}
                  onChange={(e) => setSettings((s) => ({ ...s, max_iterations: Number(e.target.value) || 1 }))}
                />
              </label>
              <label className="grid gap-1 text-sm">
                Confidence gate (0-1)
                <Input
                  id="confidence"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.confidence_gate}
                  onChange={(e) => setSettings((s) => ({ ...s, confidence_gate: Number(e.target.value) }))}
                />
              </label>
              <label className="grid gap-1 text-sm">
                Parallel workers
                <Input
                  id="workers"
                  type="number"
                  min={1}
                  value={settings.max_parallel_workers}
                  onChange={(e) => setSettings((s) => ({ ...s, max_parallel_workers: Number(e.target.value) || 1 }))}
                />
              </label>
            </div>
            <Separator />
            <div className="grid gap-2">
              <div className="flex items-center justify-between text-sm">
                <span>Provider API key</span>
                <Badge id="api-key-status" variant={settings.key_configured ? "success" : "warning"}>
                  {settings.key_configured ? "Stored in Credential Manager" : "Not configured"}
                </Badge>
              </div>
              <Input
                id="api-key"
                type="password"
                autoComplete="off"
                placeholder="Paste your provider API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <div className="flex gap-2">
                <Button id="save-api-key" variant="outline" onClick={() => void onSaveApiKey()}>
                  Save key
                </Button>
                {settings.key_configured && (
                  <Button id="clear-api-key" variant="ghost" onClick={() => void onClearApiKey()}>
                    Clear key
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Stored only in Windows Credential Manager. Never written to config or logs.
              </p>
            </div>
            <Separator />
            <div className="flex items-center gap-2">
              <Button id="save-settings" onClick={() => void onSaveSettings()}>
                Save settings
              </Button>
              {saved && <Badge variant="success">Saved</Badge>}
            </div>
          </CardPanel>
        </Card>
      </main>

      <nav className="flex gap-2 px-5 pb-5">
        <Button variant={view === "tasks" ? "default" : "outline"} onClick={() => setView("tasks")}>
          Tasks
        </Button>
        <Button variant={view === "settings" ? "default" : "outline"} onClick={() => setView("settings")}>
          Settings
        </Button>
      </nav>

      <Dialog open={approval !== null} onOpenChange={(open) => !open && setApproval(null)}>
        <DialogPopup id="approval" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle id="approval-title">{approval?.title ?? "Approve action?"}</DialogTitle>
            <DialogDescription id="approval-body">{approval?.body ?? "The agent is about to take a consequential action."}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} onClick={() => void onResolveApproval(false)}>
              Deny
            </DialogClose>
            <DialogClose render={<Button />} onClick={() => void onResolveApproval(true)}>
              Approve
            </DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  )
}
