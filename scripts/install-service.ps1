# W8.2 — register the daemon as a per-user scheduled task (no admin required).
# Runs at logon, restarts on failure, survives reboot.

$ErrorActionPreference = 'Stop'
$taskName = 'PhantomDaemon'
$daemon = Join-Path $env:LOCALAPPDATA 'Phantom\phantom-daemon.exe'

if (-not (Test-Path $daemon)) {
    throw "Daemon not found at $daemon — install Phantom first."
}

# Remove an existing task so this script is idempotent.
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute $daemon
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Phantom background agent' | Out-Null
Write-Host "Registered per-user task '$taskName'."
