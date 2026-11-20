//! Runtime composition: configuration, live adapter registry, and normalized command routing.
//!
//! The simulator remains the default. Set `RING_LIVE=1` (or `ONE_RING_LIVE=1`) to start the live
//! adapters; each endpoint can be overridden with an environment variable:
//!
//! | Adapter | Variables | Default |
//! | :--- | :--- | :--- |
//! | Console | `RING_CONSOLE_HOST`, `RING_CONSOLE_PORT` | disabled unless host set |
//! | BROADCAST | `RING_BROADCAST_URL`, `RING_BROADCAST_PASSWORD` | `ws://127.0.0.1:4455` |
//! | DualStream | `RING_DUAL_STREAM_ADDR` | `127.0.0.1:28194` |
//! | SlideHttp | `RING_PP_HOST`, `RING_PP_PORT` | `127.0.0.1:50000` |
//! | SlideTcp | `RING_EZW_HOST`, `RING_EZW_PORT`, `RING_EZW_DISCOVER=1` | mDNS `_ezwremote._tcp` |
//!
//! Adapters are transport-only: they own sockets/backoff and emit the typed events in
//! [`events`]. The cue engine and Tauri commands dispatch through [`AdapterRegistry`].

pub mod aoip_adapter;
pub mod audience_relay;
pub mod slide_tcp_adapter;
pub mod events;
pub mod health;
pub mod ip_video_adapter;
pub mod broadcast_adapter;
pub mod broadcast_daemon;
pub mod broadcast_worker_ipc;
pub mod slide_http_adapter;
pub mod dual_stream_adapter;
pub mod console_adapter;
pub mod native_capture;
pub mod lyrics_search;

use crate::protocols::{DeviceCapabilities, DeviceKind};
use crate::state::SharedState;
use aoip_adapter::{AoipCommand, AoipConfig};
use slide_tcp_adapter::{SlideTcpCommand, SlideTcpConfig, SlideTcpImageCache};
use events::EventSink;
use ip_video_adapter::{IpVideoCommand, IpVideoConfig};
use broadcast_adapter::{BroadcastCommand, BroadcastConfig};
use slide_http_adapter::{SlideHttpCommand, SlideHttpConfig};
use std::sync::{Arc, Mutex};
use dual_stream_adapter::{DualStreamCommand, DualStreamConfig};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use console_adapter::{ConsoleCommand, ConsoleConfig};

#[derive(Debug, Clone, Default)]
pub struct RuntimeConfig {
    pub live: bool,
    pub console: Option<ConsoleConfig>,
    pub broadcast: Option<BroadcastConfig>,
    pub dual_stream: Option<DualStreamConfig>,
    pub slide_http: Option<SlideHttpConfig>,
    pub slide_tcp: Option<SlideTcpConfig>,
    pub aoip: Option<AoipConfig>,
    pub ip_video: Option<IpVideoConfig>,
}

