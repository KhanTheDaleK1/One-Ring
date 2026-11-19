//! Clean-room protocol codecs for One Ring.
//!
//! Each submodule implements a *wire codec* only: it encodes and decodes the bytes/JSON/XML
//! described in `docs/re-findings/*.md`. Transport, retries, and adapter state live elsewhere.
//!
//! The `ProtocolProbe` / `DeviceCapabilities` types in this module give discovery, preflight, and
//! the cue engine one uniform description of "what this device is, how to probe it, and what it can
//! do" without coupling those layers to a specific vendor protocol.
//!
//! **Clean-room note:** these modules were written from the interoperability specifications in
//! `docs/re-findings/` and public protocol documentation. No vendor source, decompiled code, or
//! proprietary assets are reproduced here.

pub mod dante;
pub mod easyworship;
pub mod easyworship_discovery;
pub mod ndi;
pub mod obs_streamlabs;
pub mod propresenter;
pub mod x32;

use std::fmt;

// -------------------------------------------------------------------------------------------------
// Errors
// -------------------------------------------------------------------------------------------------

/// Common error type for all clean-room codecs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    /// The byte buffer ended before a complete field could be read.
    TooShort { expected: usize, actual: usize },
    /// A field had the wrong magic/opcode/type tag or otherwise failed validation.
    Malformed(String),
    /// A string field was not valid UTF-8.
    Utf8(String),
    /// A JSON document was malformed.
    Json(String),
    /// The requested operation is not supported by this protocol or firmware.
    Unsupported(String),
}

impl ProtocolError {
    pub fn malformed(msg: impl Into<String>) -> Self {
        ProtocolError::Malformed(msg.into())
    }

    pub fn unsupported(msg: impl Into<String>) -> Self {
        ProtocolError::Unsupported(msg.into())
    }
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProtocolError::TooShort { expected, actual } => {
                write!(f, "buffer too short: expected {expected} bytes, got {actual}")
            }
            ProtocolError::Malformed(m) => write!(f, "malformed protocol data: {m}"),
            ProtocolError::Utf8(m) => write!(f, "invalid UTF-8: {m}"),
            ProtocolError::Json(m) => write!(f, "invalid JSON: {m}"),
            ProtocolError::Unsupported(m) => write!(f, "unsupported: {m}"),
        }
    }
}

impl std::error::Error for ProtocolError {}

impl From<std::str::Utf8Error> for ProtocolError {
    fn from(e: std::str::Utf8Error) -> Self {
        ProtocolError::Utf8(e.to_string())
    }
}

impl From<std::string::FromUtf8Error> for ProtocolError {
    fn from(e: std::string::FromUtf8Error) -> Self {
        ProtocolError::Utf8(e.to_string())
    }
}

impl From<serde_json::Error> for ProtocolError {
    fn from(e: serde_json::Error) -> Self {
        ProtocolError::Json(e.to_string())
    }
}

// -------------------------------------------------------------------------------------------------
// Device kinds & capabilities
// -------------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DeviceKind {
    X32,
    Dante,
    Ndi,
    Obs,
    Streamlabs,
    ProPresenter,
    EasyWorship,
    Unknown,
}

impl DeviceKind {
    pub const ALL: [DeviceKind; 7] = [
        DeviceKind::X32,
        DeviceKind::Dante,
        DeviceKind::Ndi,
        DeviceKind::Obs,
        DeviceKind::Streamlabs,
        DeviceKind::ProPresenter,
        DeviceKind::EasyWorship,
    ];

    pub fn label(self) -> &'static str {
        match self {
            DeviceKind::X32 => "Behringer X32",
            DeviceKind::Dante => "Dante",
            DeviceKind::Ndi => "NDI 6",
            DeviceKind::Obs => "OBS Studio",
            DeviceKind::Streamlabs => "Streamlabs Desktop",
            DeviceKind::ProPresenter => "ProPresenter",
            DeviceKind::EasyWorship => "EasyWorship",
            DeviceKind::Unknown => "Unknown",
        }
    }

    pub fn short_label(self) -> &'static str {
        match self {
            DeviceKind::X32 => "X32",
            DeviceKind::Dante => "Dante",
            DeviceKind::Ndi => "NDI",
            DeviceKind::Obs => "OBS",
            DeviceKind::Streamlabs => "SLOBS",
            DeviceKind::ProPresenter => "ProPresenter",
            DeviceKind::EasyWorship => "EasyWorship",
            DeviceKind::Unknown => "?",
        }
    }
}

