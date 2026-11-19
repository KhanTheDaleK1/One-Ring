//! Live Console Console / Console Console adapter (OSC over UDP `:10023`).
//!
//! Uses the clean-room codec in [`crate::protocols::console`] and implements the Phase 2 contract:
//!
//! * `/xinfo` identity probe, then `/xremote` every 8 s (< 10 s expiry).
//! * Bidirectional parameter updates for DCAs, channels, and Main LR.
//! * `/meters/1` frames coalesced to a 20 Hz latest-wins `meter://console` stream.
//! * Optimistic state patches after writes, reconciled by the `/xremote` echo.
//! * Exponential reconnect backoff and `device://health` transitions.

use crate::protocols::console_osc::{
    db_to_fader, fader_to_db, meter_byte_to_db, parse_meters_message, MeterFrame, OscArg,
    OscMessage, XREMOTE_INTERVAL_MS,
};
use crate::runtime::events::{state_patch, EventSink, MeterChannel, MeterEvent};
use crate::runtime::health::HealthReporter;
use crate::state::{recompute_derived_alerts, with_state, SharedState};
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;
use tokio::sync::mpsc;

pub const DEFAULT_CONSOLE_PORT: u16 = 10023;
pub const METER_HZ: u32 = 20;

#[derive(Debug, Clone)]
pub struct ConsoleConfig {
    pub host: String,
    pub port: u16,
    /// Index inside `/meters/1` where DCA meters begin. Calibrate per firmware; `32` matches the
    /// documented channel-first bank layout.
    pub dca_meter_offset: usize,
    pub dca_count: u8,
}

impl ConsoleConfig {
    pub fn new(host: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            port: DEFAULT_CONSOLE_PORT,
            dca_meter_offset: 32,
            dca_count: 8,
        }
    }

    pub fn endpoint(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

/// Commands the cue engine and Tauri commands can route to the console. Some variants are only
/// used by the cue engine's future expansion, so keep the surface stable.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq)]
pub enum ConsoleCommand {
    SetDcaMute { number: u8, muted: bool },
    SetDcaLevel { number: u8, db: f32 },
    SetChannelMute { channel: u8, muted: bool },
    SetChannelFader { channel: u8, fader: f32 },
    RecallScene { scene: u32 },
    Identify,
    RawOsc { address: String, value: f32 },
}

/// Start the adapter. Returns a handle that stops when the process stops or the command channel
/// closes.
pub fn spawn(
    config: ConsoleConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    commands: mpsc::UnboundedReceiver<ConsoleCommand>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let reporter = HealthReporter::new(
            "console",
            "Console",
            "Console",
            "Console OSC UDP :10023",
            state.clone(),
            sink.clone(),
        );
        run(config, state, sink, reporter, commands).await;
    })
}

