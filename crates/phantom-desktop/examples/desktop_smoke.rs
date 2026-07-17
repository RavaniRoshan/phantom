//! Invisible-desktop runtime smoke harness.
//!
//! This is the FIRST real *runtime* exercise of the V2 hidden-desktop backend —
//! every prior gate was a compile-check only. It drives the public
//! `VirtualDesktop` API exactly as the agent does:
//!
//!   launch() → open("notepad.exe") → screenshot() → type_text() → screenshot()
//!
//! It writes both screenshots (24-bit BMP) plus a `report.txt` into an output
//! directory (arg 1, or `$PHANTOM_SHOT_DIR`, or the current dir) so CI can upload
//! them as artifacts for visual inspection.
//!
//! Exit codes:
//!   0  — the invisible-desktop *mechanics* worked (desktop created, a real
//!        window was launched onto it, and a non-blank screenshot was captured).
//!        UIA text entry is reported but treated as best-effort (a control may
//!        expose no Value pattern, or a service-session desktop may restrict it).
//!   1  — a core mechanic failed on Windows.
//!   0  — on non-Windows the backend is a stub; we print and skip (so the shared
//!        `cargo build --examples` gate stays green everywhere).

use std::io::Write as _;
use std::path::PathBuf;
use std::time::Duration;

use phantom_desktop::VirtualDesktop;

