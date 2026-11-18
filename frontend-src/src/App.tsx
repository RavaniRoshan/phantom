import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card"
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

import { invoke, type Approval, type Settings, type SubmitResult, type TaskRecord, type VmStatus } from "@/tauri"

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
  const [mode, setMode] = useState("safe")
  const [provider, setProvider] = useState("gemini")
  const [model, setModel] = useState("")
  const [approval, setApproval] = useState<Approval | null>(null)
  const [frame, setFrame] = useState("No VM frame yet. The agent view streams here when a task runs.")
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<"tasks" | "settings">("tasks")

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
    void invoke<Settings>("get_settings")
      .then((s) => {
        setProvider(s.provider ?? "gemini")
        setModel(s.model ?? "")
        if (s.mode) setMode(s.mode)
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
    try {
      await invoke("set_settings", {
        settings: { provider, model, mode, max_iterations: 25 } satisfies Settings,
      })
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
                value={mode}
                onChange={(e) => setMode(e.target.value)}
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
            <Separator />
            <label className="grid gap-1 text-sm">
              Provider
              <Input id="provider" value={provider} onChange={(e) => setProvider(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              Model
              <Input id="model" placeholder="default" value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <Button id="save-settings" onClick={() => void onSaveSettings()}>
              Save
            </Button>
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