async fn run(
    config: ConsoleConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    reporter: HealthReporter,
    mut commands: mpsc::UnboundedReceiver<ConsoleCommand>,
) {
    let mut backoff = Duration::from_millis(500);
    loop {
        reporter.connecting(format!("Opening OSC {}", config.endpoint()));
        let result = serve(&config, &state, &sink, &reporter, &mut commands, &mut backoff).await;
        match result {
            Ok(()) => {
                reporter.offline("OSC command channel closed");
                return;
            }
            Err(err) => {
                reporter.error(err.clone());
                sink.log(format!("[console] {err}"));
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_millis(15_000));
    }
}

async fn serve(
    config: &ConsoleConfig,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    reporter: &HealthReporter,
    commands: &mut mpsc::UnboundedReceiver<ConsoleCommand>,
    backoff: &mut Duration,
) -> Result<(), String> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("could not bind OSC socket: {e}"))?;
    socket
        .connect(config.endpoint())
        .await
        .map_err(|e| format!("could not reach {}: {e}", config.endpoint()))?;

    send(&socket, &OscMessage::xinfo()).await?;
    send(&socket, &OscMessage::xremote()).await?;
    send(&socket, &OscMessage::meters("/meters/1")).await?;
    send(&socket, &OscMessage::meters("/meters/4")).await?;
    let mut last_sent = Some(Instant::now());
    let mut last_rx = Instant::now();
    let mut ever_received = false;
    let mut sequence = 0u64;

    let mut keepalive = tokio::time::interval(Duration::from_millis(XREMOTE_INTERVAL_MS));
    keepalive.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut health_tick = tokio::time::interval(Duration::from_secs(2));
    health_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut meter_tick = tokio::time::interval(Duration::from_millis(1000 / METER_HZ as u64));
    meter_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    // First tick completes immediately; drain it so the keepalive is 8 s from now.
    keepalive.tick().await;
    health_tick.tick().await;
    meter_tick.tick().await;

    let mut pending_meter: Option<MeterFrame> = None;
    let mut buf = [0u8; 4096];

    loop {
        tokio::select! {
            packet = socket.recv(&mut buf) => {
                let n = packet.map_err(|e| format!("OSC receive failed: {e}"))?;
                last_rx = Instant::now();
                let rtt = last_sent
                    .map(|sent| sent.elapsed().as_millis().min(u32::MAX as u128) as u32)
                    .unwrap_or(0);
                if !ever_received {
                    ever_received = true;
                    *backoff = Duration::from_millis(500);
                    reporter.ready(format!("OSC live on {}", config.endpoint()), rtt.max(1));
                }
                let frame = &buf[..n];
                match OscMessage::decode(frame) {
                    Ok(message) => {
                        handle_message(message, config, state, sink, reporter, &mut pending_meter, rtt);
                    }
                    Err(err) => {
                        // Never let one malformed datagram kill the keepalive loop.
                        if err.to_string().contains("unsupported") {
                            sink.log(format!("[console] Ignored unsupported OSC packet: {err}"));
                        }
                    }
                }
            }
            _ = keepalive.tick() => {
                send(&socket, &OscMessage::xremote()).await?;
                send(&socket, &OscMessage::meters("/meters/1")).await?;
                send(&socket, &OscMessage::meters("/meters/4")).await?;
                last_sent = Some(Instant::now());
            }
            _ = health_tick.tick() => {
                let silence = last_rx.elapsed();
                if ever_received && silence > Duration::from_secs(10) {
                    reporter.degraded(format!(
                        "No `/xremote` push for {}s (console may have dropped the subscription)",
                        silence.as_secs()
                    ));
                }
                if !ever_received && silence > Duration::from_secs(12) {
                    return Err(format!(
                        "No OSC reply from {} after 12 s",
                        config.endpoint()
                    ));
                }
            }
            _ = meter_tick.tick() => {
                if let Some(frame) = pending_meter.take() {
                    sequence += 1;
                    emit_meters(frame, config, state, sink, sequence);
                }
            }
            command = commands.recv() => {
                let Some(command) = command else {
                    return Ok(());
                };
                handle_command(command, &socket, config, state, sink).await?;
                last_sent = Some(Instant::now());
            }
        }
    }
}