const TYPE_TEXT: &str = "hello phantom from CI";
// Where we try to drop the caret / find the edit control inside Notepad's client
// area. Coordinates are best-effort — see the UIA note above.
const TYPE_X: i32 = 240;
const TYPE_Y: i32 = 200;

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

    log!("== Phantom invisible-desktop runtime smoke ==");
    log!("output dir : {}", out_dir.display());
    log!("platform   : windows={}", cfg!(windows));

    // 1. Create the hidden desktop + host process.
    let desktop = match VirtualDesktop::launch().await {
        Ok(d) => {
            log!("[ok]   VirtualDesktop::launch()");
            d
        }
        Err(e) => {
            log!("[fail] VirtualDesktop::launch(): {e}");
            finish(&out_dir, &report);
            // On non-Windows the stub is *expected* to bail — not a failure.
            std::process::exit(if cfg!(windows) { 1 } else { 0 });
        }
    };

    // 2. Launch a real GUI app (classic Notepad) onto the hidden desktop.
    match desktop.open("notepad.exe").await {
        Ok(()) => log!("[ok]   open(\"notepad.exe\")"),
        Err(e) => log!("[warn] open(\"notepad.exe\"): {e}"),
    }
    // Give Notepad time to create its window on the hidden desktop.
    tokio::time::sleep(Duration::from_secs(4)).await;

    // 3. Capture BEFORE typing.
    let mut ok_capture = false;
    let mut before_bytes: Option<Vec<u8>> = None;
    match desktop.screenshot().await {
        Ok(bytes) => {
            let stats = bmp_stats(&bytes);
            ok_capture = stats.non_blank;
            before_bytes = Some(bytes.clone());
            let p = out_dir.join("01-before.bmp");
            let _ = std::fs::write(&p, &bytes);
            log!(
                "[ok]   screenshot #1: {} bytes, {} -> {}",
                bytes.len(),
                stats.describe(),
                p.display()
            );
        }
        Err(e) => log!("[fail] screenshot #1: {e}"),
    }

    // 4. UIA-first text entry (best-effort).
    match desktop.type_text(TYPE_TEXT, TYPE_X, TYPE_Y).await {
        Ok(()) => log!("[ok]   type_text({TYPE_TEXT:?}) at ({TYPE_X},{TYPE_Y})"),
        Err(e) => log!("[warn] type_text: {e}"),
    }
    tokio::time::sleep(Duration::from_secs(1)).await;

    // 5. Capture AFTER typing (visual proof of any text that landed).
    let mut after_bytes: Option<Vec<u8>> = None;
    match desktop.screenshot().await {
        Ok(bytes) => {
            let stats = bmp_stats(&bytes);
            ok_capture |= stats.non_blank;
            after_bytes = Some(bytes.clone());
            let p = out_dir.join("02-after.bmp");
            let _ = std::fs::write(&p, &bytes);
            log!(
                "[ok]   screenshot #2: {} bytes, {} -> {}",
                bytes.len(),
                stats.describe(),
                p.display()
            );
        }
        Err(e) => log!("[fail] screenshot #2: {e}"),
    }

    // 6. Pixel-diff before vs after. If UIA text landed in Notepad, the editor
    //    area changed; this is the concrete proof `type_text` did something
    //    (not just that the call returned Ok).
    if let (Some(before), Some(after)) = (&before_bytes, &after_bytes) {
        let diff = bmp_diff(before, after);
        log!(
            "[info] pixels changed by typing: {} ({:.4}% of image)",
            diff.changed,
            diff.ratio * 100.0
        );
        if diff.ratio > 0.0005 {
            log!("[ok]   UIA text entry produced a visible change in the window");
        } else {
            log!("[warn] no visible change from typing (control may have had no Value pattern / service-session restriction)");
        }
    }

    // 6. Tear down.
    match desktop.close().await {
        Ok(()) => log!("[ok]   close()"),
        Err(e) => log!("[warn] close(): {e}"),
    }

    let verdict = ok_capture;
    log!(
        "== verdict: {} ==",
        if verdict { "PASS (hidden desktop captured a real window)" } else { "FAIL (no non-blank capture)" }
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

fn finish(out_dir: &PathBuf, report: &str) {
    if let Ok(mut f) = std::fs::File::create(out_dir.join("report.txt")) {
        let _ = f.write_all(report.as_bytes());
    }
}

struct BmpStats {
    non_blank: bool,
    nonzero_ratio: f64,
    total: usize,
}

impl BmpStats {
    fn describe(&self) -> String {
        format!(
            "{:.1}% non-zero pixels ({} bytes){}",
            self.nonzero_ratio * 100.0,
            self.total,
            if self.non_blank { "" } else { " [BLANK]" }
        )
    }
}

/// Count pixels that differ between two same-sized 24-bit BMPs. Returns the
/// absolute count of differing bytes and the ratio over the pixel region.
struct BmpDiff {
    changed: usize,
    ratio: f64,
}

fn bmp_diff(a: &[u8], b: &[u8]) -> BmpDiff {
    let pa = a.get(pixel_offset(a)..).unwrap_or(&[]);
    let pb = b.get(pixel_offset(b)..).unwrap_or(&[]);
    let n = pa.len().min(pb.len());
    let changed = (0..n).filter(|&i| pa[i] != pb[i]).count();
    let ratio = if n == 0 { 0.0 } else { changed as f64 / n as f64 };
    BmpDiff { changed, ratio }
}

fn pixel_offset(bytes: &[u8]) -> usize {
    if bytes.len() > 54 && &bytes[0..2] == b"BM" {
        u32::from_le_bytes([bytes[10], bytes[11], bytes[12], bytes[13]]) as usize
    } else {
        0
    }
}

/// Compute how much of a 24-bit BMP is non-black. A hidden-desktop capture that
/// failed (e.g. BitBlt on an off-screen desktop) comes back all-zero; a real
/// `PrintWindow` capture of a window has substantial non-zero content.
fn bmp_stats(bytes: &[u8]) -> BmpStats {
    // Skip the 14-byte file header + 40-byte BITMAPINFOHEADER when present.
    let pixel_off = if bytes.len() > 54 && &bytes[0..2] == b"BM" {
        u32::from_le_bytes([bytes[10], bytes[11], bytes[12], bytes[13]]) as usize
    } else {
        0
    };
    let pixels = bytes.get(pixel_off..).unwrap_or(&[]);
    let total = pixels.len();
    let nonzero = pixels.iter().filter(|&&b| b != 0).count();
    let ratio = if total == 0 { 0.0 } else { nonzero as f64 / total as f64 };
    BmpStats {
        // >0.5% non-zero bytes means we captured real window content, not a
        // black/blank surface.
        non_blank: ratio > 0.005,
        nonzero_ratio: ratio,
        total,
    }
}
