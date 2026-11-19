//! Health state machine shared by every live adapter.
//!
//! The supervisor rules from `docs/ARCHITECTURE.md` §3.2 are applied here: adapters report
//! `connecting → ok → warn/error → offline`, and [`HealthReporter`] emits a `device://health`
//! event only when the status or detail actually changes, while keeping the hydrated
//! `AppStateSnapshot.health` rows in sync.

use crate::runtime::events::{EventSink, HealthEvent};
use crate::state::{with_state, SharedState};
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdapterState {
    Connecting,
    Ready,
    Degraded,
    Error,
    Offline,
}

impl AdapterState {
    pub fn as_str(self) -> &'static str {
        match self {
            AdapterState::Connecting => "connecting",
            AdapterState::Ready => "ok",
            AdapterState::Degraded => "warn",
            AdapterState::Error => "error",
            AdapterState::Offline => "error",
        }
    }
}

pub struct HealthReporter {
    device_id: String,
    kind: String,
    label: String,
    protocol: String,
    state: SharedState,
    sink: std::sync::Arc<dyn EventSink>,
    last: Mutex<Option<(String, String)>>,
}

impl HealthReporter {
    pub fn new(
        device_id: impl Into<String>,
        kind: impl Into<String>,
        label: impl Into<String>,
        protocol: impl Into<String>,
        state: SharedState,
        sink: std::sync::Arc<dyn EventSink>,
    ) -> Self {
        Self {
            device_id: device_id.into(),
            kind: kind.into(),
            label: label.into(),
            protocol: protocol.into(),
            state,
            sink,
            last: Mutex::new(None),
        }
    }

    pub fn connecting(&self, detail: impl Into<String>) {
        self.set(AdapterState::Connecting, detail.into(), 0);
    }

    pub fn ready(&self, detail: impl Into<String>, latency_ms: u32) {
        self.set(AdapterState::Ready, detail.into(), latency_ms);
    }

    pub fn degraded(&self, detail: impl Into<String>) {
        self.set(AdapterState::Degraded, detail.into(), 0);
    }

    pub fn error(&self, detail: impl Into<String>) {
        self.set(AdapterState::Error, detail.into(), 0);
    }

    pub fn offline(&self, detail: impl Into<String>) {
        self.set(AdapterState::Offline, detail.into(), 0);
    }

    fn set(&self, status: AdapterState, detail: String, latency_ms: u32) {
        let status = status.as_str().to_string();
        {
            let mut last = self.last.lock().unwrap();
            if last.as_ref() == Some(&(status.clone(), detail.clone())) {
                return;
            }
            *last = Some((status.clone(), detail.clone()));
        }

        with_state(&self.state, |snapshot| {
            snapshot.set_health(
                &self.device_id,
                &self.label,
                &status,
                &detail,
                &self.protocol,
                latency_ms,
            );
        });

        self.sink.health(HealthEvent::new(
            self.device_id.clone(),
            self.kind.clone(),
            self.label.clone(),
            status,
            detail,
            self.protocol.clone(),
            latency_ms,
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::events::RecordingSink;
    use crate::state::{default_simulator_state, SharedState};
    use std::sync::{Arc, Mutex};

    fn fixture() -> (HealthReporter, SharedState, Arc<RecordingSink>) {
        let state: SharedState = Arc::new(Mutex::new(default_simulator_state()));
        let sink = Arc::new(RecordingSink::new());
        let reporter = HealthReporter::new(
            "console-test",
            "Console",
            "Console",
            "OSC",
            state.clone(),
            sink.clone(),
        );
        (reporter, state, sink)
    }

    #[test]
    fn emits_only_on_transition() {
        let (reporter, _, sink) = fixture();
        reporter.connecting("dialing");
        reporter.ready("live", 2);
        reporter.ready("live", 2);
        reporter.degraded("no packets");
        assert_eq!(sink.snapshot().health.len(), 3);
    }

    #[test]
    fn keeps_hydrated_health_in_sync() {
        let (reporter, state, _) = fixture();
        reporter.ready("live", 7);
        let health = with_state(&state, |s| s.health.clone());
        assert!(health.iter().any(|h| h.id == "console-test" && h.status == "ok" && h.latency_ms == 7));
    }
}
