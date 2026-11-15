//! Typed event contract between the backend adapters and the Tauri frontend.
//!
//! The frontend hydrates once via `get_app_state`, then applies:
//!
//! * `device://health`  — connection state transitions only (no per-frame chatter).
//! * `meter://<domain>` — throttled, coalesced, latest-wins meter frames.
//! * `state://<domain>` — partial state patches, never full snapshots.
//! * `cue://progress`   — per-step cue execution telemetry.
//!
//! Keeping these types transport-agnostic means the adapters can be unit-tested against an
//! in-memory [`EventSink`] without a Tauri runtime.

use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};

pub const HEALTH_CHANNEL: &str = "device://health";
pub const CUE_CHANNEL: &str = "cue://progress";
pub const STATE_CHANNEL_PREFIX: &str = "state://";
pub const METER_CHANNEL_PREFIX: &str = "meter://";

static REVISION: AtomicU64 = AtomicU64::new(1);

/// Monotonic patch revision so the frontend can drop out-of-order deliveries.
pub fn next_revision() -> u64 {
    REVISION.fetch_add(1, Ordering::Relaxed)
}

/// A transition in a device's connection lifecycle.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HealthEvent {
    pub device_id: String,
    pub kind: String,
    pub label: String,
    /// `"ok" | "warn" | "error" | "connecting" | "offline"`
    pub status: String,
    pub detail: String,
    pub protocol: String,
    pub latency_ms: u32,
}

impl HealthEvent {
    pub fn new(
        device_id: impl Into<String>,
        kind: impl Into<String>,
        label: impl Into<String>,
        status: impl Into<String>,
        detail: impl Into<String>,
        protocol: impl Into<String>,
        latency_ms: u32,
    ) -> Self {
        Self {
            device_id: device_id.into(),
            kind: kind.into(),
            label: label.into(),
            status: status.into(),
            detail: detail.into(),
            protocol: protocol.into(),
            latency_ms,
        }
    }
}

/// One meter value inside a [`MeterEvent`].
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MeterChannel {
    /// Stable key, e.g. `dca1`, `ch01`, `main_st`.
    pub key: String,
    pub label: String,
    /// `None` means silence / `-∞` / muted.
    pub db: Option<f32>,
    pub peak: bool,
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MeterEvent {
    pub device_id: String,
    /// `"x32"` or `"dante"`.
    pub domain: String,
    pub sequence: u64,
    pub captured_at_ms: u64,
    pub channels: Vec<MeterChannel>,
}

impl MeterEvent {
    pub fn new(device_id: impl Into<String>, domain: impl Into<String>, sequence: u64, channels: Vec<MeterChannel>) -> Self {
        Self {
            device_id: device_id.into(),
            domain: domain.into(),
            sequence,
            captured_at_ms: now_ms(),
            channels,
        }
    }
}

/// A domain-scoped partial update. `patch` is a JSON object whose keys match the camelCase
/// fields of `AppStateSnapshot`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatePatch {
    pub domain: String,
    pub revision: u64,
    pub patch: Value,
}

impl StatePatch {
    pub fn new(domain: impl Into<String>, patch: Value) -> Self {
        Self {
            domain: domain.into(),
            revision: next_revision(),
            patch,
        }
    }

    pub fn full(domain: impl Into<String>) -> Self {
        Self::new(domain, json!({}))
    }
}

/// Per-step cue telemetry. `status` is one of `pending | running | applied | rehearsal | drift |
/// failed`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CueProgressEvent {
    pub cue_index: usize,
    pub step_index: usize,
    pub total_steps: usize,
    pub domain: String,
    pub status: String,
    pub elapsed_ms: u64,
    pub error: Option<String>,
}

impl CueProgressEvent {
    pub fn new(
        cue_index: usize,
        step_index: usize,
        total_steps: usize,
        domain: impl Into<String>,
        status: impl Into<String>,
        elapsed_ms: u64,
    ) -> Self {
        Self {
            cue_index,
            step_index,
            total_steps,
            domain: domain.into(),
            status: status.into(),
            elapsed_ms,
            error: None,
        }
    }

    pub fn with_error(mut self, error: impl Into<String>) -> Self {
        self.error = Some(error.into());
        self
    }
}

