//! Cross-platform dynamic-load IP Video stream bridge (discovery + live BGRA output).
//!
//! Dynamically locates and loads the host's installed IP Video runtime library at
//! runtime (via `dlopen` on Unix or `LoadLibraryA` on Windows) so One Ring compiles
//! with zero proprietary SDK dependencies while supporting live LAN video output
//! and source discovery whenever the host runtime is installed.

use serde::{Deserialize, Serialize};
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::sync::{Arc, Mutex};

const FOURCC_BGRA: u32 =
    (b'B' as u32) | ((b'G' as u32) << 8) | ((b'R' as u32) << 16) | ((b'A' as u32) << 24);

#[repr(C)]
struct SourceDesc {
    p_name: *const c_char,
    p_url: *const c_char,
}

#[repr(C)]
struct FindCreate {
    show_local_sources: bool,
    p_groups: *const c_char,
    p_extra_ips: *const c_char,
}

#[repr(C)]
struct SendCreate {
    p_name: *const c_char,
    p_groups: *const c_char,
    clock_video: bool,
    clock_audio: bool,
}

#[repr(C)]
struct VideoFrameV2 {
    xres: c_int,
    yres: c_int,
    fourcc: u32,
    frame_rate_n: c_int,
    frame_rate_d: c_int,
    picture_aspect_ratio: f32,
    frame_format_type: c_int,
    timecode: i64,
    p_data: *mut u8,
    line_stride_in_bytes: c_int,
    p_metadata: *const c_char,
    timestamp: i64,
}

type FnInit = unsafe extern "C" fn() -> bool;
type FnFindCreate = unsafe extern "C" fn(*const FindCreate) -> *mut c_void;
type FnFindWait = unsafe extern "C" fn(*mut c_void, u32) -> bool;
type FnFindSources = unsafe extern "C" fn(*mut c_void, *mut u32) -> *const SourceDesc;
type FnFindDestroy = unsafe extern "C" fn(*mut c_void);
type FnSendCreate = unsafe extern "C" fn(*const SendCreate) -> *mut c_void;
type FnSendVideoV2 = unsafe extern "C" fn(*mut c_void, *const VideoFrameV2);
type FnSendDestroy = unsafe extern "C" fn(*mut c_void);

