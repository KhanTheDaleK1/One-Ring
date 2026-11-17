//! Runtime composition: configuration, live adapter registry, and normalized command routing.
//!
//! The simulator remains the default. Set `RING_LIVE=1` (or `ONE_RING_LIVE=1`) to start the live
//! adapters; each endpoint can be overridden with an environment variable:
//!
//! | Adapter | Variables | Default |
//! | :--- | :--- | :--- |
//! | X32 | `RING_X32_HOST`, `RING_X32_PORT` | disabled unless host set |
//! | OBS | `RING_OBS_URL`, `RING_OBS_PASSWORD` | `ws://127.0.0.1:4455` |
//! | Streamlabs | `RING_SLOBS_ADDR` | `127.0.0.1:28194` |
//! | ProPresenter | `RING_PP_HOST`, `RING_PP_PORT` | `127.0.0.1:50000` |
//!
//! Adapters are transport-only: they own sockets/backoff and emit the typed events in
//! [`events`]. The cue engine and Tauri commands dispatch through [`AdapterRegistry`].

pub mod dante_adapter;
pub mod events;
pub mod health;
pub mod ndi_adapter;
pub mod obs_adapter;
pub mod propresenter_adapter;
pub mod streamlabs_adapter;
pub mod x32_adapter;

use crate::protocols::{DeviceCapabilities, DeviceKind};
use crate::state::SharedState;
use dante_adapter::{DanteCommand, DanteConfig};
use events::EventSink;
use ndi_adapter::{NdiCommand, NdiConfig};
use obs_adapter::{ObsCommand, ObsConfig};
use propresenter_adapter::{ProPresenterCommand, ProPresenterConfig};
use std::sync::Arc;
use streamlabs_adapter::{StreamlabsCommand, StreamlabsConfig};
use tokio::sync::mpsc;
use x32_adapter::{X32Command, X32Config};

#[derive(Debug, Clone, Default)]
pub struct RuntimeConfig {
    pub live: bool,
    pub x32: Option<X32Config>,
    pub obs: Option<ObsConfig>,
    pub streamlabs: Option<StreamlabsConfig>,
    pub propresenter: Option<ProPresenterConfig>,
    pub dante: Option<DanteConfig>,
    pub ndi: Option<NdiConfig>,
}

