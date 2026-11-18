# B5 — generate THIRDPARTY-NOTICES.md from cargo metadata (no extra tooling).
$ErrorActionPreference = 'Stop'
$meta = cargo metadata --format-version 1 | ConvertFrom-Json
$lines = @('# Third-party notices', '', 'Generated from `cargo metadata`. Keep the full license texts of all dependencies in the installer.', '')
$seen = @{}
foreach ($pkg in $meta.packages) {
  $key = "$($pkg.name)-$($pkg.version)"
  if ($seen.ContainsKey($key)) { continue }
  $seen[$key] = $true
  $license = if ($pkg.license) { $pkg.license } else { 'see repository' }
  $lines += "- **$($pkg.name)** $($pkg.version) — $license — $($pkg.repository)"
}
$lines += @('', 'Python sidecar: PSF License v2 (retain the full Python license stack).',
  'WebView2 SDK: BSD-3-Clause; runtime governed by separate Microsoft terms.',
  'Chromium is NOT bundled; the host WebView2 runtime is used instead.')
Set-Content -Path 'THIRDPARTY-NOTICES.md' -Value $lines -Encoding UTF8
Write-Host "NOTICES=$($seen.Count) packages"
