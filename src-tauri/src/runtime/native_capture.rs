//! Native, non-interactive window and display capture.
//!
//! Enumeration and frame capture use fixed argv arrays (never a shell), numeric identifiers are
//! parsed before they reach an external tool, output is size-bounded, and every temporary frame
//! is removed on success, failure, and early return. All work is local to the host running One Ring.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri::async_runtime::JoinHandle;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CapturableWindow {
    pub id: u64,
    pub title: String,
    pub app_name: String,
    pub pid: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_minimized: bool,
    pub backend: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CapturableDisplay {
    pub id: u64,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub scale_factor: f64,
    pub is_primary: bool,
    pub backend: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeCaptureFrame {
    pub source_id: String,
    pub target_kind: String,
    pub target_id: u64,
    pub width: u32,
    pub height: u32,
    pub mime_type: String,
    pub base64_data: String,
    pub timestamp_ms: u64,
    pub backend: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativeCaptureSessionInfo {
    pub source_id: String,
    pub target_kind: String,
    pub target_id: u64,
    pub fps: u32,
    pub active: bool,
    pub backend: String,
}

const MAX_WINDOWS: usize = 512;
const MAX_DISPLAYS: usize = 16;
const MAX_ENUMERATION_BYTES: usize = 1024 * 1024;
const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;
const MAX_SESSIONS: usize = 4;
const MAX_SOURCE_ID_LEN: usize = 128;
const MIN_FPS: u32 = 1;
const MAX_FPS: u32 = 15;
const FRAME_EVENT: &str = "capture://frame";

#[cfg(target_os = "macos")]
const BACKEND: &str = "core-graphics";
#[cfg(target_os = "windows")]
const BACKEND: &str = "win32";
#[cfg(target_os = "linux")]
const BACKEND: &str = "x11";
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
const BACKEND: &str = "native";

/// Fixed program plus owned argument array handed to `Command::args`. No shell is involved.
struct CapturePlan {
    program: String,
    args: Vec<String>,
}

impl CapturePlan {
    fn arg_refs(&self) -> Vec<&str> {
        self.args.iter().map(String::as_str).collect()
    }
}

/// A temporary JPEG that is always removed, including on error paths.
struct TempFrame(PathBuf);

impl TempFrame {
    fn new() -> Result<Self, String> {
        static COUNTER: AtomicU64 = AtomicU64::new(1);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let sequence = COUNTER.fetch_add(1, Ordering::Relaxed);
        let name = format!(
            "one-ring-native-{}-{}-{nanos}.jpg",
            std::process::id(),
            sequence
        );
        Ok(Self(std::env::temp_dir().join(name)))
    }
}

impl Drop for TempFrame {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn validate_source_id(source_id: &str) -> Result<(), String> {
    let trimmed = source_id.trim();
    if trimmed.is_empty() {
        return Err("Capture source id must not be empty".into());
    }
    if trimmed.len() > MAX_SOURCE_ID_LEN || trimmed.chars().any(char::is_control) {
        return Err("Capture source id must be a short printable token".into());
    }
    Ok(())
}

fn validate_target_kind(target_kind: &str) -> Result<&'static str, String> {
    match target_kind.trim().to_ascii_lowercase().as_str() {
        "window" => Ok("window"),
        "display" => Ok("display"),
        _ => Err("Capture target kind must be 'window' or 'display'".into()),
    }
}

fn clamp_fps(fps: u32) -> u32 {
    fps.clamp(MIN_FPS, MAX_FPS)
}

/// Runs a child process with piped stdout, discarding anything past `max_bytes`.
/// Arguments are always an explicit array; no shell string is ever constructed.
fn run_bounded_command(
    program: &str,
    args: &[&str],
    max_bytes: usize,
) -> Result<(Vec<u8>, bool), String> {
    let mut cmd = Command::new(program);
    crate::runtime::hide_console_window(&mut cmd);
    let mut child = cmd
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("{program} is unavailable: {err}"))?;

    let mut output = Vec::new();
    let mut truncated = false;
    if let Some(mut stdout) = child.stdout.take() {
        let mut chunk = [0u8; 8192];
        loop {
            let read = stdout.read(&mut chunk).map_err(|err| err.to_string())?;
            if read == 0 {
                break;
            }
            if output.len().saturating_add(read) > max_bytes {
                let remaining = max_bytes.saturating_sub(output.len());
                output.extend_from_slice(&chunk[..remaining]);
                truncated = true;
                break;
            }
            output.extend_from_slice(&chunk[..read]);
        }
    }
    if truncated {
        let _ = child.kill();
    }
    let status = child.wait().map_err(|err| err.to_string())?;
    Ok((output, !truncated && status.success()))
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Minimal standard base64 encoder so no extra dependency is needed.

/// Encodes top-down BGRA pixels into an uncompressed 32-bit BMP (54-byte header + pixels).
/// Renders natively in WebView2/WKWebView/WebKitGTK via `data:image/bmp;base64,...` with zero
/// external encoder dependencies.
#[allow(dead_code)]
fn encode_bgra_as_bmp(width: u32, height: u32, bgra: &[u8]) -> Result<Vec<u8>, String> {
    let pixel_bytes = (width as usize)
        .checked_mul(height as usize)
        .and_then(|px| px.checked_mul(4))
        .ok_or_else(|| "BMP dimensions overflow".to_string())?;
    if pixel_bytes == 0 || bgra.len() < pixel_bytes {
        return Err("Invalid BGRA buffer for BMP encoding".into());
    }
    let file_size = 54usize
        .checked_add(pixel_bytes)
        .ok_or_else(|| "BMP size overflow".to_string())?;
    if file_size > MAX_FRAME_BYTES {
        return Err("Captured BMP frame exceeds 4 MiB safety limit".into());
    }
    let mut out = Vec::with_capacity(file_size);
    // BITMAPFILEHEADER (14 bytes)
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(file_size as u32).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&54u32.to_le_bytes());
    // BITMAPINFOHEADER (40 bytes), negative height = top-down DIB
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(width as i32).to_le_bytes());
    out.extend_from_slice(&(-(height as i32)).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    out.extend_from_slice(&(pixel_bytes as u32).to_le_bytes());
    out.extend_from_slice(&2835i32.to_le_bytes());
    out.extend_from_slice(&2835i32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&bgra[..pixel_bytes]);
    Ok(out)
}

fn base64_encode(input: &[u8]) -> String {
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let packed = (b0 << 16) | (b1 << 8) | b2;
        out.push(BASE64_ALPHABET[((packed >> 18) & 63) as usize] as char);
        out.push(BASE64_ALPHABET[((packed >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(BASE64_ALPHABET[((packed >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(BASE64_ALPHABET[(packed & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Reads JPEG pixel dimensions from the first SOF marker without decoding the image.
fn jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 4 || data[0] != 0xff || data[1] != 0xd8 {
        return None;
    }
    let mut index = 2;
    while index + 9 < data.len() {
        if data[index] != 0xff {
            index += 1;
            continue;
        }
        while index < data.len() && data[index] == 0xff {
            index += 1;
        }
        if index >= data.len() {
            break;
        }
        let marker = data[index];
        index += 1;
        if marker == 0xd8 || marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        if marker == 0xd9 || marker == 0xda {
            break;
        }
        if index + 2 > data.len() {
            break;
        }
        let segment = u16::from_be_bytes([data[index], data[index + 1]]) as usize;
        if segment < 2 || index + segment > data.len() {
            break;
        }
        let is_frame = (0xc0..=0xcf).contains(&marker) && !matches!(marker, 0xc4 | 0xc8 | 0xcc);
        if is_frame && segment >= 7 {
            let height = u16::from_be_bytes([data[index + 3], data[index + 4]]) as u32;
            let width = u16::from_be_bytes([data[index + 5], data[index + 6]]) as u32;
            if width > 0 && height > 0 {
                return Some((width, height));
            }
        }
        index += segment;
    }
    None
}

/// Parses one `wmctrl -lpG` row: id, desktop, pid, x, y, width, height, machine, title.
#[allow(dead_code)]
fn parse_wmctrl_line(line: &str) -> Option<CapturableWindow> {
    let mut fields = line.split_whitespace();
    let id_field = fields.next()?;
    let _desktop = fields.next()?;
    let pid = fields.next()?.parse::<u32>().ok()?;
    let x = fields.next()?.parse::<i32>().ok()?;
    let y = fields.next()?.parse::<i32>().ok()?;
    let width = fields.next()?.parse::<u32>().ok()?;
    let height = fields.next()?.parse::<u32>().ok()?;
    let _machine = fields.next()?;
    let title = fields.collect::<Vec<_>>().join(" ").trim().to_string();
    let hex = id_field
        .strip_prefix("0x")
        .or_else(|| id_field.strip_prefix("0X"))?;
    let id = u64::from_str_radix(hex, 16).ok()?;
    if width == 0 || height == 0 {
        return None;
    }
    Some(CapturableWindow {
        id,
        title,
        app_name: String::new(),
        pid,
        x,
        y,
        width,
        height,
        is_minimized: false,
        backend: "x11".into(),
    })
}

#[allow(dead_code)]
fn parse_wmctrl_output(text: &str) -> Vec<CapturableWindow> {
    let mut out = Vec::new();
    for line in text.lines() {
        if out.len() >= MAX_WINDOWS {
            break;
        }
        if let Some(window) = parse_wmctrl_line(line) {
            out.push(window);
        }
    }
    out
}

/// Parses `1920x1080+0+0` and `1920x1080-1920+40` style xrandr geometry.
#[allow(dead_code)]
fn parse_geometry(value: &str) -> Option<(u32, u32, i32, i32)> {
    let split = value.find(|c| c == '+' || c == '-')?;
    let (size, offsets) = value.split_at(split);
    let (raw_width, raw_height) = size.split_once('x')?;
    let width = raw_width.parse::<u32>().ok()?;
    let height = raw_height.parse::<u32>().ok()?;
    if width == 0 || height == 0 {
        return None;
    }
    let mut numbers = Vec::with_capacity(2);
    let mut rest = offsets;
    while !rest.is_empty() && numbers.len() < 2 {
        let negative = rest.starts_with('-');
        if !negative && !rest.starts_with('+') {
            return None;
        }
        let tail = &rest[1..];
        let end = tail
            .find(|c| c == '+' || c == '-')
            .map(|offset| offset + 1)
            .unwrap_or(rest.len());
        let magnitude = tail[..end - 1].parse::<i32>().ok()?;
        numbers.push(if negative { -magnitude } else { magnitude });
        rest = &rest[end..];
    }
    if numbers.len() != 2 || !rest.is_empty() {
        return None;
    }
    Some((width, height, numbers[0], numbers[1]))
}

#[allow(dead_code)]
fn parse_xrandr_output(text: &str) -> Vec<CapturableDisplay> {
    let mut out = Vec::new();
    for line in text.lines() {
        if out.len() >= MAX_DISPLAYS {
            break;
        }
        let mut fields = line.split_whitespace();
        let name = match fields.next() {
            Some(name) => name,
            None => continue,
        };
        if fields.next() != Some("connected") {
            continue;
        }
        let details: Vec<&str> = fields.collect();
        let is_primary = details.iter().any(|token| *token == "primary");
        let geometry = details
            .iter()
            .find_map(|token| parse_geometry(token))
            .unwrap_or((0, 0, 0, 0));
        let (width, height, x, y) = geometry;
        if width == 0 || height == 0 {
            continue;
        }
        out.push(CapturableDisplay {
            id: (out.len() + 1) as u64,
            name: name.to_string(),
            width,
            height,
            x,
            y,
            scale_factor: 1.0,
            is_primary,
            backend: "x11".into(),
        });
    }
    out
}

#[cfg(target_os = "linux")]
fn x11_display_name() -> Result<String, String> {
    let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0.0".to_string());
    let trimmed = display.trim();
    if trimmed.is_empty()
        || trimmed.len() > 64
        || trimmed
            .chars()
            .any(|c| c.is_control() || c.is_whitespace())
    {
        return Err("Invalid DISPLAY value for native capture".into());
    }
    Ok(trimmed.to_string())
}

#[cfg(target_os = "linux")]
fn x11_offset(display: &str, x: i32, y: i32) -> String {
    format!(
        "{}{}{}{}{}",
        display,
        if x >= 0 { "+" } else { "" },
        x,
        if y >= 0 { "+" } else { "" },
        y
    )
}

/// Returns dimensions from enumeration when the captured JPEG has no readable header.
fn fallback_geometry(target_kind: &str, target_id: u64) -> (u32, u32) {
    if target_kind == "window" {
        list_capturable_windows()
            .into_iter()
            .find(|window| window.id == target_id)
            .map(|window| (window.width, window.height))
    } else {
        list_capturable_displays()
            .into_iter()
            .find(|display| display.id == target_id)
            .map(|display| (display.width, display.height))
    }
    .unwrap_or((0, 0))
}

#[cfg(target_os = "macos")]
mod platform_macos {
    use super::*;
    use std::ffi::{c_void, CStr};

    type CfRef = *const c_void;
    type DisplayId = u32;

    #[repr(C)]
    struct Point {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    struct Size {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    struct Rect {
        origin: Point,
        size: Size,
    }

    const ON_SCREEN_ONLY: u32 = 1;
    const UTF8_ENCODING: u32 = 0x0800_0100;
    const NUMBER_SINT64: i32 = 4;
    const NUMBER_DOUBLE: i32 = 13;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> CfRef;
        fn CGGetActiveDisplayList(max: u32, active: *mut DisplayId, count: *mut u32) -> i32;
        fn CGDisplayBounds(display: DisplayId) -> Rect;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(array: CfRef) -> isize;
        fn CFArrayGetValueAtIndex(array: CfRef, index: isize) -> CfRef;
        fn CFDictionaryGetValue(dictionary: CfRef, key: CfRef) -> CfRef;
        fn CFGetTypeID(value: CfRef) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFNumberGetTypeID() -> usize;
        fn CFDictionaryGetTypeID() -> usize;
        fn CFStringCreateWithCString(allocator: CfRef, text: *const i8, encoding: u32) -> CfRef;
        fn CFStringGetCString(string: CfRef, buffer: *mut i8, size: isize, encoding: u32) -> u8;
        fn CFNumberGetValue(number: CfRef, kind: i32, value: *mut c_void) -> u8;
        fn CFRelease(value: CfRef);
    }

    unsafe fn cf_text(value: CfRef) -> Option<String> {
        if value.is_null() || CFGetTypeID(value) != CFStringGetTypeID() {
            return None;
        }
        let mut buffer = [0i8; 512];
        if CFStringGetCString(
            value,
            buffer.as_mut_ptr(),
            buffer.len() as isize,
            UTF8_ENCODING,
        ) == 0
        {
            return None;
        }
        Some(
            CStr::from_ptr(buffer.as_ptr())
                .to_string_lossy()
                .into_owned(),
        )
    }

    unsafe fn cf_integer(value: CfRef) -> Option<i64> {
        if value.is_null() || CFGetTypeID(value) != CFNumberGetTypeID() {
            return None;
        }
        let mut number = 0i64;
        if CFNumberGetValue(value, NUMBER_SINT64, &mut number as *mut i64 as *mut c_void) == 0 {
            return None;
        }
        Some(number)
    }

    unsafe fn cf_double(value: CfRef) -> Option<f64> {
        if value.is_null() || CFGetTypeID(value) != CFNumberGetTypeID() {
            return None;
        }
        let mut number = 0f64;
        if CFNumberGetValue(value, NUMBER_DOUBLE, &mut number as *mut f64 as *mut c_void) == 0 {
            return None;
        }
        Some(number)
    }

    unsafe fn dictionary_value(dictionary: CfRef, key: &[u8]) -> CfRef {
        if dictionary.is_null() || CFGetTypeID(dictionary) != CFDictionaryGetTypeID() {
            return std::ptr::null();
        }
        let key_string = CFStringCreateWithCString(
            std::ptr::null(),
            key.as_ptr() as *const i8,
            UTF8_ENCODING,
        );
        if key_string.is_null() {
            return std::ptr::null();
        }
        let value = CFDictionaryGetValue(dictionary, key_string);
        CFRelease(key_string);
        value
    }

    pub(crate) fn windows() -> Vec<CapturableWindow> {
        let mut out = Vec::new();
        unsafe {
            let list = CGWindowListCopyWindowInfo(ON_SCREEN_ONLY, 0);
            if list.is_null() {
                return out;
            }
            let count = CFArrayGetCount(list).max(0) as usize;
            for index in 0..count.min(MAX_WINDOWS) {
                let entry = CFArrayGetValueAtIndex(list, index as isize);
                if entry.is_null() {
                    continue;
                }
                let number = cf_integer(dictionary_value(entry, b"kCGWindowNumber\0"))
                    .unwrap_or_default();
                let layer =
                    cf_integer(dictionary_value(entry, b"kCGWindowLayer\0")).unwrap_or_default();
                if number <= 0 || layer != 0 {
                    continue;
                }
                let title = cf_text(dictionary_value(entry, b"kCGWindowName\0")).unwrap_or_default();
                if title.trim().is_empty() {
                    continue;
                }
                let app_name =
                    cf_text(dictionary_value(entry, b"kCGWindowOwnerName\0")).unwrap_or_default();
                let pid = cf_integer(dictionary_value(entry, b"kCGWindowOwnerPID\0"))
                    .unwrap_or_default()
                    .clamp(0, u32::MAX as i64) as u32;
                let bounds = dictionary_value(entry, b"kCGWindowBounds\0");
                if cf_integer(dictionary_value(bounds, b"Height\0")).unwrap_or_default() <= 0
                    || cf_integer(dictionary_value(bounds, b"Width\0")).unwrap_or_default() <= 0
                {
                    continue;
                }
                let x = cf_double(dictionary_value(bounds, b"X\0")).unwrap_or_default() as i32;
                let y = cf_double(dictionary_value(bounds, b"Y\0")).unwrap_or_default() as i32;
                let width = cf_double(dictionary_value(bounds, b"Width\0")).unwrap_or_default()
                    .max(0.0) as u32;
                let height = cf_double(dictionary_value(bounds, b"Height\0")).unwrap_or_default()
                    .max(0.0) as u32;
                out.push(CapturableWindow {
                    id: number as u64,
                    title,
                    app_name,
                    pid,
                    x,
                    y,
                    width,
                    height,
                    is_minimized: false,
                    backend: BACKEND.into(),
                });
            }
            CFRelease(list);
        }
        out
    }

    pub(crate) fn displays() -> Vec<CapturableDisplay> {
        let mut ids = [0u32; MAX_DISPLAYS];
        let mut count = 0u32;
        unsafe {
            if CGGetActiveDisplayList(ids.len() as u32, ids.as_mut_ptr(), &mut count) != 0 {
                return Vec::new();
            }
            let mut out = Vec::new();
            for (index, display_id) in ids.iter().take(count as usize).enumerate() {
                let bounds = CGDisplayBounds(*display_id);
                let width = bounds.size.width.max(0.0) as u32;
                let height = bounds.size.height.max(0.0) as u32;
                if width == 0 || height == 0 {
                    continue;
                }
                out.push(CapturableDisplay {
                    id: (out.len() + 1) as u64,
                    name: format!("Display {}", index + 1),
                    width,
                    height,
                    x: bounds.origin.x as i32,
                    y: bounds.origin.y as i32,
                    scale_factor: 1.0,
                    is_primary: index == 0,
                    backend: BACKEND.into(),
                });
            }
            out
        }
    }

    pub(crate) fn capture_plan(
        target_kind: &str,
        target_id: u64,
        path: &Path,
    ) -> Result<CapturePlan, String> {
        let destination = path.to_string_lossy().into_owned();
        let identifier = target_id.to_string();
        let args = if target_kind == "window" {
            vec![
                "-x".into(),
                "-o".into(),
                "-t".into(),
                "jpg".into(),
                "-l".into(),
                identifier,
                destination,
            ]
        } else {
            vec![
                "-x".into(),
                "-t".into(),
                "jpg".into(),
                "-D".into(),
                identifier,
                destination,
            ]
        };
        Ok(CapturePlan {
            program: "screencapture".into(),
            args,
        })
    }
}

#[cfg(target_os = "windows")]
mod platform_windows {
    use super::*;
    use std::ffi::{c_void, OsString};
    use std::os::windows::ffi::OsStringExt;

    type Handle = *mut c_void;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct MonitorInfoEx {
        cb_size: u32,
        rc_monitor: Rect,
        rc_work: Rect,
        flags: u32,
        device: [u16; 32],
    }

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(callback: unsafe extern "system" fn(Handle, isize) -> i32, data: isize)
            -> i32;
        fn IsWindowVisible(handle: Handle) -> i32;
        fn IsIconic(handle: Handle) -> i32;
        fn GetWindowTextLengthW(handle: Handle) -> i32;
        fn GetWindowTextW(handle: Handle, buffer: *mut u16, capacity: i32) -> i32;
        fn GetClassNameW(handle: Handle, buffer: *mut u16, capacity: i32) -> i32;
        fn GetWindowRect(handle: Handle, rect: *mut Rect) -> i32;
        fn GetWindowThreadProcessId(handle: Handle, pid: *mut u32) -> u32;
        fn EnumDisplayMonitors(
            hdc: Handle,
            clip: *const Rect,
            callback: unsafe extern "system" fn(Handle, Handle, *const Rect, isize) -> i32,
            data: isize,
        ) -> i32;
        fn GetMonitorInfoW(monitor: Handle, info: *mut MonitorInfoEx) -> i32;
        fn GetSystemMetrics(index: i32) -> i32;
    }

    unsafe fn wide_text(buffer: &[u16], length: usize) -> String {
        OsString::from_wide(&buffer[..length.min(buffer.len())])
            .to_string_lossy()
            .into_owned()
    }

    unsafe extern "system" fn collect_window(handle: Handle, data: isize) -> i32 {
        if data == 0 {
            return 0;
        }
        let windows = &mut *(data as *mut Vec<CapturableWindow>);
        if windows.len() >= MAX_WINDOWS || IsWindowVisible(handle) == 0 {
            return 1;
        }
        let length = GetWindowTextLengthW(handle);
        if length <= 0 {
            return 1;
        }
        let mut title_buffer = vec![0u16; (length as usize + 1).min(512)];
        let written = GetWindowTextW(
            handle,
            title_buffer.as_mut_ptr(),
            title_buffer.len() as i32,
        );
        if written <= 0 {
            return 1;
        }
        let title = wide_text(&title_buffer, written as usize);
        if title.trim().is_empty() {
            return 1;
        }
        let mut class_buffer = [0u16; 128];
        let class_length = GetClassNameW(
            handle,
            class_buffer.as_mut_ptr(),
            class_buffer.len() as i32,
        );
        let app_name = if class_length > 0 {
            wide_text(&class_buffer, class_length as usize)
        } else {
            String::new()
        };
        let mut rect = Rect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetWindowRect(handle, &mut rect) == 0 {
            return 1;
        }
        let width = rect.right.saturating_sub(rect.left).max(0) as u32;
        let height = rect.bottom.saturating_sub(rect.top).max(0) as u32;
        if width == 0 || height == 0 {
            return 1;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(handle, &mut pid);
        windows.push(CapturableWindow {
            id: handle as usize as u64,
            title,
            app_name,
            pid,
            x: rect.left,
            y: rect.top,
            width,
            height,
            is_minimized: IsIconic(handle) != 0,
            backend: BACKEND.into(),
        });
        1
    }

    unsafe extern "system" fn collect_monitor(
        monitor: Handle,
        _hdc: Handle,
        _clip: *const Rect,
        data: isize,
    ) -> i32 {
        if data == 0 {
            return 0;
        }
        let displays = &mut *(data as *mut Vec<CapturableDisplay>);
        if displays.len() >= MAX_DISPLAYS {
            return 0;
        }
        let mut info = MonitorInfoEx {
            cb_size: std::mem::size_of::<MonitorInfoEx>() as u32,
            rc_monitor: Rect {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            rc_work: Rect {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            flags: 0,
            device: [0u16; 32],
        };
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return 1;
        }
        let width = info.rc_monitor.right.saturating_sub(info.rc_monitor.left).max(0) as u32;
        let height = info.rc_monitor.bottom.saturating_sub(info.rc_monitor.top).max(0) as u32;
        if width == 0 || height == 0 {
            return 1;
        }
        let device_length = info
            .device
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(info.device.len());
        let name = if device_length == 0 {
            format!("Display {}", displays.len() + 1)
        } else {
            wide_text(&info.device, device_length)
        };
        displays.push(CapturableDisplay {
            id: (displays.len() + 1) as u64,
            name,
            width,
            height,
            x: info.rc_monitor.left,
            y: info.rc_monitor.top,
            scale_factor: 1.0,
            is_primary: info.flags & 1 != 0,
            backend: BACKEND.into(),
        });
        1
    }

    pub(crate) fn windows() -> Vec<CapturableWindow> {
        let mut out = Vec::new();
        unsafe {
            EnumWindows(collect_window, &mut out as *mut Vec<CapturableWindow> as isize);
        }
        out
    }

    pub(crate) fn displays() -> Vec<CapturableDisplay> {
        let mut out = Vec::new();
        unsafe {
            EnumDisplayMonitors(
                std::ptr::null_mut(),
                std::ptr::null(),
                collect_monitor,
                &mut out as *mut Vec<CapturableDisplay> as isize,
            );
        }
        if out.is_empty() {
            let width = unsafe { GetSystemMetrics(0) }.max(0) as u32;
            let height = unsafe { GetSystemMetrics(1) }.max(0) as u32;
            if width > 0 && height > 0 {
                out.push(CapturableDisplay {
                    id: 1,
                    name: "Display 1".into(),
                    width,
                    height,
                    x: 0,
                    y: 0,
                    scale_factor: 1.0,
                    is_primary: true,
                    backend: BACKEND.into(),
                });
            }
        }
        out
    }

    #[repr(C)]
    struct BitmapInfoHeader {
        bi_size: u32,
        bi_width: i32,
        bi_height: i32,
        bi_planes: u16,
        bi_bit_count: u16,
        bi_compression: u32,
        bi_size_image: u32,
        bi_x_pels_per_meter: i32,
        bi_y_pels_per_meter: i32,
        bi_clr_used: u32,
        bi_clr_important: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetDC(hwnd: Handle) -> Handle;
        fn ReleaseDC(hwnd: Handle, hdc: Handle) -> i32;
        fn PrintWindow(hwnd: Handle, hdc_blt: Handle, flags: u32) -> i32;
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn CreateCompatibleDC(hdc: Handle) -> Handle;
        fn DeleteDC(hdc: Handle) -> i32;
        fn CreateCompatibleBitmap(hdc: Handle, cx: i32, cy: i32) -> Handle;
        fn SelectObject(hdc: Handle, obj: Handle) -> Handle;
        fn DeleteObject(obj: Handle) -> i32;
        fn BitBlt(
            hdc: Handle,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            hdc_src: Handle,
            x1: i32,
            y1: i32,
            rop: u32,
        ) -> i32;
        fn StretchBlt(
            hdc_dest: Handle,
            x_dest: i32,
            y_dest: i32,
            w_dest: i32,
            h_dest: i32,
            hdc_src: Handle,
            x_src: i32,
            y_src: i32,
            w_src: i32,
            h_src: i32,
            rop: u32,
        ) -> i32;
        fn SetStretchBltMode(hdc: Handle, mode: i32) -> i32;
        fn GetDIBits(
            hdc: Handle,
            hbm: Handle,
            start: u32,
            c_lines: u32,
            lpv_bits: *mut c_void,
            lpbmi: *mut BitmapInfoHeader,
            usage: u32,
        ) -> i32;
    }

    /// Direct zero-dependency Win32 PrintWindow / BitBlt capture (no ffmpeg required, zero popups).
    /// Downscales to <= 960x540 so BMP frames stay well under the 4 MiB frame cap and fast at 5–15 fps.
    pub(crate) fn capture_direct_frame(
        source_id: &str,
        target_kind: &str,
        target_id: u64,
    ) -> Result<NativeCaptureFrame, String> {
        const SRCCOPY: u32 = 0x00CC_0020;
        const HALFTONE: i32 = 4;
        const PW_RENDERFULLCONTENT: u32 = 0x0000_0002;
        const DIB_RGB_COLORS: u32 = 0;

        unsafe {
            let (src_w, src_h, src_x, src_y, hwnd): (i32, i32, i32, i32, Handle) =
                if target_kind == "window" {
                    let h = target_id as usize as Handle;
                    if h.is_null() {
                        return Err("Select a window to capture".into());
                    }
                    let mut rect = Rect { left: 0, top: 0, right: 0, bottom: 0 };
                    if GetWindowRect(h, &mut rect) == 0 {
                        return Err("Selected window is no longer available".into());
                    }
                    let w = (rect.right - rect.left).max(0);
                    let ht = (rect.bottom - rect.top).max(0);
                    if w == 0 || ht == 0 {
                        return Err("Selected window is minimized or has zero size".into());
                    }
                    (w, ht, 0, 0, h)
                } else {
                    let all = displays();
                    let chosen = all
                        .iter()
                        .find(|d| d.id == target_id)
                        .or_else(|| all.first());
                    if let Some(d) = chosen {
                        (d.width as i32, d.height as i32, d.x, d.y, std::ptr::null_mut())
                    } else {
                        (
                            GetSystemMetrics(0).max(1),
                            GetSystemMetrics(1).max(1),
                            0,
                            0,
                            std::ptr::null_mut(),
                        )
                    }
                };

            // Fit within 960x540 to keep uncompressed 32-bit BMP <= ~2.0 MiB (fast & crisp for preview)
            let max_w = 960.0f64;
            let max_h = 540.0f64;
            let scale = (max_w / (src_w as f64)).min(max_h / (src_h as f64)).min(1.0);
            let out_w = ((src_w as f64) * scale).round().max(1.0) as i32;
            let out_h = ((src_h as f64) * scale).round().max(1.0) as i32;

            let screen_dc = GetDC(std::ptr::null_mut());
            if screen_dc.is_null() {
                return Err("Could not acquire screen DC".into());
            }

            let full_dc = CreateCompatibleDC(screen_dc);
            let full_bmp = CreateCompatibleBitmap(screen_dc, src_w, src_h);
            let old_full = SelectObject(full_dc, full_bmp);

            let mut captured_ok = false;
            if !hwnd.is_null() {
                if PrintWindow(hwnd, full_dc, PW_RENDERFULLCONTENT) != 0 {
                    captured_ok = true;
                } else {
                    let win_dc = GetDC(hwnd);
                    if !win_dc.is_null() {
                        captured_ok = BitBlt(full_dc, 0, 0, src_w, src_h, win_dc, 0, 0, SRCCOPY) != 0;
                        ReleaseDC(hwnd, win_dc);
                    }
                }
            } else {
                captured_ok = BitBlt(full_dc, 0, 0, src_w, src_h, screen_dc, src_x, src_y, SRCCOPY) != 0;
            }

            if !captured_ok {
                SelectObject(full_dc, old_full);
                DeleteObject(full_bmp);
                DeleteDC(full_dc);
                ReleaseDC(std::ptr::null_mut(), screen_dc);
                return Err("Win32 capture returned no frame".into());
            }

            let out_dc = CreateCompatibleDC(screen_dc);
            let out_bmp = CreateCompatibleBitmap(screen_dc, out_w, out_h);
            let old_out = SelectObject(out_dc, out_bmp);
            SetStretchBltMode(out_dc, HALFTONE);
            let _ = StretchBlt(out_dc, 0, 0, out_w, out_h, full_dc, 0, 0, src_w, src_h, SRCCOPY);

            let mut bmi = BitmapInfoHeader {
                bi_size: std::mem::size_of::<BitmapInfoHeader>() as u32,
                bi_width: out_w,
                bi_height: -out_h, // top-down
                bi_planes: 1,
                bi_bit_count: 32,
                bi_compression: 0,
                bi_size_image: 0,
                bi_x_pels_per_meter: 0,
                bi_y_pels_per_meter: 0,
                bi_clr_used: 0,
                bi_clr_important: 0,
            };
            let mut pixels = vec![0u8; (out_w as usize) * (out_h as usize) * 4];
            let rows = GetDIBits(
                out_dc,
                out_bmp,
                0,
                out_h as u32,
                pixels.as_mut_ptr() as *mut c_void,
                &mut bmi,
                DIB_RGB_COLORS,
            );

            SelectObject(out_dc, old_out);
            DeleteObject(out_bmp);
            DeleteDC(out_dc);
            SelectObject(full_dc, old_full);
            DeleteObject(full_bmp);
            DeleteDC(full_dc);
            ReleaseDC(std::ptr::null_mut(), screen_dc);

            if rows == 0 {
                return Err("Win32 GetDIBits failed".into());
            }

            let bmp = encode_bgra_as_bmp(out_w as u32, out_h as u32, &pixels)?;
            Ok(NativeCaptureFrame {
                source_id: source_id.to_string(),
                target_kind: target_kind.to_string(),
                target_id,
                width: out_w as u32,
                height: out_h as u32,
                mime_type: "image/bmp".into(),
                base64_data: base64_encode(&bmp),
                timestamp_ms: unix_millis(),
                backend: BACKEND.into(),
            })
        }
    }

    pub(crate) fn capture_plan(
        target_kind: &str,
        target_id: u64,
        path: &Path,
    ) -> Result<CapturePlan, String> {
        let input = if target_kind == "window" {
            format!("hwnd=0x{target_id:x}")
        } else {
            "desktop".to_string()
        };
        Ok(CapturePlan {
            program: "ffmpeg".into(),
            args: vec![
                "-y".into(),
                "-loglevel".into(),
                "error".into(),
                "-f".into(),
                "gdigrab".into(),
                "-i".into(),
                input,
                "-frames:v".into(),
                "1".into(),
                "-q:v".into(),
                "3".into(),
                path.to_string_lossy().into_owned(),
            ],
        })
    }
}

#[cfg(target_os = "linux")]
mod platform_linux {
    use super::*;

    pub(crate) fn windows() -> Vec<CapturableWindow> {
        match run_bounded_command("wmctrl", &["-lpG"], MAX_ENUMERATION_BYTES) {
            Ok((bytes, true)) => parse_wmctrl_output(&String::from_utf8_lossy(&bytes)),
            _ => Vec::new(),
        }
    }

    pub(crate) fn displays() -> Vec<CapturableDisplay> {
        match run_bounded_command("xrandr", &["--query"], MAX_ENUMERATION_BYTES) {
            Ok((bytes, true)) => parse_xrandr_output(&String::from_utf8_lossy(&bytes)),
            _ => Vec::new(),
        }
    }

    pub(crate) fn capture_plan(
        target_kind: &str,
        target_id: u64,
        path: &Path,
    ) -> Result<CapturePlan, String> {
        let display = x11_display_name()?;
        let destination = path.to_string_lossy().into_owned();
        let mut args: Vec<String> = vec![
            "-y".into(),
            "-loglevel".into(),
            "error".into(),
            "-f".into(),
            "x11grab".into(),
        ];
        let mut input = display;
        if target_kind == "window" {
            if let Some(window) = windows().into_iter().find(|w| w.id == target_id) {
                args.push("-video_size".into());
                args.push(format!("{}x{}", window.width, window.height));
                input = x11_offset(&input, window.x, window.y);
            }
        }
        args.push("-i".into());
        args.push(input);
        args.push("-frames:v".into());
        args.push("1".into());
        args.push("-q:v".into());
        args.push("3".into());
        args.push(destination);
        Ok(CapturePlan {
            program: "ffmpeg".into(),
            args,
        })
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux", target_os = "android")))]
mod platform_stub {
    use super::*;

    pub(crate) fn windows() -> Vec<CapturableWindow> {
        Vec::new()
    }

    pub(crate) fn displays() -> Vec<CapturableDisplay> {
        Vec::new()
    }

    pub(crate) fn capture_plan(
        _target_kind: &str,
        _target_id: u64,
        _path: &Path,
    ) -> Result<CapturePlan, String> {
        Err("Native capture is not supported on this platform".into())
    }
}

#[cfg(target_os = "android")]
mod platform_android {
    use super::*;

    pub(crate) fn windows() -> Vec<CapturableWindow> {
        Vec::new()
    }

    pub(crate) fn displays() -> Vec<CapturableDisplay> {
        Vec::new()
    }

    pub(crate) fn capture_plan(
        _target_kind: &str,
        _target_id: u64,
        _path: &Path,
    ) -> Result<CapturePlan, String> {
        Err("Native capture is not available on Android".into())
    }
}

#[cfg(target_os = "macos")]
use platform_macos as platform;
#[cfg(target_os = "windows")]
use platform_windows as platform;
#[cfg(target_os = "linux")]
use platform_linux as platform;
#[cfg(target_os = "android")]
use platform_android as platform;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux", target_os = "android")))]
use platform_stub as platform;

/// Enumerate real on-screen windows without opening a chooser or prompt.
pub fn list_capturable_windows() -> Vec<CapturableWindow> {
    platform::windows()
}

/// Enumerate attached displays without opening a chooser or prompt.
pub fn list_capturable_displays() -> Vec<CapturableDisplay> {
    platform::displays()
}

/// Capture a single frame into a bounded, base64-encoded JPEG payload.
pub fn capture_native_frame(
    source_id: &str,
    target_kind: &str,
    target_id: u64,
) -> Result<NativeCaptureFrame, String> {
    validate_source_id(source_id)?;
    let kind = validate_target_kind(target_kind)?;
    #[cfg(target_os = "windows")]
    {
        if let Ok(frame) = platform_windows::capture_direct_frame(source_id, kind, target_id) {
            return Ok(frame);
        }
    }
    let temporary = TempFrame::new()?;
    let plan = platform::capture_plan(kind, target_id, &temporary.0)?;
    let arguments = plan.arg_refs();
    let (_, succeeded) = run_bounded_command(&plan.program, &arguments, 4096)?;
    if !succeeded {
        return Err(format!(
            "Native capture command failed for {kind} target {target_id}"
        ));
    }
    let bytes = std::fs::read(&temporary.0)
        .map_err(|err| format!("Could not read captured frame: {err}"))?;
    if bytes.is_empty() {
        return Err("Native capture produced an empty frame".into());
    }
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(format!(
            "Captured frame exceeds the {} byte limit",
            MAX_FRAME_BYTES
        ));
    }
    let (width, height) =
        jpeg_dimensions(&bytes).unwrap_or_else(|| fallback_geometry(kind, target_id));
    Ok(NativeCaptureFrame {
        source_id: source_id.to_string(),
        target_kind: kind.to_string(),
        target_id,
        width,
        height,
        mime_type: "image/jpeg".into(),
        base64_data: base64_encode(&bytes),
        timestamp_ms: unix_millis(),
        backend: BACKEND.into(),
    })
}

struct SessionHandle {
    active: Arc<AtomicBool>,
    task: Option<JoinHandle<()>>,
}

#[derive(Default)]
struct CaptureState {
    sessions: Mutex<HashMap<String, SessionHandle>>,
}

impl Drop for CaptureState {
    fn drop(&mut self) {
        let sessions = std::mem::take(&mut self.sessions);
        let Ok(sessions) = sessions.into_inner() else {
            return;
        };
        for (_, session) in sessions {
            session.active.store(false, Ordering::SeqCst);
            if let Some(task) = session.task {
                task.abort();
            }
        }
    }
}

/// Bounded, thread-safe registry of native capture streams.
#[derive(Clone, Default)]
pub struct NativeCaptureManager {
    state: Arc<CaptureState>,
}

impl NativeCaptureManager {
    /// Validate inputs and claim a slot. The task is attached separately so the
    /// capacity rules stay testable without an application handle.
    fn reserve(
        &self,
        source_id: &str,
        target_kind: &str,
        target_id: u64,
        fps: u32,
    ) -> Result<(NativeCaptureSessionInfo, Arc<AtomicBool>), String> {
        validate_source_id(source_id)?;
        let kind = validate_target_kind(target_kind)?;
        let fps = clamp_fps(fps);
        let mut sessions = self
            .state
            .sessions
            .lock()
            .map_err(|_| "Capture session registry is poisoned".to_string())?;
        if !sessions.contains_key(source_id) && sessions.len() >= MAX_SESSIONS {
            return Err(format!(
                "At most {MAX_SESSIONS} native capture sessions may run at once"
            ));
        }
        if let Some(previous) = sessions.remove(source_id) {
            previous.active.store(false, Ordering::SeqCst);
            if let Some(task) = previous.task {
                task.abort();
            }
        }
        let active = Arc::new(AtomicBool::new(true));
        let info = NativeCaptureSessionInfo {
            source_id: source_id.to_string(),
            target_kind: kind.to_string(),
            target_id,
            fps,
            active: true,
            backend: BACKEND.into(),
        };
        sessions.insert(
            source_id.to_string(),
            SessionHandle {
                active: active.clone(),
                task: None,
            },
        );
        Ok((info, active))
    }

    fn attach_task(&self, source_id: &str, active: &Arc<AtomicBool>, task: JoinHandle<()>) {
        let Ok(mut sessions) = self.state.sessions.lock() else {
            task.abort();
            return;
        };
        if let Some(session) = sessions.get_mut(source_id) {
            if Arc::ptr_eq(&session.active, active) {
                session.task = Some(task);
                return;
            }
        }
        task.abort();
    }

    /// Start (or replace) a bounded background capture stream for one source.
    pub fn start_stream(
        &self,
        app: AppHandle,
        source_id: String,
        target_kind: String,
        target_id: u64,
        fps: u32,
    ) -> Result<NativeCaptureSessionInfo, String> {
        let (info, active) = self.reserve(&source_id, &target_kind, target_id, fps)?;
        let stream_id = info.source_id.clone();
        let stream_kind = info.target_kind.clone();
        let interval_ms = 1000 / info.fps;
        let task_active = active.clone();
        let task = tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_millis(interval_ms as u64));
            loop {
                ticker.tick().await;
                if !task_active.load(Ordering::SeqCst) {
                    break;
                }
                let frame_id = stream_id.clone();
                let frame_kind = stream_kind.clone();
                let captured = tauri::async_runtime::spawn_blocking(move || {
                    capture_native_frame(&frame_id, &frame_kind, target_id)
                })
                .await;
                if let Ok(Ok(frame)) = captured {
                    let _ = app.emit(FRAME_EVENT, frame);
                }
                if !task_active.load(Ordering::SeqCst) {
                    break;
                }
            }
        });
        self.attach_task(&source_id, &active, task);
        Ok(info)
    }

    /// Stop one stream. Returns whether a session was present.
    pub fn stop_stream(&self, source_id: &str) -> Result<bool, String> {
        validate_source_id(source_id)?;
        let mut sessions = self
            .state
            .sessions
            .lock()
            .map_err(|_| "Capture session registry is poisoned".to_string())?;
        let Some(session) = sessions.remove(source_id) else {
            return Ok(false);
        };
        session.active.store(false, Ordering::SeqCst);
        if let Some(task) = session.task {
            task.abort();
        }
        Ok(true)
    }

    /// Stop every stream, used during application shutdown.
    pub fn stop_all(&self) -> usize {
        let Ok(mut sessions) = self.state.sessions.lock() else {
            return 0;
        };
        let count = sessions.len();
        for (_, session) in sessions.drain() {
            session.active.store(false, Ordering::SeqCst);
            if let Some(task) = session.task {
                task.abort();
            }
        }
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode_b64(input: &str) -> Vec<u8> {
        fn value(byte: u8) -> u8 {
            match byte {
                b'A'..=b'Z' => byte - b'A',
                b'a'..=b'z' => byte - b'a' + 26,
                b'0'..=b'9' => byte - b'0' + 52,
                b'+' => 62,
                b'/' => 63,
                _ => 0,
            }
        }
        let bytes = input.as_bytes();
        let mut out = Vec::new();
        for chunk in bytes.chunks(4) {
            if chunk.len() < 2 {
                break;
            }
            let third = chunk.get(2).copied().unwrap_or(b'=');
            let fourth = chunk.get(3).copied().unwrap_or(b'=');
            let packed = (value(chunk[0]) as u32) << 18
                | (value(chunk[1]) as u32) << 12
                | (value(third) as u32) << 6
                | value(fourth) as u32;
            out.push((packed >> 16) as u8);
            if third != b'=' {
                out.push((packed >> 8) as u8);
            }
            if fourth != b'=' {
                out.push(packed as u8);
            }
        }
        out
    }

    #[test]
    fn base64_encoder_matches_known_vectors_and_round_trips() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        for length in 0..=96usize {
            let payload: Vec<u8> = (0..length).map(|index| (index * 37) as u8).collect();
            let encoded = base64_encode(&payload);
            assert_eq!(decode_b64(&encoded), payload, "length {length}");
        }
    }

    #[test]
    fn wmctrl_parser_reads_pid_geometry_and_multiline_titles() {
        let text = "\
0x00a00006  0  1337  10  20  800  600 station-a Terminal - Session\n\
0x00000001 -1     0   0   0  100  100 station-a Desktop\n\
this line is not a window\n\
0xNOTHEX 0 12 0 0 10 10 station-a Broken\n";
        let windows = parse_wmctrl_output(text);
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].id, 0x00a0_0006);
        assert_eq!(windows[0].pid, 1337);
        assert_eq!((windows[0].x, windows[0].y), (10, 20));
        assert_eq!((windows[0].width, windows[0].height), (800, 600));
        assert_eq!(windows[0].title, "Terminal - Session");
        assert_eq!(windows[0].backend, "x11");
        assert_eq!(windows[1].id, 1);
        assert!(!windows[1].is_minimized);
    }

    #[test]
    fn wmctrl_parser_limits_the_number_of_rows() {
        let text = (0..MAX_WINDOWS + 20)
            .map(|index| format!("0x0000{index:04x} 0 1 0 0 10 10 host Window {index}"))
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(parse_wmctrl_output(&text).len(), MAX_WINDOWS);
    }

    #[test]
    fn xrandr_parser_detects_primary_display_and_offsets() {
        let text = "\
Screen 0: minimum 8 x 8, current 3840 x 1080, maximum 32767 x 32767\n\
eDP-1 connected primary 1920x1080+0+0 344mm x 194mm\n\
   1920x1080     60.00*+  50.00\n\
DP-2 connected 1920x1080+1920+0 500mm x 290mm\n\
HDMI-1 disconnected (normal left inverted right x axis y axis)\n";
        let displays = parse_xrandr_output(text);
        assert_eq!(displays.len(), 2);
        assert_eq!(displays[0].name, "eDP-1");
        assert!(displays[0].is_primary);
        assert_eq!((displays[0].id, displays[0].width, displays[0].height), (1, 1920, 1080));
        assert_eq!(displays[1].name, "DP-2");
        assert!(!displays[1].is_primary);
        assert_eq!((displays[1].x, displays[1].y), (1920, 0));
        assert_eq!(displays[1].id, 2);
    }

    #[test]
    fn geometry_parser_handles_negative_offsets_and_rejects_garbage() {
        assert_eq!(
            parse_geometry("2560x1440-640+20"),
            Some((2560, 1440, -640, 20))
        );
        assert_eq!(parse_geometry("800x600+0+0"), Some((800, 600, 0, 0)));
        assert_eq!(parse_geometry("bad"), None);
        assert_eq!(parse_geometry("0x0+0+0"), None);
    }

    #[test]
    fn jpeg_dimension_parser_reads_the_first_frame_header() {
        let mut frame = vec![0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
        frame.extend(std::iter::repeat(0u8).take(14));
        frame.extend_from_slice(&[
            0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x04, 0x00, 0x01, 0x01, 0x11, 0x00, 0x02,
            0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
        ]);
        assert_eq!(jpeg_dimensions(&frame), Some((1024, 720)));
        assert_eq!(jpeg_dimensions(b"not a jpeg"), None);
    }

    #[test]
    fn fps_is_clamped_to_one_through_fifteen() {
        assert_eq!(clamp_fps(0), 1);
        assert_eq!(clamp_fps(1), 1);
        assert_eq!(clamp_fps(8), 8);
        assert_eq!(clamp_fps(15), 15);
        assert_eq!(clamp_fps(16), 15);
        assert_eq!(clamp_fps(u32::MAX), 15);
    }

    #[test]
    fn target_kind_only_accepts_window_and_display() {
        assert_eq!(validate_target_kind("window"), Ok("window"));
        assert_eq!(validate_target_kind(" DISPLAY "), Ok("display"));
        assert!(validate_target_kind("screen").is_err());
        assert!(validate_target_kind("").is_err());
    }

    #[test]
    fn source_id_validation_rejects_empty_control_and_oversized_values() {
        assert!(validate_source_id("src-1").is_ok());
        assert!(validate_source_id("").is_err());
        assert!(validate_source_id("   ").is_err());
        assert!(validate_source_id("bad\nid").is_err());
        assert!(validate_source_id(&"a".repeat(MAX_SOURCE_ID_LEN + 1)).is_err());
    }

    #[tokio::test]
    async fn manager_enforces_four_session_limit_and_replaces_cleanly() {
        let manager = NativeCaptureManager::default();
        let mut replaced_flag = None;
        for index in 0..MAX_SESSIONS {
            let active = Arc::new(AtomicBool::new(true));
            if index == 1 {
                replaced_flag = Some(active.clone());
            }
            let task = tauri::async_runtime::spawn(async {});
            manager.state.sessions.lock().unwrap().insert(
                format!("src-{index}"),
                SessionHandle {
                    active,
                    task: Some(task),
                },
            );
        }
        assert!(manager.reserve("src-4", "window", 9, 5).is_err());

        let (info, _) = manager.reserve("src-1", "display", 3, 30).unwrap();
        assert_eq!(info.fps, MAX_FPS);
        assert_eq!(info.target_kind, "display");
        assert_eq!(info.target_id, 3);
        assert!(!replaced_flag.unwrap().load(Ordering::SeqCst));

        assert!(manager.stop_stream("src-0").unwrap());
        assert!(!manager.stop_stream("src-0").unwrap());
        assert!(manager.reserve("src-4", "window", 9, 5).is_ok());
        assert_eq!(manager.stop_all(), MAX_SESSIONS);
    }
}