/// The backend's outbound event surface. Implemented by the Tauri emitter in `lib.rs` and by an
/// in-memory recorder in tests.
pub trait EventSink: Send + Sync + 'static {
    fn health(&self, event: HealthEvent);
    fn meter(&self, event: MeterEvent);
    fn state(&self, patch: StatePatch);
    fn cue_progress(&self, event: CueProgressEvent);
    /// Append an operator-facing log line (adapters never write to stdout for this).
    fn log(&self, line: String);
}

/// Convenience: emit a `state://<domain>` patch built from an explicit JSON object.
pub fn state_patch(domain: &str, patch: Value) -> StatePatch {
    StatePatch::new(domain, patch)
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Simple rate limiter used by meter producers. Adapters keep only the latest frame and flush at
/// most `min_interval`.
#[derive(Debug)]
pub struct MeterLimiter {
    min_interval: std::time::Duration,
    last: Option<std::time::Instant>,
}

impl MeterLimiter {
    pub fn new(hz: u32) -> Self {
        let hz = hz.max(1);
        Self {
            min_interval: std::time::Duration::from_millis(1000 / hz as u64),
            last: None,
        }
    }

    pub fn ready(&mut self) -> bool {
        let now = std::time::Instant::now();
        match self.last {
            Some(last) if now.duration_since(last) < self.min_interval => false,
            _ => {
                self.last = Some(now);
                true
            }
        }
    }
}

/// Test sink that records every event so adapter behaviour can be asserted without Tauri.
#[derive(Debug, Default)]
pub struct RecordingSink {
    inner: std::sync::Mutex<RecordedEvents>,
}

#[derive(Debug, Default)]
pub struct RecordedEvents {
    pub health: Vec<HealthEvent>,
    pub meters: Vec<MeterEvent>,
    pub states: Vec<StatePatch>,
    pub cues: Vec<CueProgressEvent>,
    pub logs: Vec<String>,
}

impl RecordingSink {
    pub fn new() -> Self {
        Self::default()
    }

    /// Borrow this recorder as the trait object adapters expect.
    pub fn as_event_sink(self: &std::sync::Arc<Self>) -> std::sync::Arc<dyn EventSink> {
        self.clone()
    }

    pub fn snapshot(&self) -> std::sync::MutexGuard<'_, RecordedEvents> {
        self.inner.lock().unwrap()
    }
}

impl EventSink for RecordingSink {
    fn health(&self, event: HealthEvent) {
        self.inner.lock().unwrap().health.push(event);
    }

    fn meter(&self, event: MeterEvent) {
        self.inner.lock().unwrap().meters.push(event);
    }

    fn state(&self, patch: StatePatch) {
        self.inner.lock().unwrap().states.push(patch);
    }

    fn cue_progress(&self, event: CueProgressEvent) {
        self.inner.lock().unwrap().cues.push(event);
    }

    fn log(&self, line: String) {
        self.inner.lock().unwrap().logs.push(line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revisions_are_monotonic() {
        let a = next_revision();
        let b = next_revision();
        assert!(b > a);
    }

    #[test]
    fn patch_serializes_camel_case() {
        let patch = state_patch("x32", json!({ "obsScene": "Pulpit" }));
        let text = serde_json::to_string(&patch).unwrap();
        assert!(text.contains("\"domain\":\"x32\""));
        assert!(text.contains("\"obsScene\":\"Pulpit\""));
        assert!(text.contains("\"revision\":"));
    }

    #[test]
    fn meter_limiter_drops_fast_frames() {
        let mut limiter = MeterLimiter::new(20);
        assert!(limiter.ready());
        assert!(!limiter.ready());
    }

    #[test]
    fn recording_sink_captures_all_channels() {
        let sink = RecordingSink::new();
        sink.health(HealthEvent::new("x32", "X32", "X32", "ok", "live", "OSC", 2));
        sink.cue_progress(CueProgressEvent::new(0, 0, 4, "x32", "applied", 3));
        sink.log("hello".into());
        let events = sink.snapshot();
        assert_eq!(events.health.len(), 1);
        assert_eq!(events.cues.len(), 1);
        assert_eq!(events.logs, vec!["hello"]);
    }
}
