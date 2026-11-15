//! Live Behringer X32 / Midas M32 adapter (OSC over UDP `:10023`).
//!
//! Uses the clean-room codec in [`crate::protocols::x32`] and implements the Phase 2 contract:
//!
//! * `/xinfo` identity probe, then `/xremote` every 8 s (< 10 s expiry).
//! * Bidirectional parameter updates for DCAs, channels, and Main LR.
//! * `/meters/1` frames coalesced to a 20 Hz latest-wins `meter://x32` stream.
//! * Optimistic state patches after writes, reconciled by the `/xremote` echo.
//! * Exponential reconnect backoff and `device://health` transitions.

use crate::protocols::x32::{
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

pub const DEFAULT_X32_PORT: u16 = 10023;
pub const METER_HZ: u32 = 20;

#[derive(Debug, Clone)]
pub struct X32Config {
    pub host: String,
    pub port: u16,
    /// Index inside `/meters/1` where DCA meters begin. Calibrate per firmware; `32` matches the
    /// documented channel-first bank layout.
    pub dca_meter_offset: usize,
    pub dca_count: u8,
}

impl X32Config {
    pub fn new(host: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            port: DEFAULT_X32_PORT,
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
pub enum X32Command {
    SetDcaMute { number: u8, muted: bool },
    SetDcaLevel { number: u8, db: f32 },
    SetChannelMute { channel: u8, muted: bool },
    SetChannelFader { channel: u8, fader: f32 },
    RecallScene { scene: u32 },
    Identify,
}

/// Start the adapter. Returns a handle that stops when the process stops or the command channel
/// closes.
pub fn spawn(
    config: X32Config,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    commands: mpsc::UnboundedReceiver<X32Command>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let reporter = HealthReporter::new(
            "x32",
            "X32",
            "X32",
            "X32 OSC UDP :10023",
            state.clone(),
            sink.clone(),
        );
        run(config, state, sink, reporter, commands).await;
    })
}

async fn run(
    config: X32Config,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    reporter: HealthReporter,
    mut commands: mpsc::UnboundedReceiver<X32Command>,
) {
    let mut backoff = Duration::from_millis(500);
    loop {
        reporter.connecting(format!("Opening OSC {}", config.endpoint()));
        let result = serve(&config, &state, &sink, &reporter, &mut commands).await;
        match result {
            Ok(()) => {
                reporter.offline("OSC command channel closed");
                return;
            }
            Err(err) => {
                reporter.error(err.clone());
                sink.log(format!("[x32] {err}"));
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_millis(15_000));
    }
}

async fn serve(
    config: &X32Config,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    reporter: &HealthReporter,
    commands: &mut mpsc::UnboundedReceiver<X32Command>,
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
                            sink.log(format!("[x32] Ignored unsupported OSC packet: {err}"));
                        }
                    }
                }
            }
            _ = keepalive.tick() => {
                send(&socket, &OscMessage::xremote()).await?;
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
    config: &X32Config,
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
            sink.log(format!("[x32] {text}"));
        }
        "/meters/1" | "/meters/2" => {
            if let Ok(frame) = parse_meters_message(&message) {
                *pending_meter = Some(frame);
            }
        }
        other => {
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
                                "x32 DCA echo",
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
                                "x32 DCA echo",
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
                    sink.state(state_patch("x32", json!({ "lastChannelChange": patch })));
                }
            } else if other.starts_with("/main/") {
                let patch = json!({
                    "path": other,
                    "value": float_arg(&message).or_else(|| int_arg(&message).map(|v| v as f32)),
                });
                sink.state(state_patch("x32", json!({ "lastMainChange": patch })));
            } else if other == "/-action/goscene" {
                if let Some(scene) = int_arg(&message) {
                    sink.log(format!("[x32] Console recalled scene {scene}"));
                }
            } else if other.starts_with("/") && !other.starts_with("/x") && config.dca_count > 0 {
                // Recognized-but-not-yet-mapped path. Keep the log quiet; only surface unknown
                // action paths.
                if other.starts_with("/-action/") {
                    sink.log(format!("[x32] Ignored action path {other}"));
                }
            }
        }
    }
}