/// Feature flags a device advertises. A `false` flag means "One Ring must hide or disable that
/// control for this device" rather than "the device is broken".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DeviceCapabilities {
    /// Real-time audio level metering.
    pub meters: bool,
    /// Audio/video routing or crosspoint subscription control.
    pub routing: bool,
    /// Pan/tilt/zoom camera control.
    pub ptz: bool,
    /// Program/preview tally.
    pub tally: bool,
    /// Independent horizontal/vertical canvases.
    pub multi_canvas: bool,
    /// Independent named outputs (stream/record/vertical) with per-output control.
    pub multi_output: bool,
    /// Frame-synchronized multi-machine preroll.
    pub preroll: bool,
    /// Remote receiver/display switching (NDI receiver listener).
    pub receiver_control: bool,
    /// Scene/snapshot recall.
    pub scene_recall: bool,
    /// Start/stop streaming.
    pub streaming: bool,
    /// Start/stop/pause recording.
    pub recording: bool,
    /// Slide/presentation control.
    pub slides: bool,
    /// Closed-caption injection.
    pub captions: bool,
}

impl DeviceCapabilities {
    pub fn for_kind(kind: DeviceKind) -> Self {
        let mut c = Self::default();
        match kind {
            DeviceKind::X32 => {
                c.meters = true;
                c.scene_recall = true;
            }
            DeviceKind::Dante => {
                c.meters = true;
                c.routing = true;
            }
            DeviceKind::Ndi => {
                c.routing = true;
                c.ptz = true;
                c.tally = true;
                c.receiver_control = true;
            }
            DeviceKind::Obs => {
                c.meters = true;
                c.multi_canvas = true;
                c.multi_output = true;
                c.streaming = true;
                c.recording = true;
                c.captions = true;
            }
            DeviceKind::Streamlabs => {
                c.meters = true;
                c.multi_canvas = true;
                c.multi_output = true;
                c.streaming = true;
                c.recording = true;
            }
            DeviceKind::ProPresenter => {
                c.slides = true;
                c.preroll = true;
                c.recording = true;
            }
            DeviceKind::EasyWorship => {
                // Remote control of live/schedule slides plus notes via the
                // `_ezwremote._tcp` JSON-lines protocol.
                c.slides = true;
            }
            DeviceKind::Unknown => {}
        }
        c
    }

    /// Bitwise union of two capability sets.
    pub fn union(self, other: Self) -> Self {
        Self {
            meters: self.meters || other.meters,
            routing: self.routing || other.routing,
            ptz: self.ptz || other.ptz,
            tally: self.tally || other.tally,
            multi_canvas: self.multi_canvas || other.multi_canvas,
            multi_output: self.multi_output || other.multi_output,
            preroll: self.preroll || other.preroll,
            receiver_control: self.receiver_control || other.receiver_control,
            scene_recall: self.scene_recall || other.scene_recall,
            streaming: self.streaming || other.streaming,
            recording: self.recording || other.recording,
            slides: self.slides || other.slides,
            captions: self.captions || other.captions,
        }
    }

    pub fn summary(self) -> String {
        let mut on = Vec::new();
        if self.meters { on.push("meters"); }
        if self.routing { on.push("routing"); }
        if self.ptz { on.push("ptz"); }
        if self.tally { on.push("tally"); }
        if self.multi_canvas { on.push("multi-canvas"); }
        if self.multi_output { on.push("multi-output"); }
        if self.preroll { on.push("preroll"); }
        if self.receiver_control { on.push("receiver-control"); }
        if self.scene_recall { on.push("scene-recall"); }
        if self.streaming { on.push("streaming"); }
        if self.recording { on.push("recording"); }
        if self.slides { on.push("slides"); }
        if self.captions { on.push("captions"); }
        if on.is_empty() {
            "none".to_string()
        } else {
            on.join(", ")
        }
    }
}

// -------------------------------------------------------------------------------------------------
// Probe descriptors
// -------------------------------------------------------------------------------------------------

/// How discovery/preflight should probe a device. Transport-bearing probes carry the exact bytes
/// or path to send so the probe layer never needs protocol-specific branching.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeTransport {
    /// Send these bytes to the endpoint over UDP.
    UdpDatagram(Vec<u8>),
    /// Open a TCP connection to the endpoint.
    TcpConnect { default_port: u16 },
    /// Issue `GET <path>` against the endpoint's HTTP base URL.
    HttpGet { path: String },
    /// Open a WebSocket to the endpoint at `path`.
    WebSocket { path: String },
}

