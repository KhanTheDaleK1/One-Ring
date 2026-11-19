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
//! | EasyWorship | `RING_EZW_HOST`, `RING_EZW_PORT`, `RING_EZW_DISCOVER=1` | mDNS `_ezwremote._tcp` |
//!
//! Adapters are transport-only: they own sockets/backoff and emit the typed events in
//! [`events`]. The cue engine and Tauri commands dispatch through [`AdapterRegistry`].

pub mod dante_adapter;
pub mod easyworship_adapter;
pub mod events;
pub mod health;
pub mod ndi_adapter;
pub mod obs_adapter;
pub mod obs_daemon;
pub mod obs_worker_ipc;
pub mod propresenter_adapter;
pub mod streamlabs_adapter;
pub mod x32_adapter;

use crate::protocols::{DeviceCapabilities, DeviceKind};
use crate::state::SharedState;
use dante_adapter::{DanteCommand, DanteConfig};
use easyworship_adapter::{EasyWorshipCommand, EasyWorshipConfig, EasyWorshipImageCache};
use events::EventSink;
use ndi_adapter::{NdiCommand, NdiConfig};
use obs_adapter::{ObsCommand, ObsConfig};
use propresenter_adapter::{ProPresenterCommand, ProPresenterConfig};
use std::sync::{Arc, Mutex};
use streamlabs_adapter::{StreamlabsCommand, StreamlabsConfig};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use x32_adapter::{X32Command, X32Config};

#[derive(Debug, Clone, Default)]
pub struct RuntimeConfig {
    pub live: bool,
    pub x32: Option<X32Config>,
    pub obs: Option<ObsConfig>,
    pub streamlabs: Option<StreamlabsConfig>,
    pub propresenter: Option<ProPresenterConfig>,
    pub easyworship: Option<EasyWorshipConfig>,
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

        let obs = Some(obs_config_from_env());

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

        // EasyWorship's listener uses an ephemeral port, so mDNS is the default when live mode is
        // on. A static `RING_EZW_HOST`/`RING_EZW_PORT` (or full `RING_EZW_ENDPOINT`) overrides it.
        let easyworship = if let Ok(endpoint) = std::env::var("RING_EZW_ENDPOINT") {
            Some(EasyWorshipConfig::new(endpoint))
        } else if let Ok(host) = std::env::var("RING_EZW_HOST") {
            let port = std::env::var("RING_EZW_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(55_000);
            Some(EasyWorshipConfig::new(format!("{host}:{port}")))
        } else if env_flag("RING_EZW_DISCOVER") {
            Some(EasyWorshipConfig::discovered())
        } else {
            None
        };

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
            easyworship,
            dante,
            ndi,
        }
    }

    /// Build a runtime configuration merging environment overrides with persisted Settings UI values.
    /// If `RING_LIVE` is unset, live adapters still activate automatically when the user configures
    /// hardware endpoints (e.g. X32 IP or NDI discovery host) in Settings.
    pub fn from_env_and_settings(settings: &crate::state::AppSettings) -> Self {
        let mut cfg = Self::from_env();
        let x32_ip = settings.x32.ip_address.trim();
        if cfg.x32.is_none() && !x32_ip.is_empty() {
            let mut x = X32Config::new(x32_ip);
            if settings.x32.osc_port > 0 {
                x.port = settings.x32.osc_port;
            }
            cfg.x32 = Some(x);
            cfg.live = true;
        }
        let ndi_host = settings.ndi_ptz.discovery_range_start.trim();
        if cfg.ndi.is_none() && !ndi_host.is_empty() {
            cfg.ndi = Some(NdiConfig {
                discovery_host: ndi_host.to_string(),
                ..NdiConfig::default()
            });
            cfg.live = true;
        }
        if cfg.live && cfg.dante.is_none() {
            cfg.dante = Some(DanteConfig {
                meter_port: if settings.dante.conmon_meter_port > 0 {
                    settings.dante.conmon_meter_port
                } else {
                    dante_adapter::DANTE_CONMON_METER_PORT
                },
                ..DanteConfig::default()
            });
        }
        // Broadcast destinations still need an OBS adapter even when RING_LIVE is not set, so
        // the Settings UI can drive real streams. Do this after the Dante decision so a
        // broadcast-only setup does not also bind the Dante Conmon port.
        if cfg.obs.is_none() && (!settings.broadcast.destinations.is_empty() || cfg.live) {
            cfg.obs = Some(obs_config_from_env());
            cfg.live = true;
        }
        cfg
    }
}