fn handle_message(
    message: OscMessage,
    config: &ConsoleConfig,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    reporter: &HealthReporter,
    pending_meter: &mut Option<MeterFrame>,
    rtt: u32,
) {
    match message.address.as_str() {
        "/info" | "/xinfo" | "/status" => {
            let text = string_arg(&message).unwrap_or_else(|| "(no payload)".into());
            reporter.ready(format!("/info: {text}"), rtt.max(1));
            sink.log(format!("[console] {text}"));
        }
        "/meters/1" | "/meters/2" => {
            if let Ok(frame) = parse_meters_message(&message) {
                *pending_meter = Some(frame);
            }
        }
        "/meters/4" => {
            if let Ok(frame) = parse_meters_message(&message) {
                let bands: Vec<f32> = frame
                    .levels
                    .iter()
                    .take(100)
                    .map(|&b| (b as f32 / 255.0).clamp(0.0, 1.0))
                    .collect();
                if !bands.is_empty() {
                    sink.emit_raw("console://rta", json!({ "bands": bands }));
                }
            }
        }
        other => {
            // Forward live hardware parameter pushes to ConsoleFullConsoleModal (`console://osc`).
            if let Some(first_val) = message.args.first().and_then(|a| match a {
                OscArg::Float(v) => Some(json!(*v)),
                OscArg::Int(v) => Some(json!(*v)),
                OscArg::Bool(v) => Some(json!(*v)),
                OscArg::String(s) => Some(json!(s)),
                _ => None,
            }) {
                sink.emit_raw("console://osc", json!({ "address": other, "value": first_val }));
            }

            if let Some((number, suffix)) = indexed_path(other, "/dca/") {
                match suffix {
                    "on" => {
                        if let Some(on) = int_arg(&message) {
                            emit_dcas(
                                state,
                                sink,
                                number,
                                Some(on == 0),
                                None,
                                "console DCA echo",
                            );
                        }
                    }
                    "fader" => {
                        if let Some(fader) = float_arg(&message) {
                            emit_dcas(
                                state,
                                sink,
                                number,
                                None,
                                fader_to_db(fader),
                                "console DCA echo",
                            );
                        }
                    }
                    _ => {}
                }
            } else if let Some((number, suffix)) = channel_path(other) {
                if matches!(suffix, "fader" | "on") {
                    let value = if suffix == "on" {
                        int_arg(&message).map(|v| json!(v != 0))
                    } else {
                        float_arg(&message).map(|v| json!(v))
                    };
                    let patch = json!({
                        "channel": format!("ch{number:02}"),
                        "parameter": suffix,
                        "value": value,
                    });
                    sink.state(state_patch("console", json!({ "lastChannelChange": patch })));
                }
            } else if other.starts_with("/main/") {
                let patch = json!({
                    "path": other,
                    "value": float_arg(&message).or_else(|| int_arg(&message).map(|v| v as f32)),
                });
                sink.state(state_patch("console", json!({ "lastMainChange": patch })));
            } else if other == "/-action/goscene" {
                if let Some(scene) = int_arg(&message) {
                    sink.log(format!("[console] Console recalled scene {scene}"));
                }
            } else if other.starts_with("/") && !other.starts_with("/x") && config.dca_count > 0 {
                // Recognized-but-not-yet-mapped path. Keep the log quiet; only surface unknown
                // action paths.
                if other.starts_with("/-action/") {
                    sink.log(format!("[console] Ignored action path {other}"));
                }
            }
        }
    }
}

async fn handle_command(
    command: ConsoleCommand,
    socket: &UdpSocket,
    config: &ConsoleConfig,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
) -> Result<(), String> {
    match command {
        ConsoleCommand::SetDcaMute { number, muted } => {
            if number == 0 || number > config.dca_count {
                sink.log(format!("[console] Ignored invalid DCA {number} (valid 1..={})", config.dca_count));
                return Ok(());
            }
            if let Ok(msg) = OscMessage::dca_on(number, !muted) {
                send(socket, &msg).await?;
                emit_dcas(state, sink, number, Some(muted), None, "optimistic DCA mute");
            }
        }
        ConsoleCommand::SetDcaLevel { number, db } => {
            if number == 0 || number > config.dca_count {
                sink.log(format!("[console] Ignored invalid DCA {number} (valid 1..={})", config.dca_count));
                return Ok(());
            }
            let fader = db_to_fader(db);
            if let Ok(msg) = OscMessage::dca_fader(number, fader) {
                send(socket, &msg).await?;
                emit_dcas(state, sink, number, None, fader_to_db(fader), "optimistic DCA level");
            }
        }
        ConsoleCommand::SetChannelMute { channel, muted } => {
            match OscMessage::channel_on(channel, !muted) {
                Ok(msg) => send(socket, &msg).await?,
                Err(e) => sink.log(format!("[console] Ignored invalid channel mute: {e}")),
            }
        }
        ConsoleCommand::SetChannelFader { channel, fader } => {
            match OscMessage::channel_fader(channel, fader) {
                Ok(msg) => send(socket, &msg).await?,
                Err(e) => sink.log(format!("[console] Ignored invalid channel fader: {e}")),
            }
        }
        ConsoleCommand::RecallScene { scene } => {
            match OscMessage::go_scene(scene) {
                Ok(msg) => {
                    send(socket, &msg).await?;
                    sink.log(format!(
                        "[console] Sent /-action/goscene {scene} (high-impact; confirmation enforced by cue engine)"
                    ));
                }
                Err(e) => sink.log(format!("[console] Ignored invalid scene recall: {e}")),
            }
        }
        ConsoleCommand::RawOsc { address, value } => {
            let arg = if raw_osc_uses_int(&address) {
                OscArg::Int(value.round() as i32)
            } else {
                OscArg::Float(value)
            };
            send(socket, &OscMessage::new(address, vec![arg])).await?
        }
        ConsoleCommand::Identify => {
            send(socket, &OscMessage::xinfo()).await?;
        }
    }
    Ok(())
}