impl ProbeTransport {
    pub fn label(&self) -> &'static str {
        match self {
            ProbeTransport::UdpDatagram(_) => "udp",
            ProbeTransport::TcpConnect { .. } => "tcp",
            ProbeTransport::HttpGet { .. } => "http",
            ProbeTransport::WebSocket { .. } => "ws",
        }
    }
}

/// Everything discovery/preflight needs to know about one device family.
#[derive(Debug, Clone)]
pub struct ProbeDescriptor {
    pub kind: DeviceKind,
    /// Human label, e.g. "Behringer X32 (FOH)".
    pub label: String,
    /// Default endpoint template. May contain `<host>` / `<port>` placeholders.
    pub default_endpoint: String,
    pub transport: ProbeTransport,
    pub capabilities: DeviceCapabilities,
    /// Short operator-facing note (why this probe exists).
    pub note: &'static str,
}

impl ProbeDescriptor {
    pub fn new(
        kind: DeviceKind,
        label: impl Into<String>,
        default_endpoint: impl Into<String>,
        transport: ProbeTransport,
        note: &'static str,
    ) -> Self {
        Self {
            kind,
            label: label.into(),
            default_endpoint: default_endpoint.into(),
            transport,
            capabilities: DeviceCapabilities::for_kind(kind),
            note,
        }
    }
}

/// Implemented by each protocol's probe descriptor.
pub trait ProtocolProbe {
    fn descriptor(&self) -> ProbeDescriptor;

    fn kind(&self) -> DeviceKind {
        self.descriptor().kind
    }

    fn capabilities(&self) -> DeviceCapabilities {
        self.descriptor().capabilities
    }
}

// Concrete probes ------------------------------------------------------------------------------

pub struct X32Probe;
impl ProtocolProbe for X32Probe {
    fn descriptor(&self) -> ProbeDescriptor {
        ProbeDescriptor::new(
            DeviceKind::X32,
            "Behringer X32",
            "192.168.10.50:10023",
            ProbeTransport::UdpDatagram(x86_probe_bytes()),
            "OSC /xinfo identity probe, then /xremote keepalive",
        )
    }
}

fn x86_probe_bytes() -> Vec<u8> {
    x32::OscMessage::xinfo().encode()
}

pub struct DanteProbe;
impl ProtocolProbe for DanteProbe {
    fn descriptor(&self) -> ProbeDescriptor {
        let header = dante::ConmonHeader::request(
            dante::op::VERSIONS_QUERY,
            dante::ConmonFraming::Spec24,
        );
        ProbeDescriptor::new(
            DeviceKind::Dante,
            "Dante network",
            "224.0.0.231:8702",
            ProbeTransport::UdpDatagram(header.encode(&[]).unwrap_or_default()),
            "Conmon VERSIONS_QUERY + PTP clock/metering state",
        )
    }
}

pub struct NdiProbe;
impl ProtocolProbe for NdiProbe {
    fn descriptor(&self) -> ProbeDescriptor {
        ProbeDescriptor::new(
            DeviceKind::Ndi,
            "NDI 6 discovery",
            "<discovery-host>:5959",
            ProbeTransport::TcpConnect { default_port: 5959 },
            "Discovery Service <compatible/> handshake, then <query_receivers/>",
        )
    }
}

pub struct ObsProbe;
impl ProtocolProbe for ObsProbe {
    fn descriptor(&self) -> ProbeDescriptor {
        ProbeDescriptor::new(
            DeviceKind::Obs,
            "OBS Studio",
            "ws://127.0.0.1:4455",
            ProbeTransport::WebSocket { path: "/".into() },
            "obs-websocket v5 Hello/Identify; verify rpcVersion and canvas list",
        )
    }
}

pub struct StreamlabsProbe;
impl ProtocolProbe for StreamlabsProbe {
    fn descriptor(&self) -> ProbeDescriptor {
        ProbeDescriptor::new(
            DeviceKind::Streamlabs,
            "Streamlabs Desktop",
            "127.0.0.1:28194",
            ProbeTransport::TcpConnect { default_port: 28194 },
            "Loopback/named-pipe JSON-RPC getModel probe (auto-authorized)",
        )
    }
}

