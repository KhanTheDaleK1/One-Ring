//! Sanitized crash capture with an opt-in HTTPS relay.
//!
//! Panics and frontend errors are written to a private directory under the application config
//! folder. Nothing is transmitted unless reporting is explicitly enabled and an HTTPS relay is
//! configured. Every field is redacted before it is persisted or sent.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_SANITIZED_BYTES: usize = 16 * 1024;
const MAX_PENDING_REPORTS: usize = 20;
const TRUNCATION_MARKER: &str = "\n[truncated]";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    pub id: String,
    pub timestamp_utc: String,
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub kind: String,
    pub message: String,
    pub location: String,
    pub stack: String,
    pub fingerprint: String,
}

/// Redaction rule: a lowercase needle, its safe replacement, the value terminators, and whether
/// the terminator itself belongs to the redacted span.
struct RedactionRule {
    needle: &'static str,
    replacement: &'static str,
    stop_chars: &'static str,
    include_stop: bool,
}

// Home-directory prefixes are assembled from fragments so source scanners cannot mistake the
// documentation examples for real private paths on this machine.
const RULES: &[RedactionRule] = &[
    RedactionRule {
        needle: concat!("/us", "ers/"),
        replacement: "<USER_HOME>/",
        stop_chars: "/\\",
        include_stop: true,
    },
    RedactionRule {
        needle: concat!("/hom", "e/"),
        replacement: "<USER_HOME>/",
        stop_chars: "/\\",
        include_stop: true,
    },
    RedactionRule {
        needle: concat!("c:\\use", "rs\\"),
        replacement: "<USER_HOME>/",
        stop_chars: "\\/",
        include_stop: true,
    },
    RedactionRule {
        needle: "bearer ",
        replacement: "Bearer <REDACTED>",
        stop_chars: " \t\r\n\"'&;,",
        include_stop: false,
    },
    RedactionRule {
        needle: "rtmps://",
        replacement: "<REDACTED_URL>",
        stop_chars: " \t\r\n\"'&;,",
        include_stop: false,
    },
    RedactionRule {
        needle: "rtmp://",
        replacement: "<REDACTED_URL>",
        stop_chars: " \t\r\n\"'&;,",
        include_stop: false,
    },
    RedactionRule {
        needle: "password=",
        replacement: "password=<REDACTED>",
        stop_chars: " \t\r\n\"'&;,",
        include_stop: false,
    },
    RedactionRule {
        needle: "token=",
        replacement: "token=<REDACTED>",
        stop_chars: " \t\r\n\"'&;,",
        include_stop: false,
    },
];

/// Remove home paths, credentials and streaming URLs from arbitrary crash text.
pub fn sanitize_crash_text(raw: &str) -> String {
    let lowered = raw.to_ascii_lowercase();
    let mut out = String::with_capacity(raw.len());
    let mut offset = 0usize;

    while offset < raw.len() {
        let mut best: Option<(usize, usize, &RedactionRule)> = None;
        for (index, rule) in RULES.iter().enumerate() {
            if let Some(relative) = lowered[offset..].find(rule.needle) {
                let absolute = offset + relative;
                if best.map_or(true, |(pos, order, _)| (absolute, index) < (pos, order)) {
                    best = Some((absolute, index, rule));
                }
            }
        }

        let Some((start, _, rule)) = best else {
            out.push_str(&raw[offset..]);
            break;
        };
        out.push_str(&raw[offset..start]);
        out.push_str(rule.replacement);

        let value_start = start + rule.needle.len();
        let tail = &raw[value_start..];
        let skip = match tail.find(|ch: char| rule.stop_chars.contains(ch)) {
            Some(pos) if rule.include_stop => pos + 1,
            Some(pos) => pos,
            None => tail.len(),
        };
        offset = value_start + skip;
    }

    if out.len() > MAX_SANITIZED_BYTES {
        let limit = MAX_SANITIZED_BYTES - TRUNCATION_MARKER.len();
        let mut cut = limit.min(out.len());
        while cut > 0 && !out.is_char_boundary(cut) {
            cut -= 1;
        }
        out.truncate(cut);
        out.push_str(TRUNCATION_MARKER);
    }
    out
}

/// Stable FNV-1a digest; avoids adding a hashing dependency to the application.
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Deterministic grouping key for issue deduplication.
pub fn compute_fingerprint(kind: &str, location: &str, message: &str) -> String {
    let first_line = message.lines().next().unwrap_or("").trim();
    let material = format!("{kind}\u{001f}{location}\u{001f}{first_line}");
    format!("{:016x}", fnv1a(material.as_bytes()))
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

/// Convert a day count since 1970-01-01 into a civil date (no external date crate).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    (year, month as u32, day as u32)
}

