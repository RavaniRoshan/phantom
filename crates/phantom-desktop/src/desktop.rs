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
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, HBITMAP, HDC,
    SRCCOPY,
};
use windows::Win32::System::Desktop::{
    CloseDesktop, CreateDesktopW, SetThreadDesktop, CREATE_DESKTOP_FLAGS, HDESK,
};
use windows::Win32::System::Threading::{
    CloseHandle, CreateProcessW, PROCESS_INFORMATION, STARTUPINFOW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClientRect, GetForegroundWindow, PostMessageW, PrintWindow, SendInput, SetForegroundWindow,
    ShowWindow, HWND, INPUT, INPUT_MOUSE, LPARAM, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    PW_CLIENTONLY, SW_RESTORE, WM_LBUTTONDOWN, WM_LBUTTONUP, WPARAM,
};

/// Name of the hidden desktop Phantom creates and tears down.
const DESKTOP_NAME: &str = "PhantomDesktop";
/// Full WinSta0-prefixed name used in `STARTUPINFO.lpDesktop`.
const DESKTOP_PATH: &str = "WinSta0\\PhantomDesktop";

/// A hidden Win32 desktop running a sandboxed process.
pub struct VirtualDesktop {
    handle: HDESK,
    process: PROCESS_INFORMATION,
}

impl VirtualDesktop {
    /// Create the hidden desktop and launch a host process on it.
    pub async fn launch() -> Result<Self> {
        let name = windows::core::HSTRING::from(DESKTOP_NAME);
        let handle = unsafe {
            CreateDesktopW(
                name.as_pcwstr(),
                None,
                None,
                CREATE_DESKTOP_FLAGS(0),
                windows::Win32::Security::GENERIC_ALL,
                None,
            )
        };
        if handle.is_invalid() {
            return Err(anyhow!("CreateDesktopW failed"));
        }

        // Keep the desktop alive with a long-running host process; the real
        // target app is launched later via `open`.
        let process = spawn_on_desktop(
            "cmd.exe",
            "/c ping -n 9999999 127.0.0.1 > nul",
        )?;

        Ok(Self { handle, process })
    }

    /// Open `target` on the hidden desktop. URLs are opened in the default
    /// browser; anything else is treated as a command line.
    pub async fn open(&self, target: &str) -> Result<()> {
        let cmd = if target.starts_with("http://") || target.starts_with("https://") {
            format!("cmd.exe /c start {}", target)
        } else {
            target.to_string()
        };
        spawn_on_desktop("cmd.exe", &format!("/c {}", cmd))?;
        Ok(())
    }

    /// Click at viewport coordinates on the desktop's foreground window.
    pub async fn click(&self, x: i32, y: i32) -> Result<()> {
        unsafe {
            // Attach this thread to the hidden desktop so input lands there.
            SetThreadDesktop(self.handle);
            let hwnd = GetForegroundWindow();
            if hwnd.is_invalid() {
                return Err(anyhow!("no foreground window on hidden desktop"));
            }
            ShowWindow(hwnd, SW_RESTORE);
            SetForegroundWindow(hwnd);

            // Window-message click, then a global injected click as a fallback.
            let _ = PostMessageW(hwnd, WM_LBUTTONDOWN, WPARAM(0), LPARAM(0));
            let _ = PostMessageW(hwnd, WM_LBUTTONUP, WPARAM(0), LPARAM(0));

            let mut down = mouse_input(MOUSEEVENTF_LEFTDOWN, x, y);
            let mut up = mouse_input(MOUSEEVENTF_LEFTUP, x, y);
            SendInput(&[down], mem::size_of::<INPUT>() as i32);
            SendInput(&[up], mem::size_of::<INPUT>() as i32);
        }
        Ok(())
    }

    /// Capture the desktop's foreground window as a 24-bit BMP image.
    pub async fn screenshot(&self) -> Result<Vec<u8>> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_invalid() {
                return Err(anyhow!("no window to capture on hidden desktop"));
            }
            capture_window_bmp(hwnd)
        }
    }

    /// Close the host process and destroy the hidden desktop.
    pub async fn close(self) -> Result<()> {
        unsafe {
            let _ = windows::Win32::System::Threading::TerminateProcess(self.process.hProcess, 0);
            let _ = CloseHandle(self.process.hThread);
            let _ = CloseHandle(self.process.hProcess);
            CloseDesktop(self.handle);
        }
        Ok(())
    }
}