impl RuntimeConfig {
    pub fn from_env() -> Self {
        let live = env_flag("RING_LIVE") || env_flag("ONE_RING_LIVE");
        if !live {
            return Self::default();
        }

        let x32 = std::env::var("RING_X32_HOST").ok().map(|host| {
            let mut config = X32Config::new(host);
            if let Some(port) = std::env::var("RING_X32_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
            {
                config.port = port;
            }
            config
        });

        let obs = Some(ObsConfig::new(
            std::env::var("RING_OBS_URL").unwrap_or_else(|_| "ws://127.0.0.1:4455".into()),
            std::env::var("RING_OBS_PASSWORD").ok(),
        ));

        let streamlabs = Some(StreamlabsConfig::new(
            std::env::var("RING_SLOBS_ADDR").unwrap_or_else(|_| "127.0.0.1:28194".into()),
        ));

        let propresenter = Some(ProPresenterConfig::new(
            std::env::var("RING_PP_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
            std::env::var("RING_PP_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(50_000),
        ));

        let dante = Some(DanteConfig::default());
        let ndi = Some(NdiConfig {
            discovery_host: std::env::var("RING_NDI_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
            ..NdiConfig::default()
        });

        Self {
            live,
            x32,
            obs,
            streamlabs,
            propresenter,
            dante,
            ndi,
        }
    }
}

fn env_flag(name: &str) -> bool {
    matches!(
        std::env::var(name).ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes")
    )
}

#[derive(Debug, Clone, PartialEq)]
pub enum AdapterCommand {
    X32(X32Command),
    Obs(ObsCommand),
    Streamlabs(StreamlabsCommand),
    ProPresenter(ProPresenterCommand),
    Dante(DanteCommand),
    Ndi(NdiCommand),
}

#[derive(Debug, Clone)]
pub struct DeviceStatus {
    pub id: &'static str,
    pub kind: DeviceKind,
    pub capabilities: DeviceCapabilities,
}

/// Owns the command senders for every started adapter and exposes a capability summary.
pub struct AdapterRegistry {
    x32: Option<mpsc::UnboundedSender<X32Command>>,
    obs: Option<mpsc::UnboundedSender<ObsCommand>>,
    streamlabs: Option<mpsc::UnboundedSender<StreamlabsCommand>>,
    propresenter: Option<mpsc::UnboundedSender<ProPresenterCommand>>,
    dante: Option<mpsc::UnboundedSender<DanteCommand>>,
    ndi: Option<mpsc::UnboundedSender<NdiCommand>>,
    devices: Vec<DeviceStatus>,
}

impl AdapterRegistry {
    /// Spawn every adapter enabled by `config`.
    pub fn start(
        config: &RuntimeConfig,
        state: SharedState,
        sink: Arc<dyn EventSink>,
    ) -> Self {
        let mut registry = Self {
            x32: None,
            obs: None,
            streamlabs: None,
            propresenter: None,
            dante: None,
            ndi: None,
            devices: Vec::new(),
        };

        if let Some(x32) = &config.x32 {
            let (tx, rx) = mpsc::unbounded_channel();
            x32_adapter::spawn(x32.clone(), state.clone(), sink.clone(), rx);
            registry.x32 = Some(tx);
            registry.devices.push(DeviceStatus {
                id: "x32",
                kind: DeviceKind::X32,
                capabilities: DeviceCapabilities::for_kind(DeviceKind::X32),
            });
            sink.log(format!(
                "[runtime] X32 adapter started for {}",
                x32.endpoint()
            ));
        }

        if let Some(obs) = &config.obs {
            let (tx, rx) = mpsc::unbounded_channel();
            obs_adapter::spawn(obs.clone(), state.clone(), sink.clone(), rx);
            registry.obs = Some(tx);
            registry.devices.push(DeviceStatus {
                id: "yt",
                kind: DeviceKind::Obs,
                capabilities: DeviceCapabilities::for_kind(DeviceKind::Obs),
            });
            sink.log(format!("[runtime] OBS adapter started for {}", obs.url));
        }

        if let Some(streamlabs) = &config.streamlabs {
            let (tx, rx) = mpsc::unbounded_channel();
            streamlabs_adapter::spawn(streamlabs.clone(), state.clone(), sink.clone(), rx);
            registry.streamlabs = Some(tx);
            registry.devices.push(DeviceStatus {
                id: "slobs",
                kind: DeviceKind::Streamlabs,
                capabilities: DeviceCapabilities::for_kind(DeviceKind::Streamlabs),
            });
            sink.log(format!(
                "[runtime] Streamlabs adapter started for {}",
                streamlabs.endpoint
            ));
        }

        if let Some(propresenter) = &config.propresenter {
            let (tx, rx) = mpsc::unbounded_channel();
            propresenter_adapter::spawn(propresenter.clone(), state.clone(), sink.clone(), rx);
            registry.propresenter = Some(tx);
            registry.devices.push(DeviceStatus {
                id: "slides",
                kind: DeviceKind::ProPresenter,
                capabilities: DeviceCapabilities::for_kind(DeviceKind::ProPresenter),
            });
            sink.log(format!(
                "[runtime] ProPresenter adapter started for {}",
                propresenter.endpoint()
            ));
        }

        if let Some(dante) = &config.dante {
            let (tx, rx) = mpsc::unbounded_channel();
            dante_adapter::spawn(dante.clone(), state.clone(), sink.clone(), rx);
            registry.dante = Some(tx);
            registry.devices.push(DeviceStatus {
                id: "dante",
                kind: DeviceKind::Dante,
                capabilities: DeviceCapabilities::for_kind(DeviceKind::Dante),
            });
            sink.log("[runtime] Dante Conmon/ARC UDP adapter started".into());
        }

        if let Some(ndi) = &config.ndi {
            let (tx, rx) = mpsc::unbounded_channel();
            ndi_adapter::spawn(ndi.clone(), state.clone(), sink.clone(), rx);
            registry.ndi = Some(tx);
            registry.devices.push(DeviceStatus {
                id: "ndi",
                kind: DeviceKind::Ndi,
                capabilities: DeviceCapabilities::for_kind(DeviceKind::Ndi),
            });
            sink.log(format!("[runtime] NDI 6 Discovery adapter started for {}", ndi.endpoint()));
        }

        registry
    }

    pub fn devices(&self) -> &[DeviceStatus] {
        &self.devices
    }

    pub fn has(&self, kind: DeviceKind) -> bool {
        self.devices.iter().any(|d| d.kind == kind)
    }

    /// Route a normalized command. Returns `false` when no live adapter owns that domain, which
    /// lets the cue engine fall back to simulator state or report a degraded capability.
    pub fn dispatch(&self, command: AdapterCommand) -> bool {
        match command {
            AdapterCommand::X32(command) => self
                .x32
                .as_ref()
                .map(|tx| tx.send(command).is_ok())
                .unwrap_or(false),
            AdapterCommand::Obs(command) => self
                .obs
                .as_ref()
                .map(|tx| tx.send(command).is_ok())
                .unwrap_or(false),
            AdapterCommand::Streamlabs(command) => self
                .streamlabs
                .as_ref()
                .map(|tx| tx.send(command).is_ok())
                .unwrap_or(false),
            AdapterCommand::Dante(command) => self
                .dante
                .as_ref()
                .map(|tx| tx.send(command).is_ok())
                .unwrap_or(false),
            AdapterCommand::Ndi(command) => self
                .ndi
                .as_ref()
                .map(|tx| tx.send(command).is_ok())
                .unwrap_or(false),
            AdapterCommand::ProPresenter(command) => self
                .propresenter
                .as_ref()
                .map(|tx| tx.send(command).is_ok())
                .unwrap_or(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::events::RecordingSink;
    use crate::state::{default_simulator_state, SharedState};
    use std::sync::{Arc, Mutex};

    fn state() -> SharedState {
        Arc::new(Mutex::new(default_simulator_state()))
    }

    #[test]
    fn mock_runtime_starts_no_adapters() {
        let sink = Arc::new(RecordingSink::new());
        let registry = AdapterRegistry::start(&RuntimeConfig::default(), state(), sink);
        assert!(registry.devices().is_empty());
        assert!(!registry.dispatch(AdapterCommand::X32(X32Command::Identify)));
    }

    #[tokio::test]
    async fn registry_advertises_capabilities() {
        let sink = Arc::new(RecordingSink::new());
        let config = RuntimeConfig {
            live: true,
            x32: Some(X32Config::new("127.0.0.1")),
            ..RuntimeConfig::default()
        };
        let registry = AdapterRegistry::start(&config, state(), sink);
        assert!(registry.has(DeviceKind::X32));
        let device = &registry.devices()[0];
        assert!(device.capabilities.meters);
        assert!(device.capabilities.scene_recall);
    }

    #[test]
    fn dispatch_to_missing_adapter_is_false() {
        let sink = Arc::new(RecordingSink::new());
        let registry = AdapterRegistry::start(&RuntimeConfig::default(), state(), sink);
        assert!(!registry.dispatch(AdapterCommand::Obs(ObsCommand::Refresh)));
        assert!(!registry.dispatch(AdapterCommand::ProPresenter(
            ProPresenterCommand::Next
        )));
    }
}