async fn handle_command(
    command: X32Command,
    socket: &UdpSocket,
    config: &X32Config,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
) -> Result<(), String> {
    match command {
        X32Command::SetDcaMute { number, muted } => {
            if number == 0 || number > config.dca_count {
                return Err(format!("DCA {number} outside configured 1..={}", config.dca_count));
            }
            send(socket, &OscMessage::dca_on(number, !muted).map_err(|e| e.to_string())?).await?;
            emit_dcas(state, sink, number, Some(muted), None, "optimistic DCA mute");
        }
        X32Command::SetDcaLevel { number, db } => {
            if number == 0 || number > config.dca_count {
                return Err(format!("DCA {number} outside configured 1..={}", config.dca_count));
            }
            let fader = db_to_fader(db);
            send(socket, &OscMessage::dca_fader(number, fader).map_err(|e| e.to_string())?).await?;
            emit_dcas(state, sink, number, None, fader_to_db(fader), "optimistic DCA level");
        }
        X32Command::SetChannelMute { channel, muted } => {
            send(
                socket,
                &OscMessage::channel_on(channel, !muted).map_err(|e| e.to_string())?,
            )
            .await?;
        }
        X32Command::SetChannelFader { channel, fader } => {
            send(
                socket,
                &OscMessage::channel_fader(channel, fader).map_err(|e| e.to_string())?,
            )
            .await?;
        }
        X32Command::RecallScene { scene } => {
            send(socket, &OscMessage::go_scene(scene).map_err(|e| e.to_string())?).await?;
            sink.log(format!(
                "[x32] Sent /-action/goscene {scene} (high-impact; confirmation enforced by cue engine)"
            ));
        }
        X32Command::Identify => {
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
        "x32",
        json!({ "dcas": dcas, "silentMicAlert": silent }),
    ));
    sink.log(format!("[x32] DCA {number} update ({reason})"));
}

fn emit_meters(
    frame: MeterFrame,
    config: &X32Config,
    state: &SharedState,
    sink: &Arc<dyn EventSink>,
    sequence: u64,
) {
    let channels = meter_channels(&frame, config);
    if channels.is_empty() {
        return;
    }
    sink.meter(MeterEvent::new("x32", "x32", sequence, channels.clone()));

    let (dcas, silent) = with_state(state, |snapshot| {
        for number in 1..=config.dca_count {
            if let Some(index) = dca_meter_index(number, config) {
                if let Some(channel) = channels.get(index) {
                    snapshot.apply_dca_meter(number, channel.db);
                }
            }
        }
        recompute_derived_alerts(snapshot);
        (snapshot.dcas.clone(), snapshot.silent_mic_alert.clone())
    });
    sink.state(state_patch(
        "x32",
        json!({ "dcas": dcas, "silentMicAlert": silent }),
    ));
}

/// Map `/meters/1` bytes to stable meter keys. Channels first, then the configured DCA window.
pub fn meter_channels(frame: &MeterFrame, config: &X32Config) -> Vec<MeterChannel> {
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

fn dca_meter_index(number: u8, config: &X32Config) -> Option<usize> {
    let index = config.dca_meter_offset + (number as usize - 1);
    Some(index)
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
    use crate::protocols::x32::OscArg;
    use crate::runtime::events::RecordingSink;
    use crate::state::default_simulator_state;
    use std::sync::Mutex;

    fn fixture() -> (SharedState, Arc<RecordingSink>) {
        let state = Arc::new(Mutex::new(default_simulator_state()));
        let sink = Arc::new(RecordingSink::new());
        (state, sink)
    }

    #[test]
    fn maps_first_32_bytes_to_channels() {
        let config = X32Config::new("127.0.0.1");
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
        let config = X32Config::new("127.0.0.1");
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
            "x32",
            "X32",
            "X32",
            "OSC",
            state.clone(),
            events.clone(),
        );
        let config = X32Config::new("127.0.0.1");
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
}
