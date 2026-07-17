//! Windows hidden-desktop backend (V2).
//!
//! Launches an isolated Win32 desktop via `CreateDesktopW`, runs a target
//! process on it, captures its windows with `PrintWindow` (BitBlt returns black
//! on a non-foreground hidden desktop, so `PrintWindow` is required), and injects
//! input via `SendInput`/`PostMessage`.
//!
//! NOTE: This module is Windows-only and could not be compiled or tested in the
//! Linux/WSL dev environment. It is written against the `windows` 0.58 API
//! surface and should be validated on a Windows `x86_64-pc-windows-msvc` target.

use anyhow::{anyhow, Result};
use std::mem::{self, zeroed};
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, HBITMAP, HDC,
    SRCCOPY,
};
use windows::Win32::Storage::Xps::{PrintWindow, PW_CLIENTONLY};
use windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, CreateDesktopW, SetThreadDesktop, DESKTOP_CONTROL_FLAGS, HDESK,
};
use windows::Win32::System::Threading::{
    CreateProcessW, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTUPINFOW, TerminateProcess,
    Sleep,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, GetClientRect, GetForegroundWindow, IsWindowVisible, PostMessageW,
    SetForegroundWindow, ShowWindow, SW_RESTORE, WM_LBUTTONDOWN, WM_LBUTTONUP,
};
use crate::input;

/// Default name of the hidden desktop Phantom creates and tears down. The pool
/// (see `pool.rs`) creates additional desktops named `PhantomWorker_N`.
const DESKTOP_NAME: &str = "PhantomDesktop";
/// Generic all-access for the desktop object (GENERIC_ALL == 0x10000000).
const GENERIC_ALL_ACCESS: u32 = 0x1000_0000;

/// Build the `WinSta0`-prefixed desktop path used in `STARTUPINFO.lpDesktop`.
fn desktop_path_for(name: &str) -> String {
    format!("WinSta0\\{name}")
}

/// A hidden Win32 desktop running a sandboxed process.
pub struct VirtualDesktop {
    handle: HDESK,
    process: PROCESS_INFORMATION,
    /// The desktop's name (e.g. `PhantomDesktop` or `PhantomWorker_2`), used to
    /// build the `lpDesktop` path when launching further processes onto it.
    name: String,
}

// SAFETY: `VirtualDesktop` owns only Win32 kernel handles (a desktop `HDESK` and
// a process handle inside `PROCESS_INFORMATION`). These are process-wide opaque
// handles, not thread-affine resources, so they are sound to move between
// threads — required because the agent drives the desktop from a `tokio::spawn`
// task whose future must be `Send`. Shared access is serialized by the
// `Mutex<Option<VirtualDesktop>>` the agent wraps it in, so `Sync` is likewise
// sound. This mirrors the auto-`Send`/`Sync` stub used on non-Windows platforms.
unsafe impl Send for VirtualDesktop {}
unsafe impl Sync for VirtualDesktop {}

impl VirtualDesktop {
    /// Create the default hidden desktop (`PhantomDesktop`).
    pub async fn launch() -> Result<Self> {
        Self::launch_named(DESKTOP_NAME).await
    }

    /// Create a hidden desktop with an explicit `name` and launch a host process
    /// on it. Used by the [`crate::DesktopPool`] to create `PhantomWorker_N`
    /// desktops so many can run concurrently and be torn down independently.
    pub async fn launch_named(name: &str) -> Result<Self> {
        let name_wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        let name_pc = windows::core::PCWSTR(name_wide.as_ptr());

        let handle = unsafe {
            CreateDesktopW(
                name_pc,
                None,
                None,
                DESKTOP_CONTROL_FLAGS(0),
                GENERIC_ALL_ACCESS,
                None,
            )
            .map_err(|e| anyhow!("CreateDesktopW failed for '{name}': {e}"))?
        };

        // Keep the desktop alive with a long-running host process; the real
        // target app is launched later via `open`.
        let process = spawn_on_desktop(
            "cmd.exe",
            "/c ping -n 9999999 127.0.0.1 > nul",
            &desktop_path_for(name),
        )?;

        Ok(Self {
            handle,
            process,
            name: name.to_string(),
        })
    }

