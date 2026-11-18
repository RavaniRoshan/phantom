//! Auto-start the bundled Python LLM sidecar.
//!
//! An installed Phantom must work with no separate Python setup: the daemon
//! locates the sidecar shipped beside it, starts `phantom_llm.server`, and
//! stops it on exit. Set `PHANTOM_NO_SIDECAR=1` to manage the service yourself
//! (development / tests).

use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::Duration;

/// Owns the spawned sidecar process; killing it on drop avoids orphaned servers.
pub struct Sidecar {
    child: Option<Child>,
}

impl Sidecar {
    pub fn start() -> Self {
        if std::env::var_os("PHANTOM_NO_SIDECAR").is_some() {
            return Self { child: None };
        }

        // If a service is already listening, do not start a second one.
        let endpoint = std::env::var("PHANTOM_GRPC_ENDPOINT")
            .unwrap_or_else(|_| "127.0.0.1:50051".to_string());
        if TcpStream::connect_timeout(
            &endpoint.parse().unwrap_or_else(|_| "127.0.0.1:50051".parse().unwrap()),
            Duration::from_millis(250),
        )
        .is_ok()
        {
            tracing::info!("LLM sidecar already listening at {endpoint}; not spawning another");
            return Self { child: None };
        }

        let Some(python) = find_python() else {
            tracing::warn!("no bundled Python sidecar found; set PHANTOM_PYTHON or install the full package");
            return Self { child: None };
        };
        // PHANTOM_SIDECAR_DIR lets a developer point at the source tree while
        // keeping the installed layout (python/ beside the daemon) as default.
        let root = std::env::var("PHANTOM_SIDECAR_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                python
                    .parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| PathBuf::from("."))
            });

        let mut cmd = Command::new(&python);
        cmd.arg("-m")
            .arg("phantom_llm.server")
            .current_dir(&root)
            .env("PYTHONPATH", &root)
            .env("PYTHONUNBUFFERED", "1");

        #[cfg(windows)]
        {
            // CREATE_NO_WINDOW — never flash a console when running in background.
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }

        match cmd.spawn() {
            Ok(child) => {
                tracing::info!("started bundled LLM sidecar from {}", python.display());
                Self { child: Some(child) }
            }
            Err(e) => {
                tracing::warn!("could not start LLM sidecar: {e}");
                Self { child: None }
            }
        }
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
        }
    }
}

/// Locate the Python runtime that carries the bundled sidecar.
fn find_python() -> Option<PathBuf> {
    // 1. Explicit override (also used by local development).
    if let Ok(p) = std::env::var("PHANTOM_PYTHON") {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Some(path);
        }
    }

    // 2. Beside the running daemon (installed layout).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("python").join(exe_name());
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    // 3. Per-user install location used by the MSI/NSIS installer.
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let candidate = Path::new(&local).join("Phantom").join("python").join(exe_name());
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    // 4. System Python (development fallback).
    which_python()
}

#[cfg(windows)]
fn exe_name() -> &'static str {
    "python.exe"
}

#[cfg(not(windows))]
fn exe_name() -> &'static str {
    "python3"
}

#[cfg(windows)]
fn which_python() -> Option<PathBuf> {
    // `where python` is the simplest dependency-free lookup on Windows.
    let out = Command::new("where").arg("python").output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .map(str::trim)
        .map(PathBuf::from)
        .find(|p| p.is_file())
}

#[cfg(not(windows))]
fn which_python() -> Option<PathBuf> {
    let out = Command::new("which").arg("python3").output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .map(str::trim)
        .map(PathBuf::from)
        .find(|p| p.is_file())
}
