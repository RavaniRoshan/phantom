# Install Phantom as a background Windows app without a separate installer run.
#
# Copies the built binaries and a self-contained Python sidecar to
# %LOCALAPPDATA%\Phantom, then registers a per-user logon task so the daemon
# runs in the background. No admin rights, no Python install, no VM needed.

param(
    [switch]$SkipSidecar
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$install = Join-Path $env:LOCALAPPDATA 'Phantom'
New-Item -ItemType Directory -Path $install -Force | Out-Null

function Find-Binary([string]$name) {
    foreach ($profile in @('release', 'debug')) {
        $candidate = Join-Path $root "target/$profile/$name"
        if (Test-Path $candidate) { return $candidate }
    }
    throw "$name not found - run 'cargo build -p phantom-daemon -p phantom-cli' first"
}

foreach ($name in @('phantom-daemon.exe', 'phantom.exe', 'phantom-guest.exe')) {
    $source = Find-Binary $name
    Copy-Item $source (Join-Path $install $name) -Force
    Write-Host "Installed $name"
}

# Tauri GUI exe is optional until phantom-app is built.
$gui = Join-Path $root 'target/release/phantom-app.exe'
if (-not (Test-Path $gui)) { $gui = Join-Path $root 'target/debug/phantom-app.exe' }
if (Test-Path $gui) {
    Copy-Item $gui (Join-Path $install 'Phantom.exe') -Force
    Write-Host "Installed Phantom.exe (GUI)"
} else {
    Write-Warning "phantom-app.exe not built; GUI shortcut skipped. The background daemon is installed."
}

if (-not $SkipSidecar) {
    & (Join-Path $PSScriptRoot 'stage-sidecar.ps1') -OutDir (Join-Path $install 'python')
}

# Background startup: per-user scheduled task, no elevation required.
$taskName = 'PhantomDaemon'
$daemon = Join-Path $install 'phantom-daemon.exe'
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute $daemon
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Phantom background computer-use agent' | Out-Null
Write-Host "Registered background task '$taskName' (runs at logon)."

Start-Process $daemon
Write-Host "Phantom daemon started in the background."