fn obs_config_from_env() -> ObsConfig {
    ObsConfig::new(
        std::env::var("RING_OBS_URL").unwrap_or_else(|_| "ws://127.0.0.1:4455".into()),
        std::env::var("RING_OBS_PASSWORD").ok(),
    )
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
    EasyWorship(EasyWorshipCommand),
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
    easyworship: Option<mpsc::UnboundedSender<EasyWorshipCommand>>,
    image_cache: Arc<Mutex<EasyWorshipImageCache>>,
    dante: Option<mpsc::UnboundedSender<DanteCommand>>,
    ndi: Option<mpsc::UnboundedSender<NdiCommand>>,
    tasks: Vec<JoinHandle<()>>,
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
            easyworship: None,
            image_cache: Arc::new(Mutex::new(EasyWorshipImageCache::default())),
            dante: None,
            ndi: None,
            tasks: Vec::new(),
            devices: Vec::new(),
        };

        if let Some(x32) = &config.x32 {
            let (tx, rx) = mpsc::unbounded_channel();
            let handle = x32_adapter::spawn(x32.clone(), state.clone(), sink.clone(), rx);
            registry.tasks.push(handle);
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
            let handle = obs_adapter::spawn(obs.clone(), state.clone(), sink.clone(), rx);
            registry.tasks.push(handle);
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
            let handle =
                streamlabs_adapter::spawn(streamlabs.clone(), state.clone(), sink.clone(), rx);
            registry.tasks.push(handle);
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
            let handle =
                propresenter_adapter::spawn(propresenter.clone(), state.clone(), sink.clone(), rx);
            registry.tasks.push(handle);
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

        if let Some(easyworship) = &config.easyworship {
            let (tx, rx) = mpsc::unbounded_channel();
            let handle = easyworship_adapter::spawn(
                easyworship.clone(),
                state.clone(),
                sink.clone(),
                registry.image_cache.clone(),
                rx,
            );
            registry.tasks.push(handle);
            registry.easyworship = Some(tx);
            registry.devices.push(DeviceStatus {
                id: "slides-ew",
                kind: DeviceKind::EasyWorship,
                capabilities: DeviceCapabilities::for_kind(DeviceKind::EasyWorship),
            });
            sink.log(format!(
                "[runtime] EasyWorship adapter started for {}",
                easyworship.endpoint_label()
            ));
        }

        if let Some(dante) = &config.dante {
            let (tx, rx) = mpsc::unbounded_channel();
            let handle = dante_adapter::spawn(dante.clone(), state.clone(), sink.clone(), rx);
            registry.tasks.push(handle);
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
            let handle = ndi_adapter::spawn(ndi.clone(), state.clone(), sink.clone(), rx);
            registry.tasks.push(handle);
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

    /// Fetch cached EasyWorship JPEG bytes by the key published in `SlideState.image`.
    pub fn easyworship_image(&self, key: &str) -> Option<Vec<u8>> {
        self.image_cache.lock().unwrap().get(key)
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
            AdapterCommand::EasyWorship(command) => self
                .easyworship
                .as_ref()
                .map(|tx| tx.send(command).is_ok())
                .unwrap_or(false),
        }
    }
}

impl Drop for AdapterRegistry {
    fn drop(&mut self) {
        for handle in &self.tasks {
            handle.abort();
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

    #[test]
    fn registry_exposes_cached_easyworship_image_bytes() {
        let sink = Arc::new(RecordingSink::new());
        let registry = AdapterRegistry::start(&RuntimeConfig::default(), state(), sink);
        let jpeg = vec![0xff, 0xd8, 0xff, 0xd9];
        registry
            .image_cache
            .lock()
            .unwrap()
            .insert("current:hash".into(), jpeg.clone())
            .unwrap();
        assert_eq!(registry.easyworship_image("current:hash"), Some(jpeg));
        assert!(registry.easyworship_image("missing").is_none());
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
        assert!(!registry.dispatch(AdapterCommand::EasyWorship(
            EasyWorshipCommand::NextSlide
        )));
    }

    #[tokio::test]
    async fn easyworship_registry_advertises_slide_capability() {
        let sink = Arc::new(RecordingSink::new());
        let config = RuntimeConfig {
            live: true,
            easyworship: Some(EasyWorshipConfig::new("127.0.0.1:55123")),
            ..RuntimeConfig::default()
        };
        let registry = AdapterRegistry::start(&config, state(), sink);
        assert!(registry.has(DeviceKind::EasyWorship));
        let device = &registry.devices()[0];
        assert!(device.capabilities.slides);
        assert!(!device.capabilities.meters);
    }
}