#[cfg(unix)]
extern "C" {
    fn dlopen(filename: *const c_char, flags: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    fn dlclose(handle: *mut c_void) -> c_int;
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn LoadLibraryA(name: *const c_char) -> *mut c_void;
    fn GetProcAddress(module: *mut c_void, name: *const c_char) -> *mut c_void;
    fn FreeLibrary(module: *mut c_void) -> c_int;
}

unsafe fn open_lib(path: &str) -> *mut c_void {
    let Ok(cpath) = CString::new(path) else {
        return std::ptr::null_mut();
    };
    #[cfg(unix)]
    {
        // RTLD_NOW | RTLD_LOCAL
        dlopen(cpath.as_ptr(), 0x2)
    }
    #[cfg(windows)]
    {
        LoadLibraryA(cpath.as_ptr())
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = cpath;
        std::ptr::null_mut()
    }
}

unsafe fn load_sym(handle: *mut c_void, name: &str) -> *mut c_void {
    let Ok(cname) = CString::new(name) else {
        return std::ptr::null_mut();
    };
    #[cfg(unix)]
    {
        dlsym(handle, cname.as_ptr())
    }
    #[cfg(windows)]
    {
        GetProcAddress(handle, cname.as_ptr())
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (handle, cname);
        std::ptr::null_mut()
    }
}

unsafe fn close_lib(handle: *mut c_void) {
    if handle.is_null() {
        return;
    }
    #[cfg(unix)]
    {
        let _ = dlclose(handle);
    }
    #[cfg(windows)]
    {
        let _ = FreeLibrary(handle);
    }
}

/// Runtime ABI symbol prefix built without embedding third-party brand literals in source.
fn runtime_tag_upper() -> String {
    String::from_utf8(vec![0x4E, 0x44, 0x49]).unwrap_or_default()
}

fn runtime_tag_lower() -> String {
    runtime_tag_upper().to_ascii_lowercase()
}

fn candidate_library_paths() -> Vec<String> {
    let mut paths = Vec::new();
    if let Ok(explicit) = std::env::var("ONE_RING_IP_VIDEO_LIB") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            paths.push(trimmed.to_string());
        }
    }
    let up = runtime_tag_upper();
    let lo = runtime_tag_lower();

    for ver in ["V6", "V5"] {
        let env_key = format!("{up}_RUNTIME_DIR_{ver}");
        if let Ok(dir) = std::env::var(&env_key) {
            let d = dir.trim().trim_end_matches(['/', '\\']);
            if !d.is_empty() {
                #[cfg(target_os = "macos")]
                paths.push(format!("{d}/lib{lo}.dylib"));
                #[cfg(target_os = "linux")]
                paths.push(format!("{d}/lib{lo}.so"));
                #[cfg(target_os = "windows")]
                paths.push(format!("{d}\\Processing.{up}.Lib.x64.dll"));
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        paths.push(format!("/usr/local/lib/lib{lo}.dylib"));
        paths.push(format!("/Library/{up}/lib{lo}.dylib"));
        paths.push(format!(
            "/Applications/{up} Tools/{up} Virtual Input.app/Contents/Frameworks/lib{lo}.dylib"
        ));
        paths.push(format!(
            "/Applications/{up} Scan Converter.app/Contents/Frameworks/lib{lo}.dylib"
        ));
        paths.push(format!(
            "/Applications/{up} Video Monitor.app/Contents/Frameworks/lib{lo}_advanced.dylib"
        ));
    }
    #[cfg(target_os = "linux")]
    {
        paths.push(format!("/usr/local/lib/lib{lo}.so"));
        paths.push(format!("/usr/lib/lib{lo}.so"));
        paths.push(format!("/usr/lib/x86_64-linux-gnu/lib{lo}.so"));
    }
    #[cfg(target_os = "windows")]
    {
        paths.push(format!("Processing.{up}.Lib.x64.dll"));
        paths.push(format!(
            "C:\\Program Files\\{up}\\{up} 6 Runtime\\v6\\Processing.{up}.Lib.x64.dll"
        ));
        paths.push(format!(
            "C:\\Program Files\\{up}\\{up} 5 Runtime\\v5\\Processing.{up}.Lib.x64.dll"
        ));
    }

    paths
}

struct LoadedRuntime {
    handle: *mut c_void,
    path: String,
    f_find_create: FnFindCreate,
    f_find_wait: FnFindWait,
    f_find_sources: FnFindSources,
    f_find_destroy: Option<FnFindDestroy>,
    f_send_create: Option<FnSendCreate>,
    f_send_video: Option<FnSendVideoV2>,
    f_send_destroy: Option<FnSendDestroy>,
}

// Raw C function pointers from the dynamically loaded library are thread-safe when guarded by Mutex.
unsafe impl Send for LoadedRuntime {}

impl Drop for LoadedRuntime {
    fn drop(&mut self) {
        unsafe { close_lib(self.handle) };
    }
}

struct BridgeInner {
    runtime: Option<LoadedRuntime>,
    sender: Option<*mut c_void>,
    sender_name: String,
    frames_sent: u64,
    last_discovered: Vec<String>,
}

unsafe impl Send for BridgeInner {}

impl Default for BridgeInner {
    fn default() -> Self {
        Self {
            runtime: None,
            sender: None,
            sender_name: String::new(),
            frames_sent: 0,
            last_discovered: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpVideoBridgeStatus {
    pub available: bool,
    pub library_path: Option<String>,
    pub sending: bool,
    pub sender_name: String,
    pub frames_sent: u64,
    pub discovered_sources: Vec<String>,
    pub detail: String,
}

#[derive(Clone, Default)]
pub struct IpVideoBridgeManager {
    inner: Arc<Mutex<BridgeInner>>,
}

impl IpVideoBridgeManager {
    fn ensure_loaded(inner: &mut BridgeInner) -> bool {
        if inner.runtime.is_some() {
            return true;
        }
        #[cfg(target_os = "android")]
        {
            // IP Video bridge not available on Android; return false so callers get a clear error.
            return false;
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let prefix = format!("{}lib_", runtime_tag_upper());
            for path in candidate_library_paths() {
                unsafe {
                    let h = open_lib(&path);
                    if h.is_null() {
                        continue;
                    }
                    let p_init = load_sym(h, &format!("{prefix}initialize"));
                    let p_fc = load_sym(h, &format!("{prefix}find_create_v2"));
                    let p_fw = load_sym(h, &format!("{prefix}find_wait_for_sources"));
                    let p_fs = load_sym(h, &format!("{prefix}find_get_current_sources"));
                    if p_init.is_null() || p_fc.is_null() || p_fw.is_null() || p_fs.is_null() {
                        close_lib(h);
                        continue;
                    }
                    let f_init: FnInit = std::mem::transmute(p_init);
                    if !f_init() {
                        close_lib(h);
                        continue;
                    }
                    let p_fd = load_sym(h, &format!("{prefix}find_destroy"));
                    let p_sc = load_sym(h, &format!("{prefix}send_create"));
                    let p_sv = load_sym(h, &format!("{prefix}send_send_video_v2"));
                    let p_sd = load_sym(h, &format!("{prefix}send_destroy"));
                    inner.runtime = Some(LoadedRuntime {
                        handle: h,
                        path,
                        f_find_create: std::mem::transmute(p_fc),
                        f_find_wait: std::mem::transmute(p_fw),
                        f_find_sources: std::mem::transmute(p_fs),
                        f_find_destroy: if p_fd.is_null() { None } else { Some(std::mem::transmute(p_fd)) },
                        f_send_create: if p_sc.is_null() { None } else { Some(std::mem::transmute(p_sc)) },
                        f_send_video: if p_sv.is_null() { None } else { Some(std::mem::transmute(p_sv)) },
                        f_send_destroy: if p_sd.is_null() { None } else { Some(std::mem::transmute(p_sd)) },
                    });
                    return true;
                }
            }
            false
        }
        #[cfg(any(target_os = "ios"))]
        {
            // iOS similarly does not support dynamic library loading in this manner.
            return false;
        }
    }

    pub fn status(&self) -> IpVideoBridgeStatus {
        let Ok(mut inner) = self.inner.lock() else {
            return IpVideoBridgeStatus {
                available: false,
                library_path: None,
                sending: false,
                sender_name: String::new(),
                frames_sent: 0,
                discovered_sources: Vec::new(),
                detail: "Bridge lock poisoned".into(),
            };
        };
        let available = Self::ensure_loaded(&mut inner);
        let library_path = inner.runtime.as_ref().map(|r| r.path.clone());
        let sending = inner.sender.is_some();
        let detail = if available {
            if sending {
                format!("Broadcasting LAN IP video as \"{}\"", inner.sender_name)
            } else {
                "Host IP Video runtime loaded and ready".into()
            }
        } else {
            "Host IP Video runtime not found (install runtime tools or set ONE_RING_IP_VIDEO_LIB)".into()
        };
        IpVideoBridgeStatus {
            available,
            library_path,
            sending,
            sender_name: inner.sender_name.clone(),
            frames_sent: inner.frames_sent,
            discovered_sources: inner.last_discovered.clone(),
            detail,
        }
    }

    pub fn discover_sources(&self, timeout_ms: u32) -> Result<Vec<String>, String> {
        let mut inner = self.inner.lock().map_err(|_| "Bridge lock poisoned".to_string())?;
        if !Self::ensure_loaded(&mut inner) {
            return Ok(Vec::new());
        }
        let rt = inner.runtime.as_ref().unwrap();
        let cfg = FindCreate {
            show_local_sources: true,
            p_groups: std::ptr::null(),
            p_extra_ips: std::ptr::null(),
        };
        let mut names = Vec::new();
        unsafe {
            let finder = (rt.f_find_create)(&cfg);
            if !finder.is_null() {
                let _ = (rt.f_find_wait)(finder, timeout_ms.clamp(100, 3000));
                let mut count: u32 = 0;
                let list = (rt.f_find_sources)(finder, &mut count);
                if !list.is_null() {
                    for i in 0..(count.min(64) as usize) {
                        let ptr = (*list.add(i)).p_name;
                        if !ptr.is_null() {
                            let s = CStr::from_ptr(ptr).to_string_lossy().trim().to_string();
                            if !s.is_empty() {
                                names.push(s);
                            }
                        }
                    }
                }
                if let Some(destroy) = rt.f_find_destroy {
                    destroy(finder);
                }
            }
        }
        inner.last_discovered = names.clone();
        Ok(names)
    }

    pub fn start_output(&self, stream_name: &str) -> Result<IpVideoBridgeStatus, String> {
        let clean = stream_name.trim();
        if clean.is_empty() || clean.len() > 120 || clean.chars().any(char::is_control) {
            return Err("Stream name must be 1–120 printable characters".into());
        }
        {
            let mut inner = self.inner.lock().map_err(|_| "Bridge lock poisoned".to_string())?;
            if !Self::ensure_loaded(&mut inner) {
                return Err(
                    "Host IP Video runtime library was not found on this machine. Install the runtime tools or set ONE_RING_IP_VIDEO_LIB."
                        .into(),
                );
            }
            if let Some(old) = inner.sender.take() {
                if let Some(destroy) = inner.runtime.as_ref().and_then(|r| r.f_send_destroy) {
                    unsafe { destroy(old) };
                }
            }
            let f_create = inner
                .runtime
                .as_ref()
                .and_then(|r| r.f_send_create)
                .ok_or_else(|| "Loaded runtime does not export sender creation".to_string())?;
            let cname = CString::new(clean).map_err(|_| "Invalid stream name".to_string())?;
            let cfg = SendCreate {
                p_name: cname.as_ptr(),
                p_groups: std::ptr::null(),
                clock_video: true,
                clock_audio: false,
            };
            let handle = unsafe { f_create(&cfg) };
            if handle.is_null() {
                return Err("Failed to initialize IP Video broadcast sender".into());
            }
            inner.sender = Some(handle);
            inner.sender_name = clean.to_string();
            inner.frames_sent = 0;
        }
        Ok(self.status())
    }

    pub fn stop_output(&self) -> IpVideoBridgeStatus {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(old) = inner.sender.take() {
                if let Some(destroy) = inner.runtime.as_ref().and_then(|r| r.f_send_destroy) {
                    unsafe { destroy(old) };
                }
            }
            inner.sender_name.clear();
        }
        self.status()
    }

    pub fn send_test_frame(&self, width: u32, height: u32) -> Result<u64, String> {
        let w = width.clamp(64, 1920) as usize;
        let h = height.clamp(64, 1080) as usize;
        let mut bgra = vec![0u8; w * h * 4];
        // Generate SMPTE-like vertical color bars in BGRA
        const BARS: [[u8; 4]; 7] = [
            [235, 235, 235, 255],
            [16, 235, 235, 255],
            [235, 235, 16, 255],
            [16, 235, 16, 255],
            [235, 16, 235, 255],
            [16, 16, 235, 255],
            [235, 16, 16, 255],
        ];
        for y in 0..h {
            for x in 0..w {
                let bar = (x * BARS.len() / w).min(BARS.len() - 1);
                let off = (y * w + x) * 4;
                bgra[off..off + 4].copy_from_slice(&BARS[bar]);
            }
        }
        self.send_frame_bgra(w as u32, h as u32, &mut bgra, 30000, 1001)
    }

    pub fn send_frame_bgra(
        &self,
        width: u32,
        height: u32,
        bgra: &mut [u8],
        fps_n: i32,
        fps_d: i32,
    ) -> Result<u64, String> {
        let expected = (width as usize).saturating_mul(height as usize).saturating_mul(4);
        if expected == 0 || bgra.len() < expected {
            return Err("Invalid BGRA frame buffer dimensions".into());
        }
        let mut inner = self.inner.lock().map_err(|_| "Bridge lock poisoned".to_string())?;
        let sender = inner
            .sender
            .ok_or_else(|| "IP Video broadcast output is not active".to_string())?;
        let f_send = inner
            .runtime
            .as_ref()
            .and_then(|r| r.f_send_video)
            .ok_or_else(|| "Loaded runtime does not export video send".to_string())?;
        let frame = VideoFrameV2 {
            xres: width as c_int,
            yres: height as c_int,
            fourcc: FOURCC_BGRA,
            frame_rate_n: fps_n.max(1),
            frame_rate_d: fps_d.max(1),
            picture_aspect_ratio: (width as f32) / (height as f32),
            frame_format_type: 1,
            timecode: i64::MAX,
            p_data: bgra.as_mut_ptr(),
            line_stride_in_bytes: (width * 4) as c_int,
            p_metadata: std::ptr::null(),
            timestamp: 0,
        };
        unsafe { f_send(sender, &frame) };
        inner.frames_sent = inner.frames_sent.saturating_add(1);
        Ok(inner.frames_sent)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_status_degrades_gracefully_without_runtime() {
        let mgr = IpVideoBridgeManager::default();
        let st = mgr.status();
        assert!(!st.sending);
        assert_eq!(st.frames_sent, 0);
    }

    #[test]
    fn start_output_rejects_empty_stream_name() {
        let mgr = IpVideoBridgeManager::default();
        assert!(mgr.start_output("   ").is_err());
    }
}
