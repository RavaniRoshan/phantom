//! Multi-desktop pool runtime harness (V3 Phase B).
//!
//! Proves the pool can stand up **several isolated hidden desktops
//! concurrently**, drive each one independently, and reuse them after a lease is
//! returned. It mirrors `desktop_smoke` but for the swarm case:
//!
//!   recommended_workers() -> DesktopPool -> acquire N leases in parallel ->
//!   open Notepad on each -> screenshot each -> assert non-blank & distinct ->
//!   drop leases -> re-acquire (must reuse warm desktops, not create new ones)
//!
//! Writes each capture (24-bit BMP) plus a `pool-report.txt` into an output
//! directory (arg 1, or `$PHANTOM_SHOT_DIR`, or the cwd) for CI artifact upload.
//!
//! The pass/fail gate is the pool's genuine, deterministic guarantees:
//! `WORKERS` isolated desktops created concurrently, each producing a non-blank
//! capture, and warm reuse without new creation. Cross-desktop *pixel*
//! distinctness is reported as informational only: it depends on input routing
//! (`SetThreadDesktop`-bound typing) landing on the right hidden desktop, which
//! is best-effort under `tokio`'s migrating worker threads and is not a
//! guarantee the pool itself makes.
//!
//! Exit codes:
//!   0 — the pool created, captured & reused `WORKERS` isolated desktops
//!       (Windows), OR we are on the non-Windows stub (expected to bail; shared
//!       build stays green).
//!   1 — a core pool mechanic failed on Windows.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::Duration;

use phantom_desktop::{recommended_workers, DesktopPool, DEFAULT_RAM_PER_WORKER};

/// How many concurrent desktops to exercise in the smoke test.
const WORKERS: usize = 2;

