# Stage a self-contained Python LLM sidecar for the installed Phantom app.
#
# The daemon auto-starts this sidecar (see crates/phantom-daemon/src/sidecar.rs),
# so an installed user never needs Python or a second program. For releases,
# replace the copied host runtime with the official Python embeddable package
# of the same version; the layout below is what the daemon expects.

param(
    [string]$Python = "python",
    [string]$OutDir = "build/sidecar/python"
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dest = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $root $OutDir }

Write-Host "Staging sidecar into $dest"
Remove-Item -Recurse -Force $dest -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $dest -Force | Out-Null

$pyhome = (& $Python -c "import sys; print(sys.prefix)" 2>&1).Trim()
if (-not (Test-Path $pyhome)) { throw "Python prefix not found: $pyhome" }

# Runtime. The embeddable package has a flat layout; a host install has
# DLLs/ and Lib/. Copy both shapes defensively.
$exe = Get-ChildItem -Path $pyhome -Filter 'python*.exe' -File | Select-Object -First 1
if (-not $exe) { throw "No python.exe in $pyhome" }
Copy-Item $exe.FullName $dest
foreach ($dll in Get-ChildItem -Path $pyhome -Filter 'python3*.dll' -File) {
    Copy-Item $dll.FullName $dest
}
foreach ($folder in @('DLLs', 'Lib')) {
    $src = Join-Path $pyhome $folder
    if (Test-Path $src) { Copy-Item $src (Join-Path $dest $folder) -Recurse -Force }
}

# Our package + generated proto stubs.
Copy-Item (Join-Path $root 'python/phantom_llm') (Join-Path $dest 'phantom_llm') -Recurse -Force
foreach ($stub in @('phantom_pb2.py', 'phantom_pb2_grpc.py')) {
    Copy-Item (Join-Path $root "python/$stub") (Join-Path $dest $stub) -Force
}

# Third-party dependencies, installed into the staged site-packages.
$site = Join-Path $dest 'Lib/site-packages'
New-Item -ItemType Directory -Path $site -Force | Out-Null
# grpcio-tools is intentionally NOT installed here: it is only needed to
# generate the proto stubs (already copied above) and has no wheel on newer
# Python versions. The runtime only needs grpcio.
& $Python -m pip install --disable-pip-version-check --no-compile --quiet --target $site `
    "grpcio>=1.60" "anthropic>=0.40" "openai>=1.30" `
    "google-generativeai>=0.5" "ollama>=0.4" "pydantic>=2.0"
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Write-Host "Sidecar staged at $dest"