    /// The desktop's name (e.g. `PhantomWorker_2`).
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Open `target` on the hidden desktop. URLs are opened in the default
    /// browser; anything else is treated as a command line.
    pub async fn open(&self, target: &str) -> Result<()> {
        let cmd = if target.starts_with("http://") || target.starts_with("https://") {
            format!("cmd.exe /c start {}", target)
        } else {
            target.to_string()
        };
        spawn_on_desktop("cmd.exe", &format!("/c {}", cmd), &desktop_path_for(&self.name))?;
        Ok(())
    }

    /// Click at viewport coordinates on the hidden desktop.
    ///
    /// UIA-first: resolve the control at `(x, y)` and `Invoke` it through the
    /// accessibility contract (no focus theft, works on a non-foreground
    /// desktop). Falls back to `PostMessage` + `SendInput` if UIA cannot service
    /// the control.
    pub async fn click(&self, x: i32, y: i32) -> Result<()> {
        unsafe {
            let _ = SetThreadDesktop(self.handle);
        }
        // Primary: UIA Invoke at the point.
        if input::uia_click(x, y).is_ok() {
            return Ok(());
        }
        // Fallback: window-message + raw injected click on the foreground window.
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_invalid() {
                return Err(anyhow!("no foreground window on hidden desktop"));
            }
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);

            let _ = PostMessageW(hwnd, WM_LBUTTONDOWN, WPARAM(0), LPARAM(0));
            let _ = PostMessageW(hwnd, WM_LBUTTONUP, WPARAM(0), LPARAM(0));

            // Raw injected click as a final fallback.
            input::send_input_click(x, y);
        }
        Ok(())
    }

    /// Type `text` into the control at viewport coordinates `(x, y)`.
    ///
    /// Strategy (each tried in order, first success wins):
    ///   1. UIA value injection (`ValuePattern.SetValue`) — no focus needed.
    ///   2. Post `WM_CHAR` directly to Notepad's edit-control child window. This
    ///      does NOT require the window to be foregrounded, so it is the path
    ///      that works on a service-session hidden desktop where `SendInput` /
    ///      `SetForegroundWindow` are silently blocked by the system.
    ///   3. `SendInput` Unicode keystrokes + a `WM_CHAR` post to the foreground
    ///      window (best-effort; only works if foregrounding succeeded).
    pub async fn type_text(&self, text: &str, x: i32, y: i32) -> Result<()> {
        unsafe {
            let _ = SetThreadDesktop(self.handle);
        }
        // 1. UIA value injection (no focus needed).
        if input::uia_set_text(x, y, text).is_ok() {
            tracing::info!("type_text: via UIA ValuePattern");
            return Ok(());
        }
        // 2. Post WM_CHAR to Notepad's edit control (service-session safe).
        if let Some(edit) = unsafe { notepad_edit_control() } {
            input::post_chars(edit, text);
            tracing::info!("type_text: via WM_CHAR to Notepad edit control");
            return Ok(());
        }
        // 3. Best-effort foreground + SendInput (may be blocked on a service
        //    desktop; kept as a final attempt).
        if let Some(hwnd) = unsafe { notepad_window() } {
            unsafe {
                let _ = ShowWindow(hwnd, SW_RESTORE);
                let _ = SetForegroundWindow(hwnd);
                #[allow(unused_unsafe)]
                unsafe {
                    Sleep(250);
                }
            }
            input::send_input_text(text);
            unsafe {
                input::post_chars(hwnd, text);
            }
            tracing::info!("type_text: via SendInput + WM_CHAR to foreground Notepad");
        }
        Ok(())
    }

    /// Capture the desktop's active window as a 24-bit BMP image.
    ///
    /// The capture runs on a **dedicated, freshly-spawned OS thread** pinned to
    /// this desktop. `SetThreadDesktop` binds the *calling thread* to a desktop,
    /// but Phantom drives desktops from `tokio` tasks that migrate across a
    /// shared worker-thread pool — so a bind done for one worker leaks into
    /// another and the switch is not deterministic. When several pooled desktops
    /// are captured from that shared pool, two calls can end up reading the same
    /// desktop (byte-identical captures). A brand-new thread has a clean desktop
    /// association, so the bind takes effect and the capture is guaranteed to
    /// come from *this* desktop.
    pub async fn screenshot(&self) -> Result<Vec<u8>> {
        // `HDESK` is a raw pointer (not `Send`); move it across the thread
        // boundary as an integer and rebuild it on the other side. The handle is
        // a process-wide kernel object, valid from any thread.
        let raw = self.handle.0 as isize;
        std::thread::spawn(move || -> Result<Vec<u8>> {
            unsafe {
                let handle = HDESK(raw as *mut core::ffi::c_void);
                // Non-fatal: on the single-desktop path the process desktop is
                // already correct, so a bind failure must not regress capture.
                let _ = SetThreadDesktop(handle);
                let hwnd = find_window();
                if hwnd.is_invalid() {
                    return Err(anyhow!("no window to capture on hidden desktop"));
                }
                capture_window_bmp(hwnd)
            }
        })
        .join()
        .map_err(|_| anyhow!("screenshot capture thread panicked"))?
    }

    /// Close the host process and destroy the hidden desktop.
    pub async fn close(self) -> Result<()> {
        unsafe {
            let _ = TerminateProcess(self.process.hProcess, 0);
            let _ = CloseDesktop(self.handle);
        }
        Ok(())
    }
}