fn emit_dcas(
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    number: u8,
    muted: Option<bool>,
    level_db: Option<f32>,
    reason: &str,
) {
    let (dcas, silent) = with_state(state, |snapshot| {
        let dcas = snapshot.apply_dca(number, muted, level_db);
        recompute_derived_alerts(snapshot);
        (dcas, snapshot.silent_mic_alert.clone())
    });
    sink.state(state_patch(
        "console",
        json!({ "dcas": dcas, "silentMicAlert": silent }),
    ));
    sink.log(format!("[console] DCA {number} update ({reason})"));
}

fn emit_meters(
    frame: MeterFrame,
    config: &ConsoleConfig,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    sequence: u64,
) {
    let channels = meter_channels(&frame, config);
    if channels.is_empty() {
        return;
    }
    sink.meter(MeterEvent::new("console", "console", sequence, channels.clone()));

    let (dcas, silent) = with_state(state, |snapshot| {
        for number in 1..=config.dca_count {
            let key = format!("dca{number}");
            if let Some(channel) = channels.iter().find(|c| c.key == key) {
                snapshot.apply_dca_meter(number, channel.db);
            }
        }
        recompute_derived_alerts(snapshot);
        (snapshot.dcas.clone(), snapshot.silent_mic_alert.clone())
    });
    sink.state(state_patch(
        "console",
        json!({ "dcas": dcas, "silentMicAlert": silent }),
    ));
}

/// Map `/meters/1` bytes to stable meter keys. Channels first, then the configured DCA window.
pub fn meter_channels(frame: &MeterFrame, config: &ConsoleConfig) -> Vec<MeterChannel> {
    let mut out = Vec::with_capacity(frame.levels.len());
    for (index, byte) in frame.levels.iter().copied().enumerate() {
        let db = meter_byte_to_db(byte);
        if index < 32 {
            out.push(MeterChannel {
                key: format!("ch{:02}", index + 1),
                label: format!("Ch {}", index + 1),
                db,
                peak: byte == 255,
                muted: false,
            });
        } else if index >= config.dca_meter_offset
            && index < config.dca_meter_offset + config.dca_count as usize
        {
            let number = (index - config.dca_meter_offset) as u8 + 1;
            out.push(MeterChannel {
                key: format!("dca{number}"),
                label: format!("DCA {number}"),
                db,
                peak: byte == 255,
                muted: false,
            });
        }
    }
    out
}

/// Console OSC endpoints that require an `i32` argument rather than a float. The console treats
/// non-integer values on these paths as malformed (or silently rounds them itself).
fn raw_osc_uses_int(address: &str) -> bool {
    let path = address.trim_end_matches('/');
    path == "/-action/goscene"
        || path == "/-action/clearsolo"
        || path.starts_with("/config/mute/")
        || (path.starts_with("/headamp/") && path.ends_with("/phantom"))
        || path == "/preamp/invert"
        || path.ends_with("/preamp/invert")
        || (path.starts_with("/preamp/") && path.ends_with("/invert"))
        || path == "/mix/solo"
        || path.ends_with("/mix/solo")
        || path == "/config/sync"
        || path.ends_with("/on")
}

fn indexed_path<'a>(address: &'a str, prefix: &str) -> Option<(u8, &'a str)> {
    let rest = address.strip_prefix(prefix)?;
    let (number, suffix) = rest.split_once('/')?;
    Some((number.parse().ok()?, suffix))
}

fn channel_path(address: &str) -> Option<(u8, &str)> {
    let rest = address.strip_prefix("/ch/")?;
    let (number, suffix) = rest.split_once('/')?;
    Some((number.parse().ok()?, suffix.strip_prefix("mix/").unwrap_or(suffix)))
}

fn float_arg(message: &OscMessage) -> Option<f32> {
    match message.args.first() {
        Some(OscArg::Float(v)) => Some(*v),
        Some(OscArg::Int(v)) => Some(*v as f32),
        _ => None,
    }
}

fn int_arg(message: &OscMessage) -> Option<i32> {
    match message.args.first() {
        Some(OscArg::Int(v)) => Some(*v),
        Some(OscArg::Float(v)) => Some(*v as i32),
        Some(OscArg::Bool(v)) => Some(if *v { 1 } else { 0 }),
        _ => None,
    }
}