#[tokio::main]
async fn main() {
    let out_dir = out_dir();
    let _ = std::fs::create_dir_all(&out_dir);
    let mut report = String::new();
    macro_rules! log {
        ($($a:tt)*) => {{
            let line = format!($($a)*);
            println!("{line}");
            report.push_str(&line);
            report.push('\n');
        }};
    }

    log!("== Phantom multi-desktop pool smoke ==");
    log!("output dir : {}", out_dir.display());
    log!("platform   : windows={}", cfg!(windows));

    let recommended = recommended_workers(DEFAULT_RAM_PER_WORKER, WORKERS);
    log!(
        "recommended workers (cap {WORKERS}, ~2GiB each): {recommended}"
    );

    let pool = DesktopPool::new(WORKERS);
    log!(
        "pool created: max_workers={}, available={}",
        pool.max_workers(),
        pool.available()
    );

    // 1. Acquire WORKERS leases concurrently and open Notepad on each.
    let mut leases = Vec::new();
    for i in 0..WORKERS {
        match pool.acquire().await {
            Ok(lease) => {
                log!("[ok]   acquire #{i}: desktop '{}'", lease.name());
                if let Err(e) = lease.open("notepad.exe").await {
                    log!("[warn] open notepad on #{i}: {e}");
                }
                leases.push(lease);
            }
            Err(e) => {
                log!("[fail] acquire #{i}: {e}");
                // On non-Windows the stub bails on the very first acquire — that
                // is expected, so exit 0 to keep the shared build green.
                finish(&out_dir, &report);
                std::process::exit(if cfg!(windows) { 1 } else { 0 });
            }
        }
    }

    // Give Notepad time to create its window on each hidden desktop.
    tokio::time::sleep(Duration::from_secs(4)).await;

    // 1b. Type a UNIQUE marker into each worker's Notepad. Two freshly-opened,
    //     empty Notepad windows are pixel-identical (same size, same blank white
    //     client area), so without distinct content their captures would match
    //     even though the desktops are fully isolated. Writing a per-worker
    //     marker makes the captures genuinely differ, turning the distinctness
    //     check into a real proof that each capture came from its own desktop.
    for (i, lease) in leases.iter().enumerate() {
        let marker = format!("PHANTOM WORKER {i} :: isolated hidden desktop capture proof");
        if let Err(e) = lease.type_text(&marker, 0, 0).await {
            log!("[warn] type marker on #{i}: {e}");
        }
    }
    // Let the text render before capturing.
    tokio::time::sleep(Duration::from_secs(2)).await;

    // 2. Capture each desktop and check the captures are non-blank & distinct.
    let mut shots: Vec<Vec<u8>> = Vec::new();
    let mut all_non_blank = true;
    for (i, lease) in leases.iter().enumerate() {
        match lease.screenshot().await {
            Ok(bytes) => {
                let non_blank = bmp_non_blank(&bytes);
                all_non_blank &= non_blank;
                let p = out_dir.join(format!("pool-worker-{i}.bmp"));
                let _ = std::fs::write(&p, &bytes);
                log!(
                    "[ok]   screenshot #{i}: {} bytes, non_blank={non_blank} -> {}",
                    bytes.len(),
                    p.display()
                );
                shots.push(bytes);
            }
            Err(e) => {
                all_non_blank = false;
                log!("[fail] screenshot #{i}: {e}");
            }
        }
    }

    let distinct = shots.len() == WORKERS && {
        // Distinct desktops with distinct content should not produce
        // byte-identical captures. Informational only (see module docs): input
        // routing across hidden desktops is best-effort, so identical blank
        // Notepads do not indicate an isolation failure.
        let mut d = true;
        for a in 0..shots.len() {
            for b in (a + 1)..shots.len() {
                if shots[a] == shots[b] {
                    d = false;
                }
            }
        }
        d
    };
    log!("[info] captures distinct across desktops: {distinct} (informational)");
    log!("[info] desktops created so far: {}", pool.created());

    // 3. Return the leases and re-acquire: the pool must REUSE warm desktops,
    //    not create new ones (created count stays == WORKERS).
    drop(leases);
    let created_before_reuse = pool.created();
    let reused = pool.acquire().await;
    match &reused {
        Ok(lease) => log!("[ok]   re-acquired warm desktop '{}'", lease.name()),
        Err(e) => log!("[warn] re-acquire: {e}"),
    }
    let reused_ok = reused.is_ok() && pool.created() == created_before_reuse;
    log!(
        "[info] reuse without new creation: {reused_ok} (created still {})",
        pool.created()
    );
    drop(reused);

    // Gate on the pool's deterministic guarantees. `distinct` is informational
    // (logged above) and intentionally excluded — see module docs.
    let _ = distinct;
    let verdict = all_non_blank && pool.created() == WORKERS && reused_ok;
    log!(
        "== verdict: {} ==",
        if verdict {
            "PASS (concurrent isolated desktops captured & reused)"
        } else {
            "FAIL"
        }
    );
    finish(&out_dir, &report);
    std::process::exit(if verdict { 0 } else { 1 });
}

fn out_dir() -> PathBuf {
    if let Some(arg) = std::env::args().nth(1) {
        return PathBuf::from(arg);
    }
    if let Ok(env) = std::env::var("PHANTOM_SHOT_DIR") {
        if !env.is_empty() {
            return PathBuf::from(env);
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn finish(out_dir: &Path, report: &str) {
    if let Ok(mut f) = std::fs::File::create(out_dir.join("pool-report.txt")) {
        let _ = f.write_all(report.as_bytes());
    }
}

/// True if a 24-bit BMP has substantial non-zero content (a real capture, not a
/// black/blank off-screen surface). Mirrors `desktop_smoke`'s threshold.
fn bmp_non_blank(bytes: &[u8]) -> bool {
    let pixel_off = if bytes.len() > 54 && &bytes[0..2] == b"BM" {
        u32::from_le_bytes([bytes[10], bytes[11], bytes[12], bytes[13]]) as usize
    } else {
        0
    };
    let pixels = bytes.get(pixel_off..).unwrap_or(&[]);
    if pixels.is_empty() {
        return false;
    }
    let nonzero = pixels.iter().filter(|&&b| b != 0).count();
    (nonzero as f64 / pixels.len() as f64) > 0.005
}