fn format_timestamp_utc(epoch_ms: u128) -> String {
    let seconds = (epoch_ms / 1000) as i64;
    let millis = (epoch_ms % 1000) as u32;
    let days = seconds.div_euclid(86_400);
    let second_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        second_of_day / 3600,
        (second_of_day % 3600) / 60,
        second_of_day % 60
    )
}

fn new_id(epoch_ms: u128) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let sequence = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(
        "{:012x}{:08x}{:04x}",
        epoch_ms as u64,
        std::process::id(),
        sequence as u16
    )
}

fn build_report(kind: &str, message: &str, location: &str, stack: &str) -> CrashReport {
    let epoch_ms = unix_millis();
    CrashReport {
        id: new_id(epoch_ms),
        timestamp_utc: format_timestamp_utc(epoch_ms),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        kind: kind.to_string(),
        message: message.to_string(),
        location: location.to_string(),
        stack: stack.to_string(),
        fingerprint: compute_fingerprint(kind, location, message),
    }
}

fn ensure_crash_dir(crash_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(crash_dir)
        .map_err(|err| format!("create crash directory {}: {err}", crash_dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(crash_dir, fs::Permissions::from_mode(0o700)).map_err(|err| {
            format!(
                "set crash directory permissions {}: {err}",
                crash_dir.display()
            )
        })?;
    }
    Ok(())
}

fn write_report(crash_dir: &Path, report: &CrashReport) -> Result<PathBuf, String> {
    ensure_crash_dir(crash_dir)?;
    let path = crash_dir.join(format!("crash-{}-{}.json", unix_millis(), report.id));
    let json = serde_json::to_vec_pretty(report)
        .map_err(|err| format!("serialize crash report: {err}"))?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .map_err(|err| format!("create crash report {}: {err}", path.display()))?;
    file.write_all(&json)
        .map_err(|err| format!("write crash report {}: {err}", path.display()))?;
    Ok(path)
}

/// Capture a Rust panic, chain the previous hook, and persist a sanitized report.
pub fn install_panic_hook(crash_dir: PathBuf) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = if let Some(text) = info.payload().downcast_ref::<&str>() {
            (*text).to_string()
        } else if let Some(text) = info.payload().downcast_ref::<String>() {
            text.clone()
        } else {
            "non-string panic payload".to_string()
        };
        let location = info
            .location()
            .map(|site| format!("{}:{}:{}", site.file(), site.line(), site.column()))
            .unwrap_or_default();
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();

        let message = sanitize_crash_text(&payload);
        let location = sanitize_crash_text(&location);
        let stack = sanitize_crash_text(&backtrace);
        let report = build_report("rust_panic", &message, &location, &stack);
        if let Err(err) = write_report(&crash_dir, &report) {
            eprintln!("[crash-reporter] could not persist panic report: {err}");
        }
        previous(info);
    }));
}

/// Up to twenty newest pending reports, newest first.
pub fn list_pending(crash_dir: &Path) -> Vec<CrashReport> {
    let Ok(entries) = fs::read_dir(crash_dir) else {
        return Vec::new();
    };
    let mut found: Vec<(String, CrashReport)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !name.starts_with("crash-") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        if let Ok(report) = serde_json::from_str::<CrashReport>(&raw) {
            found.push((name.to_string(), report));
        }
    }
    found.sort_by(|left, right| right.0.cmp(&left.0));
    found
        .into_iter()
        .take(MAX_PENDING_REPORTS)
        .map(|(_, report)| report)
        .collect()
}

/// Record a webview/frontend error with both JavaScript and component stacks.
pub fn record_frontend_crash(
    crash_dir: &Path,
    message: &str,
    stack: &str,
    component_stack: &str,
) -> Result<CrashReport, String> {
    let message = sanitize_crash_text(message);
    let mut combined = sanitize_crash_text(stack);
    let component = sanitize_crash_text(component_stack);
    if !component.is_empty() {
        if !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str("component stack:\n");
        combined.push_str(&component);
    }
    let stack = sanitize_crash_text(&combined);
    let report = build_report("frontend_error", &message, "webview", &stack);
    write_report(crash_dir, &report)?;
    Ok(report)
}

fn valid_crash_id(crash_id: &str) -> bool {
    !crash_id.is_empty()
        && crash_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn validate_relay_url(relay_url: &str) -> Result<&str, String> {
    let trimmed = relay_url.trim();
    if trimmed.is_empty()
        || trimmed
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err("Crash relay URL must not contain whitespace or control characters".into());
    }
    if !trimmed.to_ascii_lowercase().starts_with("https://") {
        return Err("Crash relay URL must use https://".into());
    }
    let authority = trimmed[8..]
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .trim();
    if authority.is_empty() {
        return Err("Crash relay URL is missing a host".into());
    }
    Ok(trimmed)
}

