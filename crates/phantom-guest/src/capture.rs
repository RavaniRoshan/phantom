//! In-guest console-session capture: GDI BitBlt → PNG at source (ADR-001/010).
//!
//! Windows.Graphics.Capture is the preferred path where available; this module
//! provides the dependable GDI fallback and the integrity check that killed the
//! hidden-desktop approach: an all-black frame is a typed error, never success.

use anyhow::{bail, Result};
use image::{ImageBuffer, Rgb};

/// Reject a frame whose every byte is zero — the exact failure mode of the
/// hidden desktop. A real desktop may be dark, but never perfectly all-zero.
pub fn reject_all_black(rgb: &[u8]) -> Result<()> {
    if !rgb.is_empty() && rgb.iter().all(|b| *b == 0) {
        bail!("capture is all-black: guest session may be disconnected or non-interactive");
    }
    Ok(())
}

pub fn encode_png(rgb: &[u8], width: u32, height: u32) -> Result<Vec<u8>> {
    if rgb.len() != (width as usize) * (height as usize) * 3 {
        bail!("RGB buffer size does not match dimensions");
    }
    reject_all_black(rgb)?;
    let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width, height, rgb.to_vec()).expect("checked size");
    let mut cursor = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img).write_to(&mut cursor, image::ImageFormat::Png)?;
    Ok(cursor.into_inner())
}

#[cfg(windows)]
pub fn capture_console() -> Result<(Vec<u8>, u32, u32)> {
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
        GetDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, HBITMAP, HDC, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

    unsafe {
        let width = GetSystemMetrics(SM_CXSCREEN);
        let height = GetSystemMetrics(SM_CYSCREEN);
        if width <= 0 || height <= 0 {
            bail!("invalid screen dimensions {width}x{height}");
        }
        let w = width as u32;
        let h = height as u32;
        let screen = GetDC(windows::Win32::Foundation::HWND(std::ptr::null_mut()));
        if screen.is_invalid() {
            bail!("GetDC returned an invalid handle");
        }
        let mem = CreateCompatibleDC(screen);
        let bmp = CreateCompatibleBitmap(screen, width, height);
        let old = SelectObject(mem, bmp);
        let ok = BitBlt(mem, 0, 0, width, height, screen, 0, 0, SRCCOPY);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height, // top-down rows
                biPlanes: 1,
                biBitCount: 24,
                biCompression: BI_RGB.0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [Default::default()],
        };
        let stride = ((w * 3 + 3) / 4) * 4;
        let mut buf = vec![0u8; (stride * h) as usize];
        let got = GetDIBits(
            mem,
            HBITMAP(bmp.0),
            0,
            h,
            Some(buf.as_mut_ptr() as *mut _),
            &mut info,
            DIB_RGB_COLORS,
        );
        SelectObject(mem, old);
        DeleteObject(bmp);
        DeleteDC(mem);
        ReleaseDC(windows::Win32::Foundation::HWND(std::ptr::null_mut()), screen);
        if ok.is_err() || got == 0 {
            bail!("BitBlt/GetDIBits failed");
        }
        // GDI stores BGR; convert to RGB and drop row padding.
        let mut rgb = Vec::with_capacity((w * h * 3) as usize);
        for y in 0..h as usize {
            let row = &buf[y * stride as usize..];
            for x in 0..w as usize {
                let i = x * 3;
                rgb.push(row[i + 2]);
                rgb.push(row[i + 1]);
                rgb.push(row[i]);
            }
        }
        Ok((rgb, w, h))
    }
}

#[cfg(not(windows))]
pub fn capture_console() -> Result<(Vec<u8>, u32, u32)> {
    bail!("in-guest capture requires Windows")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_black_is_rejected() {
        assert!(reject_all_black(&[0, 0, 0]).is_err());
        assert!(reject_all_black(&[0, 0, 1]).is_ok());
    }

    #[test]
    fn png_contract() {
        let rgb = vec![10u8, 20, 30, 40, 50, 60];
        let png = encode_png(&rgb, 2, 1).unwrap();
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        let decoded = image::load_from_memory_with_format(&png, image::ImageFormat::Png).unwrap();
        assert_eq!(decoded.width(), 2);
        assert_eq!(decoded.height(), 1);
    }
}