pub struct ProPresenterProbe;
impl ProtocolProbe for ProPresenterProbe {
    fn descriptor(&self) -> ProbeDescriptor {
        ProbeDescriptor::new(
            DeviceKind::ProPresenter,
            "ProPresenter",
            "http://<host>:<port>",
            ProbeTransport::HttpGet {
                path: propresenter::paths::STATUS_LAYERS.into(),
            },
            "REST /v1/status/layers, then multiplexed /v1/status/updates stream",
        )
    }
}

pub struct EasyWorshipProbe;
impl ProtocolProbe for EasyWorshipProbe {
    fn descriptor(&self) -> ProbeDescriptor {
        ProbeDescriptor::new(
            DeviceKind::EasyWorship,
            "EasyWorship",
            "<host>:<ephemeral-port>",
            ProbeTransport::TcpConnect { default_port: 0 },
            "mDNS _ezwremote._tcp then TCP JSON-lines connect/heartbeat pairing",
        )
    }
}

// -------------------------------------------------------------------------------------------------
// Capability summary
// -------------------------------------------------------------------------------------------------

/// Aggregated view of every configured device, used by preflight and the cue validator.
#[derive(Debug, Clone, Default)]
pub struct CapabilitiesSummary {
    pub descriptors: Vec<ProbeDescriptor>,
}

impl CapabilitiesSummary {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, descriptor: ProbeDescriptor) {
        self.descriptors.push(descriptor);
    }

    /// Union of every device's capabilities.
    pub fn aggregate(&self) -> DeviceCapabilities {
        self.descriptors
            .iter()
            .fold(DeviceCapabilities::default(), |acc, d| acc.union(d.capabilities))
    }

    pub fn by_kind(&self, kind: DeviceKind) -> Option<&ProbeDescriptor> {
        self.descriptors.iter().find(|d| d.kind == kind)
    }

    pub fn supports(&self, kind: DeviceKind) -> bool {
        self.by_kind(kind).is_some()
    }

    /// Device families from `DeviceKind::ALL` that are missing from the configured show.
    pub fn missing(&self) -> Vec<DeviceKind> {
        DeviceKind::ALL
            .into_iter()
            .filter(|k| !self.supports(*k))
            .collect()
    }

    /// One row per configured device, suitable for the preflight readiness grid.
    pub fn preflight_rows(&self) -> Vec<ProbeRow> {
        self.descriptors
            .iter()
            .map(|d| ProbeRow {
                kind: d.kind,
                label: d.label.clone(),
                endpoint: d.default_endpoint.clone(),
                transport: d.transport.label().to_string(),
                capabilities: d.capabilities.summary(),
                note: d.note,
            })
            .collect()
    }
}

#[derive(Debug, Clone)]
pub struct ProbeRow {
    pub kind: DeviceKind,
    pub label: String,
    pub endpoint: String,
    pub transport: String,
    pub capabilities: String,
    pub note: &'static str,
}

/// Convenience constructor for the standard set of probes, used by the app wiring.
pub fn default_probes() -> Vec<Box<dyn ProtocolProbe>> {
    vec![
        Box::new(X32Probe),
        Box::new(DanteProbe),
        Box::new(NdiProbe),
        Box::new(ObsProbe),
        Box::new(StreamlabsProbe),
        Box::new(ProPresenterProbe),
        Box::new(EasyWorshipProbe),
    ]
}

pub fn default_capabilities_summary() -> CapabilitiesSummary {
    let mut summary = CapabilitiesSummary::new();
    for probe in default_probes() {
        summary.push(probe.descriptor());
    }
    summary
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_summary_covers_all_kinds() {
        let summary = default_capabilities_summary();
        assert!(summary.missing().is_empty());
        let agg = summary.aggregate();
        assert!(agg.meters);
        assert!(agg.routing);
        assert!(agg.ptz);
        assert!(agg.tally);
        assert!(agg.multi_canvas);
        assert!(agg.multi_output);
        assert!(agg.preroll);
        assert!(agg.receiver_control);
        assert!(agg.scene_recall);
        assert!(agg.streaming);
        assert!(agg.recording);
        assert!(agg.slides);
        assert!(agg.captions);
    }

    #[test]
    fn preflight_rows_have_transport_labels() {
        let rows = default_capabilities_summary().preflight_rows();
        assert_eq!(rows.len(), 7);
        assert!(rows.iter().any(|r| r.transport == "udp"));
        assert!(rows.iter().any(|r| r.transport == "tcp"));
        assert!(rows.iter().any(|r| r.transport == "http"));
        assert!(rows.iter().any(|r| r.transport == "ws"));
    }
}

pub mod x32_scene;

pub mod midi;

pub mod visca;
