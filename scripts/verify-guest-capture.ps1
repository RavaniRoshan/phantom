# B0.3/B6 — live capture proof inside a Windows interactive session.
# Designed for GitHub Actions windows-2022 (no inbound RDP, no local RAM cost).
# Starts phantom-guest, verifies a real non-black PNG, then stops it.

$ErrorActionPreference = 'Stop'
$token = 'phantom-ci-guest-token'
$exe = 'target/debug/phantom-guest.exe'
$shot = 'guest-capture.png'

if (-not (Test-Path $exe)) { throw "Build phantom-guest first: cargo build -p phantom-guest" }

$env:PHANTOM_GUEST_TOKEN = $token
$proc = Start-Process -FilePath (Resolve-Path $exe) -PassThru -WindowStyle Hidden
try {
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) {
    try {
      $health = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/health' -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 2 -UseBasicParsing
      if ($health.StatusCode -eq 200) { $ok = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ok) { throw 'Guest agent did not become healthy' }

  $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/screenshot' -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 30 -UseBasicParsing
  if ($resp.StatusCode -ne 200) { throw "Screenshot failed: $($resp.StatusCode)" }
  [IO.File]::WriteAllBytes($shot, $resp.Content)

  $magic = [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
  $head = [IO.File]::ReadAllBytes($shot)[0..7]
  if (-not ([Linq.Enumerable]::SequenceEqual([byte[]]$head, [byte[]]$magic))) { throw 'Capture is not a PNG' }

  $width = [BitConverter]::ToUInt32([byte[]]([IO.File]::ReadAllBytes($shot)[19..16]), 0)
  $height = [BitConverter]::ToUInt32([byte[]]([IO.File]::ReadAllBytes($shot)[23..20]), 0)
  if ($width -lt 100 -or $height -lt 100) { throw "Invalid capture dimensions ${width}x${height}" }

  # An all-black or single-colour frame is the hidden-desktop failure signature.
  $bytes = [IO.File]::ReadAllBytes($shot)
  $distinct = ($bytes | Select-Object -Unique).Count
  if ($distinct -lt 8) { throw "Capture has only $distinct distinct byte values (likely black/blank)" }

  Write-Host "CAPTURE_OK ${width}x${height} bytes=$($bytes.Length) distinct=$distinct"
} finally {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}
