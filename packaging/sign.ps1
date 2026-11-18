# B5 — sign a Windows artifact. Never ship unsigned or self-signed as "signed".
# SignPath Foundation (free OSS) is first choice; Azure Artifact Signing is the
# fallback. Self-signed builds are development-only.
param(
  [Parameter(Mandatory=$true)][string]$File,
  [ValidateSet('signpath','artifact','selfsigned-dev')][string]$Mode = 'signpath'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $File)) { throw "File not found: $File" }

switch ($Mode) {
  'signpath' {
    # The SignPath wrapper is configured in CI with a service account; the
    # certificate subject will be "SignPath Foundation" (not Phantom).
    $wrapper = $env:SIGNPATH_WRAPPER
    if (-not $wrapper) { throw "Set SIGNPATH_WRAPPER to the SignPath signing command" }
    & $wrapper $File
  }
  'artifact' {
    # Azure Artifact Signing (formerly Trusted Signing), Basic SKU 5k sigs/mo.
    # Individual Public Trust is US/Canada only — check eligibility in B0.4.
    & artifact-signing-cli -e $env:AZURE_ENDPOINT -a $env:AZURE_ACCOUNT -c $env:AZURE_PROFILE -d Phantom $File
  }
  'selfsigned-dev' {
    Write-Warning 'Self-signed: SmartScreen treats this as unsigned. Development only.'
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=Phantom Dev' -CertStoreLocation Cert:\CurrentUser\My
    Set-AuthenticodeSignature -FilePath $File -Certificate $cert | Out-Null
  }
}

if ($LASTEXITCODE -ne 0 -and $Mode -ne 'selfsigned-dev') { throw "Signing failed with exit $LASTEXITCODE" }
signtool verify /pa $File
Write-Host "SIGNED_OK $File (mode=$Mode)"