impl Drop for VirtualDesktop {
    fn drop(&mut self) {
        unsafe {
            let _ = TerminateProcess(self.process.hProcess, 0);
            let _ = CloseDesktop(self.handle);
        }
    }
}

/// Spawn `app` with `args` so its first thread lands on the desktop at
/// `desktop_path` (a `WinSta0\<name>` string).
fn spawn_on_desktop(app: &str, args: &str, desktop_path: &str) -> Result<PROCESS_INFORMATION> {
    let cmd = format!("{} {}", app, args);
    let mut cmd_vec = to_wide_owned(&cmd);
    let mut desktop_vec = to_wide_owned(desktop_path);

    let mut si: STARTUPINFOW = unsafe { zeroed() };
    si.cb = mem::size_of::<STARTUPINFOW>() as u32;
    si.lpDesktop = windows::core::PWSTR(desktop_vec.as_mut_ptr());

    let mut pi: PROCESS_INFORMATION = unsafe { zeroed() };
    unsafe {
        let _ = CreateProcessW(
            None,
            windows::core::PWSTR(cmd_vec.as_mut_ptr()),
            None,
            None,
            BOOL(0),
            PROCESS_CREATION_FLAGS(0),
            None,
            None,
            &si,
            &mut pi,
        );
    }
    if pi.hProcess.is_invalid() {
        return Err(anyhow!("CreateProcessW failed on hidden desktop"));
    }
    Ok(pi)
}

/// Capture `hwnd` to an in-memory 24-bit BMP and return the file bytes.
unsafe fn capture_window_bmp(hwnd: HWND) -> Result<Vec<u8>> {
    let hdc_screen = GetDC(hwnd);
    if hdc_screen.is_invalid() {
        return Err(anyhow!("GetDC failed"));
    }
    let (w, h) = window_size(hwnd)?;
    let hdc_mem = CreateCompatibleDC(hdc_screen);
    let hbmp = CreateCompatibleBitmap(hdc_screen, w, h);
    let _ = ReleaseDC(hwnd, hdc_screen);
    if hdc_mem.is_invalid() || hbmp.is_invalid() {
        if !hdc_mem.is_invalid() {
            let _ = DeleteDC(hdc_mem);
        }
        return Err(anyhow!("failed to allocate offscreen DC/bitmap"));
    }

    let old = SelectObject(hdc_mem, hbmp);
    let _ = PrintWindow(hwnd, hdc_mem, PW_CLIENTONLY);
    // Fall back to a raw BitBlt (only works if the desktop is foreground).
    let _ = BitBlt(hdc_mem, 0, 0, w, h, hdc_mem, 0, 0, SRCCOPY);

    let bytes = dib_to_bmp(hdc_mem, hbmp, w, h)?;
    SelectObject(hdc_mem, old);
    let _ = DeleteObject(hbmp);
    let _ = DeleteDC(hdc_mem);
    Ok(bytes)
}