fn string_arg(message: &OscMessage) -> Option<String> {
    match message.args.first() {
        Some(OscArg::String(s)) => Some(s.clone()),
        _ => None,
    }
}

async fn send(socket: &UdpSocket, message: &OscMessage) -> Result<(), String> {
    socket
        .send(&message.encode())
        .await
        .map(|_| ())
        .map_err(|e| format!("OSC send failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocols::console_osc::OscArg;
    use crate::runtime::events::RecordingSink;
    use crate::state::default_simulator_state;
    use std::sync::Mutex;

    fn fixture() -> (SharedState, Arc<RecordingSink>) {
        use crate::state::DcaChannel;
        let mut s = default_simulator_state();
        s.dcas.push(DcaChannel {
            id: "dca1".into(),
            number: 1,
            name: "Pastor".into(),
            muted: false,
            level_db: 0.0,
            min_db: -3.0,
            max_db: 3.0,
            guard_mute: false,
            signal_db: -40.0,
            signal_present: false,
            aoip_tx_channel: "Ch 01".into(),
        });
        let state = Arc::new(Mutex::new(s));
        let sink = Arc::new(RecordingSink::new());
        (state, sink)
    }

    #[test]
    fn maps_first_32_bytes_to_channels() {
        let config = ConsoleConfig::new("127.0.0.1");
        let frame = MeterFrame {
            levels: (0..40).map(|i| i as u8 + 1).collect(),
        };
        let channels = meter_channels(&frame, &config);
        assert_eq!(channels[0].key, "ch01");
        assert_eq!(channels[31].key, "ch32");
        assert_eq!(channels.len(), 40);
        assert_eq!(channels[32].key, "dca1");
        assert_eq!(channels[39].key, "dca8");
    }

    #[test]
    fn meter_patch_updates_dca_signal() {
        let (state, sink) = fixture();
        let events = sink.as_event_sink();
        with_state(&state, |s| s.mock_mode = false);
        let config = ConsoleConfig::new("127.0.0.1");
        let mut levels = vec![0u8; 33];
        levels[32] = 241; // DCA 1 ≈ −1.5 dBFS
        let frame = MeterFrame { levels };
        emit_meters(frame, &config, &state, &events, 1);
        let pastor = with_state(&state, |s| s.dcas[0].clone());
        assert!(pastor.signal_present);
        assert!(pastor.signal_db > -5.0);
        assert_eq!(sink.snapshot().meters.len(), 1);
        assert!(!sink.snapshot().states.is_empty());
    }

    #[test]
    fn dca_echo_updates_mute_and_alerts() {
        let (state, sink) = fixture();
        let message = OscMessage::new("/dca/1/on", vec![OscArg::Int(0)]);
        let events = sink.as_event_sink();
        let reporter = HealthReporter::new(
            "console",
            "Console",
            "Console",
            "OSC",
            state.clone(),
            events.clone(),
        );
        let config = ConsoleConfig::new("127.0.0.1");
        let mut pending = None;
        handle_message(message, &config, &state, &events, &reporter, &mut pending, 1);
        assert!(with_state(&state, |s| s.dcas[0].muted));
        assert!(sink.snapshot().states.iter().any(|p| p.patch.get("dcas").is_some()));
    }

    #[test]
    fn type_tag_helpers_accept_int_float() {
        let message = OscMessage::new(
            "/dca/1/fader",
            vec![OscArg::Int(1), OscArg::Float(0.5)],
        );
        assert_eq!(float_arg(&message), Some(1.0));
        assert_eq!(int_arg(&message), Some(1));
        assert_eq!(string_arg(&message), None);
    }

    #[test]
    fn raw_osc_integer_endpoints_are_classified() {
        for path in [
            "/-action/goscene",
            "/-action/clearsolo",
            "/config/mute/3",
            "/headamp/12/phantom",
            "/preamp/invert",
            "/preamp/4/invert",
            "/mix/solo",
            "/ch/01/mix/solo",
            "/config/sync",
            "/ch/01/mix/on",
            "/ch/01/insert/on",
        ] {
            assert!(raw_osc_uses_int(path), "{path} should use an int argument");
        }
        for path in [
            "/ch/01/mix/fader",
            "/main/mix/fader",
            "/ch/01/mix/pan",
            "/config/sync/interval",
        ] {
            assert!(!raw_osc_uses_int(path), "{path} should use a float argument");
        }
    }
}