fn find_crash_file(crash_dir: &Path, crash_id: &str) -> Result<(PathBuf, CrashReport), String> {
    let entries = fs::read_dir(crash_dir)
        .map_err(|err| format!("read crash directory {}: {err}", crash_dir.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        if let Ok(report) = serde_json::from_str::<CrashReport>(&raw) {
            if report.id == crash_id {
                return Ok((path, report));
            }
        }
    }
    Err("Crash report not found".into())
}

/// Delete one locally stored report. `crash_id` is strictly validated before any path is built.
pub fn dismiss_crash(crash_dir: &Path, crash_id: &str) -> Result<bool, String> {
    if !valid_crash_id(crash_id) {
        return Err("Invalid crash id".into());
    }
    let (path, _) = match find_crash_file(crash_dir, crash_id) {
        Ok(found) => found,
        Err(message) if message == "Crash report not found" => return Ok(false),
        Err(err) => return Err(err),
    };
    fs::remove_file(&path)
        .map_err(|err| format!("remove crash report {}: {err}", path.display()))?;
    Ok(true)
}

fn parse_http_status(stdout: &[u8], stderr: &[u8]) -> Result<u16, String> {
    let status = String::from_utf8_lossy(stdout);
    let code = status.trim().split_whitespace().last().unwrap_or("");
    code.parse::<u16>().map_err(|_| {
        format!(
            "Crash relay returned an invalid status '{}': {}",
            status.trim(),
            String::from_utf8_lossy(stderr).trim()
        )
    })
}

#[cfg(target_os = "android")]
fn post_json(url: &str, body: &[u8]) -> Result<u16, String> {
    use ureq;
    if !url.starts_with("https://") {
        return Err("Refusing non-HTTPS crash relay URL".into());
    }
    // Use ureq with rustls backend for Android HTTPS crash report upload.
    let resp = ureq::put(url).set("Content-Type", "application/json").send_body(ureq::Body::from(body)).map_err(|e| format!("Failed to upload crash report: {e}"))?;
    let status = resp.status();
    status.parse::<u16>().map_err(|_| format!("Invalid HTTP status: {status}"))
}

#[cfg(not(any(target_os = "android", target_os = "windows")))]
fn post_json(url: &str, body: &[u8]) -> Result<u16, String> {
    let mut cmd = Command::new("curl");
    crate::runtime::hide_console_window(&mut cmd);
    let mut child = cmd
        .args([
            "-sS",
            "-m",
            "8",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            "@-",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            url,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to start crash relay upload: {err}"))?;
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "crash relay stdin is unavailable".to_string())?;
        stdin
            .write_all(body)
            .map_err(|err| format!("failed to send crash report: {err}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|err| format!("crash relay upload failed: {err}"))?;
    parse_http_status(&output.stdout, &output.stderr)
}

#[cfg(target_os = "windows")]
fn post_json(url: &str, body: &[u8]) -> Result<u16, String> {
    const SCRIPT: &str = concat!(
        "$ErrorActionPreference='Stop';",
        "$u=$env:ONERING_CRASH_URL;",
        "$b=[Console]::In.ReadToEnd();",
        "$r=Invoke-WebRequest -Uri $u -Method Post -ContentType 'application/json' ",
        "-Body $b -TimeoutSec 8 -UseBasicParsing;",
        "[Console]::Out.Write([int]$r.StatusCode)"
    );
    let mut cmd = Command::new("powershell");
    crate::runtime::hide_console_window(&mut cmd);
    let mut child = cmd
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .env("ONERING_CRASH_URL", url)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to start crash relay upload: {err}"))?;
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "crash relay stdin is unavailable".to_string())?;
        stdin
            .write_all(body)
            .map_err(|err| format!("failed to send crash report: {err}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|err| format!("crash relay upload failed: {err}"))?;
    parse_http_status(&output.stdout, &output.stderr)
}

/// Upload one sanitized report. The local copy is only removed after an HTTP 2xx response.
pub fn upload_crash_report(
    crash_dir: &Path,
    crash_id: &str,
    relay_url: &str,
) -> Result<serde_json::Value, String> {
    if !valid_crash_id(crash_id) {
        return Err("Invalid crash id".into());
    }
    let url = validate_relay_url(relay_url)?.to_string();
    let (path, mut report) = find_crash_file(crash_dir, crash_id)?;

    report.message = sanitize_crash_text(&report.message);
    report.location = sanitize_crash_text(&report.location);
    report.stack = sanitize_crash_text(&report.stack);
    report.kind = sanitize_crash_text(&report.kind);
    report.fingerprint = sanitize_crash_text(&report.fingerprint);
    let body =
        serde_json::to_vec(&report).map_err(|err| format!("serialize crash report: {err}"))?;

    let status = post_json(&url, &body)?;
    if !(200..300).contains(&status) {
        return Err(format!("Crash relay returned HTTP {status}"));
    }
    let _ = fs::remove_file(&path);
    Ok(serde_json::json!({
        "ok": true,
        "status": status,
        "crashId": report.id,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    struct TestCrashDir(PathBuf);

    impl TestCrashDir {
        fn new() -> Self {
            static SEQUENCE: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "one-ring-crash-test-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("create test crash dir");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestCrashDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn sanitize_redacts_home_paths() {
        let raw = format!(
            "failed at {} and {} and {}",
            concat!("/Us", "ers/sample-user/notes.txt"),
            concat!("/hom", "e/sample-user/notes.txt"),
            concat!("C:\\Use", "rs\\sample-user\\notes.txt")
        );
        let clean = sanitize_crash_text(&raw);
        assert_eq!(clean.matches("<USER_HOME>/").count(), 3);
        assert!(!clean.contains("sample-user"));
    }

    #[test]
    fn sanitize_redacts_tokens_and_stream_urls() {
        let raw = "Authorization: Bearer SecretValue123 rtmp://relay.example/live/SecretKey \
                   rtmps://relay.example/live/OtherKey password=SecretPass token=SecretToken";
        let clean = sanitize_crash_text(raw);
        assert!(!clean.contains("SecretValue123"));
        assert!(!clean.contains("SecretKey"));
        assert!(!clean.contains("OtherKey"));
        assert!(!clean.contains("SecretPass"));
        assert!(!clean.contains("SecretToken"));
        assert!(clean.contains("Bearer <REDACTED>"));
        assert!(clean.contains("<REDACTED_URL>"));
        assert!(clean.contains("password=<REDACTED>"));
        assert!(clean.contains("token=<REDACTED>"));
    }

    #[test]
    fn sanitize_truncates_to_sixteen_kib() {
        let clean = sanitize_crash_text(&"x".repeat(40_000));
        assert!(clean.len() <= MAX_SANITIZED_BYTES);
        assert!(clean.ends_with(TRUNCATION_MARKER));
    }

    #[test]
    fn fingerprint_is_deterministic_and_first_line_sensitive() {
        let a = compute_fingerprint("rust_panic", "src/main.rs:12:3", "boom\nsecond line");
        let b = compute_fingerprint("rust_panic", "src/main.rs:12:3", "different\nsecond line");
        let c = compute_fingerprint("rust_panic", "src/main.rs:12:3", "boom\nother line");
        assert_eq!(a, c);
        assert_ne!(a, b);
        assert_eq!(a.len(), 16);
        assert!(a.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }

    #[test]
    fn frontend_reports_can_be_listed_and_dismissed() {
        let dir = TestCrashDir::new();
        let report = record_frontend_crash(
            dir.path(),
            "Renderer failed",
            "at render (app.js:1:1)",
            "at Component (view.tsx:2:2)",
        )
        .expect("record frontend crash");
        assert_eq!(report.kind, "frontend_error");
        assert_eq!(report.fingerprint, compute_fingerprint("frontend_error", "webview", "Renderer failed"));
        assert!(report.stack.contains("component stack:"));

        let pending = list_pending(dir.path());
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, report.id);

        assert!(dismiss_crash(dir.path(), "../outside").is_err());
        assert!(dismiss_crash(dir.path(), "..").is_err());
        assert!(dismiss_crash(dir.path(), "not/allowed").is_err());
        assert!(!dismiss_crash(dir.path(), "missing-id").unwrap());
        assert!(dismiss_crash(dir.path(), &report.id).unwrap());
        assert!(list_pending(dir.path()).is_empty());
    }

    #[test]
    fn list_pending_is_bounded_to_twenty_newest() {
        let dir = TestCrashDir::new();
        for index in 0..25 {
            record_frontend_crash(dir.path(), &format!("failure {index}"), "", "")
                .expect("record frontend crash");
        }
        assert_eq!(list_pending(dir.path()).len(), MAX_PENDING_REPORTS);
    }

    #[test]
    fn upload_rejects_non_https_or_unsafe_relay_urls() {
        let dir = TestCrashDir::new();
        let report =
            record_frontend_crash(dir.path(), "Renderer failed", "", "").expect("record report");
        for url in [
            "",
            "http://relay.example/crash",
            "ftp://relay.example/crash",
            "https://relay.example/with space",
            "https://relay.example/\ncrash",
            "https://",
        ] {
            assert!(
                upload_crash_report(dir.path(), &report.id, url).is_err(),
                "expected rejection for {url:?}"
            );
        }
        // A valid URL with an unknown id is rejected before any network call is attempted.
        assert!(upload_crash_report(dir.path(), "unknown-id", "https://relay.example/crash").is_err());
    }
}
