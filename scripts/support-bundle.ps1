# W8.5 — export a REDACTED support bundle. Never include secrets.
# Keys are stored in Windows Credential Manager, not config.toml, but env
# variables and logs can still leak them — scrub aggressively.

$ErrorActionPreference = 'Stop'
$out = Join-Path $env:TEMP 'phantom-support-bundle'
New-Item -ItemType Directory -Force -Path $out | Out-Null

$patterns = @(
    '(?i)(api[_-]?key\s*[=:]\s*)[A-Za-z0-9_\-]{16,}',
    '(?i)(bearer\s+)[A-Za-z0-9._\-]{16,}',
    '(?i)(sk-[A-Za-z0-9]{16,})',
    '(?i)(nvapi-[A-Za-z0-9]{16,})',
    '(?i)(PHANTOM_API_KEY\s*=\s*)\S+'
)

function Copy-Redacted([string]$src, [string]$name) {
    if (-not (Test-Path $src)) { return }
    $text = Get-Content $src -Raw
    foreach ($p in $patterns) { $text = [regex]::Replace($text, $p, '$1[REDACTED]') }
    Set-Content -Path (Join-Path $out $name) -Value $text
}

Copy-Redacted (Join-Path $env:USERPROFILE '.phantom\config.toml') 'config.toml'
Copy-Redacted (Join-Path $env:LOCALAPPDATA 'Phantom\logs\phantom.log') 'phantom.log'
Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Phantom') -Filter '*.json' -ErrorAction SilentlyContinue | ForEach-Object { Copy-Redacted $_.FullName $_.Name }

Write-Host "Support bundle: $out (review before sharing)"
