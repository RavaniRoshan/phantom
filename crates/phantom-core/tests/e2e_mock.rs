//! Full-stack integration harness: Rust agent ↔ gRPC ↔ Python `phantom_llm`.
//!
//! Unlike the per-crate unit tests, this drives the **whole system as one**:
//! it boots the real Python gRPC service with the offline, deterministic
//! `mock` provider (no API key, no network), connects the real
//! [`phantom_core::PhantomClient`], and runs the real [`phantom_core::Agent`]
//! observe→decide→execute loop over the cross-platform `file` backend.
//!
//! Gated by the `PHANTOM_E2E=1` env var so a normal `cargo test` (which has no
//! Python service and, in the Linux CI, has not yet generated the proto stubs)
//! is unaffected — the tests return early as a no-op otherwise. CI runs them in
//! a dedicated step after the Python package + stubs are set up.
//!
//! Why the `file` backend: it executes via `std::fs` on every OS. The `cli`
//! (PowerShell, `cfg(windows)`) and `desktop` (Windows-only) backends are
//! covered end-to-end by `windows-runtime.yml` instead.

use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use phantom_core::{Agent, ApprovalDecision, ApprovalQueue, Config, Mode};
use phantom_core::stream::AgentEvent;
use tokio::sync::mpsc;

/// A file-routed task. The mock provider routes any task mentioning
/// "file"/"read"/"directory" to the `file` backend, whose scripted sequence is
/// `list_dir(".")` then `done` — both safe and cross-platform.
const FILE_TASK: &str = "read the file listing in the current directory";

/// True unless `PHANTOM_E2E=1`. When true, the test is skipped (returns Ok).
fn e2e_disabled() -> bool {
    std::env::var("PHANTOM_E2E").ok().as_deref() != Some("1")
}

/// A spawned mock gRPC server that is killed on drop.
struct MockServer {
    child: Child,
    endpoint: String,
}

impl Drop for MockServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Boot `python -m phantom_llm.server` with the mock provider on `port`.
///
/// Returns `None` (test skips) if the interpreter or generated stubs are not
/// available, so the harness degrades gracefully in environments that have not
/// run `generate_proto.py`.
fn start_mock_server(port: u16) -> Option<MockServer> {
    // Repo layout: this crate is at <root>/crates/phantom-core, the Python
    // service (and its generated `phantom_pb2` stubs) live at <root>/python.
    let manifest = env!("CARGO_MANIFEST_DIR");
    let python_dir = std::path::Path::new(manifest)
        .join("..")
        .join("..")
        .join("python");
    if !python_dir.join("phantom_pb2.py").exists() {
        eprintln!(
            "e2e skip: generated stubs not found at {} (run `python generate_proto.py`)",
            python_dir.display()
        );
        return None;
    }

    // Allow CI / a venv to point at a specific interpreter.
    let python = std::env::var("PHANTOM_PYTHON").unwrap_or_else(|_| "python".to_string());

    let child = Command::new(&python)
        .arg("-m")
        .arg("phantom_llm.server")
        .current_dir(&python_dir)
        .env("PHANTOM_PROVIDER", "mock")
        .env("PHANTOM_GRPC_PORT", port.to_string())
        // The mock provider needs no key; make sure none is required.
        .env("PHANTOM_API_KEY", "")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    let child = match child {
        Ok(c) => c,
        Err(e) => {
            eprintln!("e2e skip: could not spawn `{python} -m phantom_llm.server`: {e}");
            return None;
        }
    };

    let endpoint = format!("http://127.0.0.1:{port}");
    Some(MockServer { child, endpoint })
}

/// Poll the TCP port until it accepts a connection or the deadline passes.
fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let addr = format!("127.0.0.1:{port}");
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if std::net::TcpStream::connect(&addr).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

/// Build a Safe-mode config pointed at `endpoint` with a bounded loop.
fn e2e_config(endpoint: &str, gate: f32) -> Config {
    let mut cfg = Config::default();
    cfg.mode = Mode::Safe;
    cfg.grpc_endpoint = endpoint.to_string();
    cfg.max_iterations = 10;
    cfg.confidence_gate = gate;
    cfg
}

