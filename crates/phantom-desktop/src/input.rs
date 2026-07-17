//! UIA-first input injection for the hidden desktop (Windows only).
//!
//! Phantom prefers **UI Automation (UIA)** for input because it drives controls
//! through their accessibility contracts — invoking a button or setting an
//! edit-control's value — without ever stealing foreground focus or moving the
//! real pointer. That is what keeps the hidden desktop truly invisible and is
//! the only input path that works reliably on a desktop that is never the
//! interactive/foreground one.
//!
//! When UIA cannot service a control (missing pattern, COM not available, etc.)
//! we fall back to raw `SendInput` keystrokes / `PostMessage` window messages.
//! Those are best-effort: on a hidden desktop they may not reach the control,
//! which is exactly why UIA is the primary path.

use anyhow::{anyhow, Result};
use std::mem::zeroed;
use windows::Win32::Foundation::{HWND, POINT, LPARAM, WPARAM};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IInvokeProvider, IValueProvider, UIA_InvokePatternId,
    UIA_ValuePatternId,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
};
use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CHAR};

/// Best-effort COM/STA initialization.
///
/// UIA's `IUIAutomation` client is happiest on an STA thread. tokio worker
/// threads are MTA by default, so `CoInitializeEx` may already be initialized in
/// the wrong mode (it then returns `RPC_E_CHANGED_MODE`). We try STA and ignore
/// the outcome — if UIA genuinely needs STA and we are in MTA, the UIA call will
/// fail and we fall back to `SendInput`.
fn ensure_com() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
}

/// Create the UIA automation root, or `None` if COM/UIA is unavailable.
fn automation() -> Option<IUIAutomation> {
    ensure_com();
    unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok() }
}

/// UIA-first click: resolve the element at `(x, y)` and `Invoke` it.
///
/// `Invoke` is the accessibility equivalent of "activate this control" and works
/// without foregrounding the window. Returns an error if UIA is unavailable or
/// the point has no invokable element, so the caller can fall back.
pub fn uia_click(x: i32, y: i32) -> Result<()> {
    let automation = automation().ok_or_else(|| anyhow!("UIA unavailable"))?;
    let point = POINT { x, y };
    let element = unsafe { automation.ElementFromPoint(point) }
        .map_err(|e| anyhow!("UIA ElementFromPoint failed: {e}"))?;
    let invoker: IInvokeProvider =
        unsafe { element.GetCurrentPatternAs(UIA_InvokePatternId) }
            .map_err(|e| anyhow!("control has no Invoke pattern: {e}"))?;
    unsafe { invoker.Invoke() }.map_err(|e| anyhow!("UIA Invoke failed: {e}"))
}

/// UIA-first text entry: set the value of the control at `(x, y)`.
///
/// This is the canonical way to type into a hidden-desktop edit/combobox
/// control: `ValuePattern.SetValue` writes the string directly through the
/// accessibility contract, so no focus or keystroke injection is required.
/// Returns an error if the control exposes no Value pattern, so the caller can
/// fall back to keystroke injection.
pub fn uia_set_text(x: i32, y: i32, text: &str) -> Result<()> {
    let automation = automation().ok_or_else(|| anyhow!("UIA unavailable"))?;
    let point = POINT { x, y };
    let element = unsafe { automation.ElementFromPoint(point) }
        .map_err(|e| anyhow!("UIA ElementFromPoint failed: {e}"))?;
    let setter: IValueProvider = unsafe { element.GetCurrentPatternAs(UIA_ValuePatternId) }
        .map_err(|e| anyhow!("control has no Value pattern: {e}"))?;
    let value = windows::core::HSTRING::from(text);
    unsafe { setter.SetValue(&value) }.map_err(|e| anyhow!("UIA SetValue failed: {e}"))
}

/// Raw mouse click via `SendInput` (best-effort fallback).
pub fn send_input_click(x: i32, y: i32) {
    unsafe {
        let mut down: INPUT = zeroed();
        down.r#type = INPUT_MOUSE;
        down.Anonymous.mi.dx = x;
        down.Anonymous.mi.dy = y;
        down.Anonymous.mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
        let mut up: INPUT = zeroed();
        up.r#type = INPUT_MOUSE;
        up.Anonymous.mi.dx = x;
        up.Anonymous.mi.dy = y;
        up.Anonymous.mi.dwFlags = MOUSEEVENTF_LEFTUP;
        let _ = SendInput(&[down], std::mem::size_of::<INPUT>() as i32);
        let _ = SendInput(&[up], std::mem::size_of::<INPUT>() as i32);
    }
}

/// Inject `text` as Unicode keystrokes via `SendInput` (best-effort fallback).
///
/// Each UTF-16 code unit is sent as a `KEYEVENTF_UNICODE` down/up pair, which
/// targets whatever window currently has keyboard focus. On a hidden desktop
/// this is unreliable (focus lives on the visible desktop), so prefer
/// [`uia_set_text`] when the control supports it.
pub fn send_input_text(text: &str) {
    let mut events: Vec<INPUT> = Vec::with_capacity(text.len() * 2);
    for ch in text.encode_utf16() {
        events.push(unicode_key(ch, false));
        events.push(unicode_key(ch, true));
    }
    if !events.is_empty() {
        unsafe {
            let _ = SendInput(&events, std::mem::size_of::<INPUT>() as i32);
        }
    }
}

/// Build a single Unicode key event (down or up) for code unit `unit`.
fn unicode_key(unit: u16, up: bool) -> INPUT {
    let mut input: INPUT = unsafe { zeroed() };
    input.r#type = INPUT_KEYBOARD;
    let mut ki: KEYBDINPUT = unsafe { zeroed() };
    ki.wScan = unit;
    ki.dwFlags = if up {
        KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
    } else {
        KEYEVENTF_UNICODE
    };
    input.Anonymous.ki = ki;
    input
}

/// Post `WM_CHAR` for each character to `hwnd` (best-effort message fallback).
pub fn post_chars(hwnd: HWND, text: &str) {
    for ch in text.encode_utf16() {
        unsafe {
            let _ = PostMessageW(hwnd, WM_CHAR, WPARAM(ch as usize), LPARAM(0));
        }
    }
}