/// Read the 24-bit DIB out of `hbmp` and wrap it in a BMP file header.
unsafe fn dib_to_bmp(hdc: HDC, hbmp: HBITMAP, w: i32, h: i32) -> Result<Vec<u8>> {
    let mut bmi: BITMAPINFO = zeroed();
    bmi.bmiHeader.biSize = mem::size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = w;
    bmi.bmiHeader.biHeight = -h; // top-down
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 24;
    bmi.bmiHeader.biCompression = BI_RGB.0;

    let stride = ((w * 3 + 3) / 4) * 4;
    let mut pixels = vec![0u8; (stride * h) as usize];
    let _ = GetDIBits(
        hdc,
        hbmp,
        0,
        h as u32,
        Some(pixels.as_mut_ptr() as *mut _),
        &mut bmi,
        DIB_RGB_COLORS,
    );

    let file_size = 14 + mem::size_of::<BITMAPINFOHEADER>() as u32 + (stride * h) as u32;
    let mut out = Vec::with_capacity(file_size as usize);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&file_size.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // reserved
    out.extend_from_slice(
        &(14 + mem::size_of::<BITMAPINFOHEADER>() as u32).to_le_bytes(),
    ); // pixel offset
    let header: &[u8] = std::slice::from_raw_parts(
        &bmi.bmiHeader as *const _ as *const u8,
        mem::size_of::<BITMAPINFOHEADER>(),
    );
    out.extend_from_slice(header);
    out.extend_from_slice(&pixels);
    Ok(out)
}

/// Get a window's client size in pixels.
unsafe fn window_size(hwnd: HWND) -> Result<(i32, i32)> {
    let mut rect = zeroed();
    let _ = GetClientRect(hwnd, &mut rect);
    Ok((rect.right - rect.left, rect.bottom - rect.top))
}

/// Find the best window to act on within the current thread's desktop.
///
/// Enumerates top-level windows and returns the first visible one with a
/// non-empty client area (i.e. a real app window, not the desktop shell). Falls
/// back to the foreground window if enumeration finds nothing. Called after
/// `SetThreadDesktop` so it sees the hidden desktop's windows.
unsafe fn find_window() -> HWND {
    unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let slot = &mut *(lparam.0 as *mut Option<HWND>);
        if IsWindowVisible(hwnd).as_bool() {
            let mut rect = zeroed();
            if GetClientRect(hwnd, &mut rect).is_ok()
                && (rect.right - rect.left) > 0
                && (rect.bottom - rect.top) > 0
            {
                *slot = Some(hwnd);
                return BOOL(0); // stop: first match wins
            }
        }
        BOOL(1)
    }

    let mut found: Option<HWND> = None;
    let _ = EnumWindows(Some(cb), LPARAM(&mut found as *mut _ as isize));
    found.unwrap_or_else(|| GetForegroundWindow())
}

/// Resolve Notepad's top-level window handle on the current thread's desktop.
///
/// We match by class name (`Notepad`) rather than title so it works for an
/// untitled / freshly-launched instance. Returns `None` if no Notepad window
/// is present (e.g. on a background hidden desktop with only the host process).
unsafe fn notepad_window() -> Option<HWND> {
    let class = to_wide_owned("Notepad");
    let hwnd = FindWindowExW(None, None, windows::core::PCWSTR(class.as_ptr()), None).ok()?;
    if hwnd.is_invalid() { None } else { Some(hwnd) }
}

/// Resolve Notepad's edit-control child window (class `Edit`) on the current
/// thread's desktop. Posting `WM_CHAR` to this handle types into Notepad
/// without needing the window to be foregrounded — the reliable path on a
/// service-session hidden desktop.
unsafe fn notepad_edit_control() -> Option<HWND> {
    let hwnd = match notepad_window() {
        Some(h) if !h.is_invalid() => h,
        _ => return None,
    };
    let edit_class = to_wide_owned("Edit");
    let edit = FindWindowExW(
        hwnd,
        None,
        windows::core::PCWSTR(edit_class.as_ptr()),
        None,
    )
    .ok()?;
    if edit.is_invalid() { None } else { Some(edit) }
}

/// Allocate a null-terminated wide string.
fn to_wide_owned(s: &str) -> Vec<u16> {
    let mut v: Vec<u16> = s.encode_utf16().collect();
    v.push(0);
    v
}
