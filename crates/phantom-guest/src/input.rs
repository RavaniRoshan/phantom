//! In-guest input: SendInput in the interactive session, never WM_* messages.

use anyhow::{bail, Result};

/// Map a screenshot-pixel coordinate to screen coordinates. The guest reports
/// its image size so the host never guesses scaling (ADR-005).
pub fn map_coordinate(x: f64, img_width: u32, screen_width: u32) -> Result<i32> {
    if img_width == 0 {
        bail!("image width must be positive");
    }
    let scaled = x * (screen_width as f64 / img_width as f64);
    Ok(scaled.round() as i32)
}

#[cfg(windows)]
pub fn click(x: i32, y: i32) -> Result<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_LEFTDOWN,
        MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MOVE, MOUSEINPUT,
    };
    unsafe {
        let inputs = [
            INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        dx: x,
                        dy: y,
                        mouseData: 0,
                        dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        dx: 0,
                        dy: 0,
                        mouseData: 0,
                        dwFlags: MOUSEEVENTF_LEFTDOWN,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        dx: 0,
                        dy: 0,
                        mouseData: 0,
                        dwFlags: MOUSEEVENTF_LEFTUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
        ];
        let sent = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        if sent != inputs.len() as u32 {
            // UIPI failures are NOT reported by SendInput; check key state where
            // relevant. A short count is the only signal we get.
            bail!("SendInput sent {sent}/{} events (UIPI or focus boundary)", inputs.len());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn click(_x: i32, _y: i32) -> Result<()> {
    bail!("in-guest input requires Windows")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coordinate_mapping_uses_image_space() {
        assert_eq!(map_coordinate(100.0, 1000, 2000).unwrap(), 200);
        assert!(map_coordinate(1.0, 0, 100).is_err());
    }
}
