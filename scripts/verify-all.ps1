# Full local verification loop: build -> test -> verify -> (no auto-commit).
# Run from the repository root.

$ErrorActionPreference = 'Stop'
Write-Host "== cargo check =="
cargo check --workspace --all-targets
if ($LASTEXITCODE -ne 0) { throw "cargo check failed" }

Write-Host "== cargo test =="
cargo test --workspace
if ($LASTEXITCODE -ne 0) { throw "cargo test failed" }

Write-Host "== golden-task harness =="
cargo run -p phantom-core --example bench
if ($LASTEXITCODE -ne 0) { throw "golden harness failed" }

Write-Host "== Python stdlib tests =="
$tests = @(
    'test_schema_strict', 'test_image_contract', 'test_single_inference',
    'test_failure_propagation', 'test_security_blockers',
    'test_cancellation_isolation', 'test_golden_harness',
    'test_packaging', 'test_wiring', 'test_control_plane',
    'test_gui_shell', 'test_provider_config', 'test_vm_backend',
    'test_beta_release', 'test_gh_evidence', 'test_release_gate_evidence'
)
python -m unittest ($tests | ForEach-Object { "python.tests.$_" })
if ($LASTEXITCODE -ne 0) { throw "Python tests failed" }

Write-Host "ALL VERIFICATION PASSED"