impl RuntimeConfig {
    pub fn from_env() -> Self {
        let live = env_flag("RING_LIVE") || env_flag("ONE_RING_LIVE");
        if !live {
            return Self::default();
        }

        let console = std::env::var("RING_CONSOLE_HOST").ok().map(|host| {
            let mut config = ConsoleConfig::new(host);
            if let Some(port) = std::env::var("RING_CONSOLE_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
            {
                config.port = port;
            }
            config
        });

        let broadcast = Some(broadcast_config_from_env());

        let dual_stream = Some(DualStreamConfig::new(
            std::env::var("RING_DUAL_STREAM_ADDR").unwrap_or_else(|_| "127.0.0.1:28194".into()),
        ));

        let slide_http = Some(SlideHttpConfig::new(
            std::env::var("RING_PP_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
            std::env::var("RING_PP_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(50_000),
        ));

        // SlideTcp's listener uses an ephemeral port, so mDNS is the default when live mode is
        // on. A static `RING_EZW_HOST`/`RING_EZW_PORT` (or full `RING_EZW_ENDPOINT`) overrides it.
        let slide_tcp = if let Ok(endpoint) = std::env::var("RING_EZW_ENDPOINT") {
            Some(SlideTcpConfig::new(endpoint))
        } else if let Ok(host) = std::env::var("RING_EZW_HOST") {
            let port = std::env::var("RING_EZW_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(55_000);
            Some(SlideTcpConfig::new(format!("{host}:{port}")))
        } else if env_flag("RING_EZW_DISCOVER") {
            Some(SlideTcpConfig::discovered())
        } else {
            None
        };

        let aoip = Some(AoipConfig::default());
        let ip_video = Some(IpVideoConfig {
            discovery_host: std::env::var("RING_IP_VIDEO_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
            ..IpVideoConfig::default()
        });

        Self {
            live,
            console,
            broadcast,
            dual_stream,
            slide_http,
            slide_tcp,
            aoip,
            ip_video,
        }
    }

    /// Build a runtime configuration merging environment overrides with persisted Settings UI values.
    /// If `RING_LIVE` is unset, live adapters still activate automatically when the user configures
    /// hardware endpoints (e.g. Console IP or IP_VIDEO discovery host) in Settings.
    pub fn from_env_and_settings(settings: &crate::state::AppSettings) -> Self {
        let mut cfg = Self::from_env();
        let console_ip = settings.console.ip_address.trim();
        if cfg.console.is_none() && !console_ip.is_empty() {
            let mut x = ConsoleConfig::new(console_ip);
            if settings.console.osc_port > 0 {
                x.port = settings.console.osc_port;
            }
            cfg.console = Some(x);
            cfg.live = true;
        }
        let ip_video_host = settings.ip_video_ptz.discovery_range_start.trim();
        if cfg.ip_video.is_none() && !ip_video_host.is_empty() {
            cfg.ip_video = Some(IpVideoConfig {
                discovery_host: ip_video_host.to_string(),
                ..IpVideoConfig::default()
            });
            cfg.live = true;
        }
        if cfg.live && cfg.aoip.is_none() {
            cfg.aoip = Some(AoipConfig {
                meter_port: if settings.aoip.conmon_meter_port > 0 {
                    settings.aoip.conmon_meter_port
                } else {
                    aoip_adapter::AOIP_CONMON_METER_PORT
                },
                ..AoipConfig::default()
            });
        }
        // Broadcast destinations still need an BROADCAST adapter even when RING_LIVE is not set, so
        // the Settings UI can drive real streams. Do this after the Aoip decision so a
        // broadcast-only setup does not also bind the Aoip Conmon port.
        if cfg.broadcast.is_none() && (!settings.broadcast.destinations.is_empty() || cfg.live) {
            cfg.broadcast = Some(broadcast_config_from_env());
            cfg.live = true;
        }
        cfg
    }
}

fn broadcast_config_from_env() -> BroadcastConfig {
    BroadcastConfig::new(
        std::env::var("RING_BROADCAST_URL").unwrap_or_else(|_| "ws://127.0.0.1:4455".into()),
        std::env::var("RING_BROADCAST_PASSWORD").ok(),
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
    Console(ConsoleCommand),
    Broadcast(BroadcastCommand),
    DualStream(DualStreamCommand),
    SlideHttp(SlideHttpCommand),
    SlideTcp(SlideTcpCommand),
    Aoip(AoipCommand),
    IpVideo(IpVideoCommand),
}

#[derive(Debug, Clone)]
pub struct DeviceStatus {
    pub id: &'static str,
    pub kind: DeviceKind,
    pub capabilities: DeviceCapabilities,
}

/// Owns the command senders for every started adapter and exposes a capability summary.
pub struct AdapterRegistry {
    console: Option<mpsc::UnboundedSender<ConsoleCommand>>,
    broadcast: Option<mpsc::UnboundedSender<BroadcastCommand>>,
    dual_stream: Option<mpsc::UnboundedSender<DualStreamCommand>>,
    slide_http: Option<mpsc::UnboundedSender<SlideHttpCommand>>,
    slide_tcp: Option<mpsc::UnboundedSender<SlideTcpCommand>>,
    image_cache: Arc<Mutex<SlideTcpImageCache>>,
    aoip: Option<mpsc::UnboundedSender<AoipCommand>>,
    ip_video: Option<mpsc::UnboundedSender<IpVideoCommand>>,
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
            console: None,
            broadcast: None,
            dual_stream: None,
            slide_http: None,
            slide_tcp: None,
            image_cache: Arc::new(Mutex::new(SlideTcpImageCache::default())),
            aoip: None,
            ip_video: None,
            tasks: Vec::new(),
            devices: Vec::new(),
        };

        if let Some(console) = &config.console {
            let (tx, rx) = mpsc::unbounded_channel();
            let handle = console_adapter::spawn(console.clone(), state.clone(), sink.clone(), rx);
            registry.tasks.push(handle);
            registry.console = Some(tx);
            registry.devices.push(DeviceStatus {
                id: "console",
                kind: DeviceKind::Console,
                capabilities: DeviceCapabilities::for_kind(DeviceKind::Console),
            });
            sink.log(format!(
                "[runtime] Console adapter started for {}",
                console.endpoint()
            ));
        }

        if let Some(broadcast) = &config.broadcast {
            let (tx, rx) = mpsc::unbounded_channel();
            let handle = broadcast_adapter::spawn(broadcast.clone(), state.clone(), sink.clone(), rx);
            registry.tasks.push(handle);
            registry.broadcast = Some(tx);
            registry.devices.push(DeviceStatus {
                id: "yt",
                kind: DeviceKind::Broadcast,
                capabilities: DeviceCapabilities::for_kind(DeviceKind::Broadcast),
            });
            sink.log(format!("[runtime] BROADCAST adapter started for {}", broadcast.url));
        }

        if let Some(dual_stream) = &config.dual_stream {
            let (tx, rx) = mpsc::unbounded_channel();
            let handle =
                dual_stream_adapter::spawn(dual_stream.clone(), state.clone(), sink.clone(), rx);
            registry.tasks.push(handle);
            registry.dual_stream = Some(tx);
            registry.devices.push(DeviceStatus {
                id: "dual_stream",
                kind: DeviceKind::DualStream,
                capabilities: DeviceCapabilities::for_kind(DeviceKind::DualStream),
            });
            sink.log(format!(
                "[runtime] DualStream adapter started for {}",
                dual_stream.endpoint
            ));
        }

        if let Some(slide_http) = &config.slide_http {
            let (tx, rx) = mpsc::unbounded_channel();
            let handle =
                slide_http_adapter::spawn(slide_http.clone(), state.clone(), sink.clone(), rx);
            registry.tasks.push(handle);
            registry.slide_http = Some(tx);
            registry.devices.push(DeviceStatus {
                id: "slides",
                kind: DeviceKind::SlideHttp,
                capabilities: DeviceCapabilities::for_kind(DeviceKind::SlideHttp),
            });
            sink.log(format!(
                "[runtime] SlideHttp adapter started for {}",
                slide_http.endpoint()
            ));
        }

        if let Some(slide_tcp) = &config.slide_tcp {
            let (tx, rx) = mpsc::unbounded_channel();
            let handle = slide_tcp_adapter::spawn(
                slide_tcp.clone(),
                state.clone(),
                sink.clone(),
                registry.image_cache.clone(),
                rx,
            );
            registry.tasks.push(handle);
            registry.slide_tcp = Some(tx);
            registry.devices.push(DeviceStatus {
                id: "slides-ew",
                kind: DeviceKind::SlideTcp,
                capabilities: DeviceCapabilities::for_kind(DeviceKind::SlideTcp),
            });
            sink.log(format!(
                "[runtime] SlideTcp adapter started for {}",
                slide_tcp.endpoint_label()
            ));
        }

        if let Some(aoip) = &config.aoip {
            let (tx, rx) = mpsc::unbounded_channel();
            let handle = aoip_adapter::spawn(aoip.clone(), state.clone(), sink.clone(), rx);
            registry.tasks.push(handle);
            registry.aoip = Some(tx);
            registry.devices.push(DeviceStatus {
                id: "aoip",
                kind: DeviceKind::Aoip,
                capabilities: DeviceCapabilities::for_kind(DeviceKind::Aoip),
            });
            sink.log("[runtime] Aoip Conmon/ARC UDP adapter started".into());
        }

        if let Some(ip_video) = &config.ip_video {
            let (tx, rx) = mpsc::unbounded_channel();
            let handle = ip_video_adapter::spawn(ip_video.clone(), state.clone(), sink.clone(), rx);
            registry.tasks.push(handle);
            registry.ip_video = Some(tx);
            registry.devices.push(DeviceStatus {
                id: "ip_video",
                kind: DeviceKind::IpVideo,
                capabilities: DeviceCapabilities::for_kind(DeviceKind::IpVideo),
            });
            sink.log(format!("[runtime] IP_VIDEO 6 Discovery adapter started for {}", ip_video.endpoint()));
        }

        registry
    }

    pub fn devices(&self) -> &[DeviceStatus] {
        &self.devices
    }

    pub fn has(&self, kind: DeviceKind) -> bool {
        self.devices.iter().any(|d| d.kind == kind)
    }

    /// Fetch cached SlideTcp JPEG bytes by the key published in `SlideState.image`.
    pub fn slide_tcp_image(&self, key: &str) -> Option<Vec<u8>> {
        self.image_cache.lock().unwrap().get(key)
    }

    /// Route a normalized command. Returns `false` when no live adapter owns that domain, which
    /// lets the cue engine fall back to simulator state or report a degraded capability.
    pub fn dispatch(&self, command: AdapterCommand) -> bool {
        match command {
            AdapterCommand::Console(command) => self
                .console
                .as_ref()
                .map(|tx| tx.send(command).is_ok())
                .unwrap_or(false),
            AdapterCommand::Broadcast(command) => self
                .broadcast
                .as_ref()
                .map(|tx| tx.send(command).is_ok())
                .unwrap_or(false),
            AdapterCommand::DualStream(command) => self
                .dual_stream
                .as_ref()
                .map(|tx| tx.send(command).is_ok())
                .unwrap_or(false),
            AdapterCommand::Aoip(command) => self
                .aoip
                .as_ref()
                .map(|tx| tx.send(command).is_ok())
                .unwrap_or(false),
            AdapterCommand::IpVideo(command) => self
                .ip_video
                .as_ref()
                .map(|tx| tx.send(command).is_ok())
                .unwrap_or(false),
            AdapterCommand::SlideHttp(command) => self
                .slide_http
                .as_ref()
                .map(|tx| tx.send(command).is_ok())
                .unwrap_or(false),
            AdapterCommand::SlideTcp(command) => self
                .slide_tcp
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
        assert!(!registry.dispatch(AdapterCommand::Console(ConsoleCommand::Identify)));
    }

    #[test]
    fn registry_exposes_cached_slide_tcp_image_bytes() {
        let sink = Arc::new(RecordingSink::new());
        let registry = AdapterRegistry::start(&RuntimeConfig::default(), state(), sink);
        let jpeg = vec![0xff, 0xd8, 0xff, 0xd9];
        registry
            .image_cache
            .lock()
            .unwrap()
            .insert("current:hash".into(), jpeg.clone())
            .unwrap();
        assert_eq!(registry.slide_tcp_image("current:hash"), Some(jpeg));
        assert!(registry.slide_tcp_image("missing").is_none());
    }

    #[tokio::test]
    async fn registry_advertises_capabilities() {
        let sink = Arc::new(RecordingSink::new());
        let config = RuntimeConfig {
            live: true,
            console: Some(ConsoleConfig::new("127.0.0.1")),
            ..RuntimeConfig::default()
        };
        let registry = AdapterRegistry::start(&config, state(), sink);
        assert!(registry.has(DeviceKind::Console));
        let device = &registry.devices()[0];
        assert!(device.capabilities.meters);
        assert!(device.capabilities.scene_recall);
    }

    #[test]
    fn dispatch_to_missing_adapter_is_false() {
        let sink = Arc::new(RecordingSink::new());
        let registry = AdapterRegistry::start(&RuntimeConfig::default(), state(), sink);
        assert!(!registry.dispatch(AdapterCommand::Broadcast(BroadcastCommand::Refresh)));
        assert!(!registry.dispatch(AdapterCommand::SlideHttp(
            SlideHttpCommand::Next
        )));
        assert!(!registry.dispatch(AdapterCommand::SlideTcp(
            SlideTcpCommand::NextSlide
        )));
    }

    #[tokio::test]
    async fn slide_tcp_registry_advertises_slide_capability() {
        let sink = Arc::new(RecordingSink::new());
        let config = RuntimeConfig {
            live: true,
            slide_tcp: Some(SlideTcpConfig::new("127.0.0.1:55123")),
            ..RuntimeConfig::default()
        };
        let registry = AdapterRegistry::start(&config, state(), sink);
        assert!(registry.has(DeviceKind::SlideTcp));
        let device = &registry.devices()[0];
        assert!(device.capabilities.slides);
        assert!(!device.capabilities.meters);
    }
}