impl Drop for VirtualDesktop {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::System::Threading::TerminateProcess(self.process.hProcess, 0);
            let _ = CloseHandle(self.process.hThread);
            let _ = CloseHandle(self.process.hProcess);
            CloseDesktop(self.handle);
        }
    }
}

/// Spawn `app` with `args` so its first thread lands on the hidden desktop.
fn spawn_on_desktop(app: &str, args: &str) -> Result<PROCESS_INFORMATION> {
    let cmd = format!("{} {}", app, args);
    let mut cmd_vec = to_wide_owned(&cmd);
    let mut desktop_vec = to_wide_owned(DESKTOP_PATH);

    let mut si: STARTUPINFOW = unsafe { zeroed() };
    si.cb = mem::size_of::<STARTUPINFOW>() as u32;
    si.lpDesktop = windows::core::PWSTR(desktop_vec.as_mut_ptr());

    let mut pi: PROCESS_INFORMATION = unsafe { zeroed() };
    let ok = unsafe {
        CreateProcessW(
            None,
            Some(windows::core::PWSTR(cmd_vec.as_mut_ptr())),
            None,
            None,
            false,
            0,
            None,
            None,
            &si,
            &mut pi,
        )
    };
    if !ok.as_bool() {
        return Err(anyhow!("CreateProcessW failed on hidden desktop"));
    }
    Ok(pi)
}

/// Build a `MOUSEINPUT` wrapped in `INPUT` for `SendInput`.
unsafe fn mouse_input(flags: u32, x: i32, y: i32) -> INPUT {
    let mut input: INPUT = zeroed();
    input.r#type = INPUT_MOUSE;
    input.Anonymous.mi.dx = x;
    input.Anonymous.mi.dy = y;
    input.Anonymous.mi.dwFlags = flags;
    input.Anonymous.mi.mouseData = 0;
    input.Anonymous.mi.dwExtraInfo = 0;
    input.Anonymous.mi.time = 0;
    input
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
    ReleaseDC(hwnd, hdc_screen);
    if hdc_mem.is_invalid() || hbmp.is_invalid() {
        if !hdc_mem.is_invalid() {
            DeleteDC(hdc_mem);
        }
        return Err(anyhow!("failed to allocate offscreen DC/bitmap"));
    }

    let old = SelectObject(hdc_mem, hbmp);
    let printed = PrintWindow(hwnd, hdc_mem, PW_CLIENTONLY);
    if !printed.as_bool() {
        // Fall back to a raw BitBlt (only works if the desktop is foreground).
        let _ = BitBlt(hdc_mem, 0, 0, w, h, hdc_mem, 0, 0, SRCCOPY);
    }

    let bytes = dib_to_bmp(hdc_mem, hbmp, w, h)?;
    SelectObject(hdc_mem, old);
    DeleteObject(hbmp);
    DeleteDC(hdc_mem);
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
    bmi.bmiHeader.biCompression = BI_RGB;

    let stride = ((w * 3 + 3) / 4) * 4;
    let mut pixels = vec![0u8; (stride * h) as usize];
    let got = GetDIBits(
        hdc,
        hbmp,
        0,
        h as u32,
        Some(pixels.as_mut_ptr() as *mut _),
        &mut bmi,
        DIB_RGB_COLORS,
    );
    if got == 0 {
        return Err(anyhow!("GetDIBits failed"));
    }

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
    if !GetClientRect(hwnd, &mut rect).as_bool() {
        return Err(anyhow!("GetClientRect failed"));
    }
    Ok((rect.right - rect.left, rect.bottom - rect.top))
}

/// Allocate a null-terminated wide string.
fn to_wide_owned(s: &str) -> Vec<u16> {
    let mut v: Vec<u16> = s.encode_utf16().collect();
    v.push(0);
    v
}