/// The whole stack completes a task: the agent actually *executes* an action
/// (not skipped by the gate) and reaches a `Result`.
///
/// This is the test that fails before the confidence fix: with the old `0.0`
/// server default and `0.95` gate, every non-`done` action is gated and — with
/// no approval queue — **skipped** (recorded as FAILED), so the loop reaches
/// `done` having done no real work. We assert on ≥1 *successfully executed*
/// action, which only happens once confidence clears the gate.
#[tokio::test]
async fn full_stack_completes_a_file_task() {
    if e2e_disabled() {
        eprintln!("e2e skip: set PHANTOM_E2E=1 to run the full-stack integration test");
        return;
    }
    let port = 50551;
    let Some(server) = start_mock_server(port) else {
        return; // environment not set up; skip
    };
    assert!(
        wait_for_port(port, Duration::from_secs(20)),
        "mock gRPC server did not come up on port {port}"
    );

    let client = phantom_core::PhantomClient::connect(&server.endpoint)
        .await
        .expect("connect to mock server");
    // No approval queue attached: a gated action would be skipped, not paused.
    let agent = Agent::new(e2e_config(&server.endpoint, Config::default().confidence_gate), client);

    let (tx, mut rx) = mpsc::channel::<AgentEvent>(64);
    let run = tokio::spawn(async move { agent.run(FILE_TASK, tx).await });

    let mut ok_actions = 0usize;
    let mut got_result = false;
    while let Some(ev) = rx.recv().await {
        match ev {
            // `label_action` prefixes executed actions with "ok" on success and
            // "FAILED" otherwise; a skipped (gated, no-queue) action is FAILED.
            AgentEvent::Action(a) if a.reasoning.starts_with("ok") => ok_actions += 1,
            AgentEvent::Result(_) => got_result = true,
            _ => {}
        }
    }
    run.await.expect("join agent task").expect("agent run ok");

    assert!(got_result, "agent never produced a Result event");
    assert!(
        ok_actions >= 1,
        "no action was actually executed — the confidence gate skipped everything \
         (confidence plumbing regression)"
    );
}

/// The gate + approval queue engage end-to-end: a low-confidence action pauses
/// (fills the queue) and the task does not auto-complete until resolved.
#[tokio::test]
async fn gate_pauses_low_confidence_action() {
    if e2e_disabled() {
        eprintln!("e2e skip: set PHANTOM_E2E=1 to run the full-stack integration test");
        return;
    }
    let port = 50552;
    let Some(server) = start_mock_server(port) else {
        return;
    };
    assert!(
        wait_for_port(port, Duration::from_secs(20)),
        "mock gRPC server did not come up on port {port}"
    );

    let client = phantom_core::PhantomClient::connect(&server.endpoint)
        .await
        .expect("connect to mock server");

    // A near-max gate forces even the mock's confident file action (0.85) to
    // pause. Attach a queue so it is *paused*, not skipped.
    let queue = ApprovalQueue::new();
    let mut agent = Agent::new(e2e_config(&server.endpoint, 0.99), client);
    agent.set_approval_queue(Some(queue.clone()));

    let (tx, mut rx) = mpsc::channel::<AgentEvent>(64);
    let task_queue = queue.clone();
    let run = tokio::spawn(async move { agent.run(FILE_TASK, tx).await });
    // Drain events in the background so the channel never blocks the agent.
    let drain = tokio::spawn(async move { while rx.recv().await.is_some() {} });

    // The agent should block awaiting approval → the queue becomes non-empty.
    let mut paused = false;
    for _ in 0..50 {
        if task_queue.count().await > 0 {
            paused = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(paused, "gate never paused a low-confidence action");

    // Resolving unblocks the agent so the run finishes and the test cleans up.
    task_queue.resolve_all(ApprovalDecision::Approve).await;
    run.await.expect("join agent").expect("agent run ok");
    drain.await.ok();
}
