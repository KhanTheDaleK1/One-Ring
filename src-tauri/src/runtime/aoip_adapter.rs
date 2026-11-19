//! Live Primary Aoip runtime adapter (`Conmon` UDP multicast + `ARC` routing control).

use crate::protocols::aoip::{
    self, AoipControlFrame, AoipStatusReply, ArcSubscription, ConmonFraming, ConmonHeader,
    AoipMeterLevel, AoipRxStatus,
};
use crate::runtime::events::{state_patch, EventSink};
use serde_json::json;
use crate::runtime::health::HealthReporter;
use crate::state::{recompute_derived_alerts, with_state, SharedState};
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::UdpSocket;
use tokio::sync::mpsc;

pub const AOIP_CONMON_MULTICAST_INFO: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 230);
pub const AOIP_CONMON_MULTICAST_METERS: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 232);
pub const AOIP_CONMON_CONTROL_PORT: u16 = 8700;
pub const AOIP_CONMON_METER_PORT: u16 = 8751;
pub const AOIP_ARC_DEFAULT_PORT: u16 = 4440;

#[derive(Debug, Clone)]
pub struct AoipConfig {
    pub bind_ip: Ipv4Addr,
    pub meter_port: u16,
    pub arc_port: u16,
}

impl Default for AoipConfig {
    fn default() -> Self {
        Self {
            bind_ip: Ipv4Addr::UNSPECIFIED,
            meter_port: AOIP_CONMON_METER_PORT,
            arc_port: AOIP_ARC_DEFAULT_PORT,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum AoipCommand {
    IdentifyDevice { target_ip: String },
    RouteCrosspoint {
        rx_ip: String,
        rx_port: u16,
        rx_channel_id: u16,
        tx_channel: String,
        tx_device: String,
    },
    PollStatus,
    SetSampleRate {
        target_ip: String,
        sample_rate_hz: u32,
    },
    SetLatencyMs {
        target_ip: String,
        latency_ms: f32,
    },
    SetDeviceLock {
        target_ip: String,
        locked: bool,
    },
    SetClockLeader {
        target_ip: String,
        leader: String,
    },
}

/// Send one encoded control frame to a device's Conmon control port.
async fn send_control(
    sock: &UdpSocket,
    target_ip: &str,
    frame: AoipControlFrame,
    sequence: u32,
) -> Result<(), String> {
    let bytes = frame.encode(sequence).map_err(|e| e.to_string())?;
    let dest = format!("{}:{}", target_ip, AOIP_CONMON_CONTROL_PORT);
    sock.send_to(&bytes, &dest).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Periodic RFC 6762 discovery of AoIP control services.
///
/// Emits `aoip://devices` with both the raw device descriptors and a name -> IP mapping that the
/// matrix UI uses to replace empty IPs with real discovered addresses.
async fn run_mdns_discovery(sink: Arc<dyn EventSink>) {
    let Ok(sock) = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0)).await else {
        sink.log("[aoip-mdns] Unable to bind an ephemeral socket for discovery".to_string());
        return;
    };
    let _ = sock.join_multicast_v4(aoip::MDNS_GROUP, Ipv4Addr::UNSPECIFIED);

    let mut tick = tokio::time::interval(Duration::from_secs(12));
    let mut buf = [0u8; 2048];
    let mut seen: HashMap<String, aoip::AoipDiscoveredDevice> = HashMap::new();
    let mut last_reported = 0usize;

    loop {
        tick.tick().await;
        for query in aoip::mdns_discovery_queries() {
            let _ = sock
                .send_to(&query, (aoip::MDNS_GROUP, aoip::MDNS_PORT))
                .await;
        }

        // Collect unicast/multicast responses for a short window, then publish what we have.
        let deadline = tokio::time::Instant::now() + Duration::from_millis(1500);
        while tokio::time::Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            match tokio::time::timeout(remaining, sock.recv_from(&mut buf)).await {
                Ok(Ok((len, _src))) => {
                    // QR bit must be set; our own queries are standard queries (flags 0x0000).
                    if len < 12 || buf[2] & 0x80 == 0 {
                        continue;
                    }
                    if let Ok(devices) = aoip::parse_mdns_response(&buf[..len]) {
                        for device in devices {
                            seen.insert(device.name.to_ascii_lowercase(), device);
                        }
                    }
                }
                _ => break,
            }
        }

        if seen.is_empty() {
            continue;
        }
        let mut devices: Vec<aoip::AoipDiscoveredDevice> = seen.values().cloned().collect();
        devices.sort_by(|a, b| a.name.cmp(&b.name));

        let mut mapping: HashMap<String, String> = HashMap::new();
        let descriptors: Vec<serde_json::Value> = devices
            .iter()
            .map(|device| {
                let ip = device.ip.map(|v| v.to_string()).unwrap_or_default();
                if !ip.is_empty() {
                    mapping.insert(device.name.clone(), ip.clone());
                }
                json!({
                    "name": device.name,
                    "host": device.host,
                    "ip": ip,
                    "port": device.port,
                    "channels": device.channels,
                })
            })
            .collect();

        sink.emit_raw(
            "aoip://devices",
            json!({ "devices": descriptors, "mapping": mapping }),
        );
        if devices.len() != last_reported {
            sink.log(format!(
                "[aoip-mdns] discovered {} AoIP control service device(s)",
                devices.len()
            ));
            last_reported = devices.len();
        }
    }
}

pub fn spawn(
    config: AoipConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    mut rx: mpsc::UnboundedReceiver<AoipCommand>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let health = HealthReporter::new(
            "aoip",
            "aoip",
            "Aoip",
            "Conmon/ARC UDP :8751",
            state.clone(),
            sink.clone(),
        );
        health.connecting("Binding Conmon multicast :8751...");

        // Zero-conf discovery runs independently of the Conmon/ARC datagram loop.
        let discovery_sink = sink.clone();
        tokio::spawn(async move { run_mdns_discovery(discovery_sink).await; });

        let meter_sock = match UdpSocket::bind(SocketAddrV4::new(config.bind_ip, config.meter_port)).await {
            Ok(sock) => {
                let _ = sock.join_multicast_v4(AOIP_CONMON_MULTICAST_METERS, Ipv4Addr::UNSPECIFIED);
                let _ = sock.join_multicast_v4(AOIP_CONMON_MULTICAST_INFO, Ipv4Addr::UNSPECIFIED);
                health.ready("Listening on Conmon UDP :8751 multicast", 1);
                Some(sock)
            }
            Err(e) => {
                let bind_addr = SocketAddrV4::new(config.bind_ip, config.meter_port);
                sink.log(format!(
                    "[aoip-conmon] Could not bind UDP {bind_addr} ({e}); using an ephemeral UDP source port so ARC control commands remain available"
                ));
                health.degraded(format!(
                    "Conmon {bind_addr} bind failed ({e}); ephemeral fallback active"
                ));
                UdpSocket::bind("0.0.0.0:0").await.ok()
            }
        };

        let Some(sock) = meter_sock else {
            return;
        };

        let mut buf = [0u8; 2048];
        let mut sequence: u32 = 1;
        let mut poll_tick = tokio::time::interval(Duration::from_secs(10));

        loop {
            tokio::select! {
                cmd = rx.recv() => {
                    let Some(cmd) = cmd else { break; };
                    match cmd {
                        AoipCommand::IdentifyDevice { target_ip } => {
                            let hdr = ConmonHeader::request(aoip::op::IDENTIFY_QUERY, ConmonFraming::Spec24)
                                .with_sequence(sequence);
                            sequence = sequence.wrapping_add(1);
                            if let Ok(bytes) = hdr.encode(&[]) {
                                let dest = format!("{}:{}", target_ip, AOIP_CONMON_CONTROL_PORT);
                                let _ = sock.send_to(&bytes, &dest).await;
                                sink.log(format!("[aoip-conmon] Sent IDENTIFY_QUERY (0x0063) -> {}", dest));
                            }
                        }
                        AoipCommand::RouteCrosspoint { rx_ip, rx_port, rx_channel_id, tx_channel, tx_device } => {
                            let port = if rx_port == 0 { config.arc_port } else { rx_port };
                            let subscription = ArcSubscription {
                                dest_device: rx_ip.clone(),
                                dest_rx_channel: rx_channel_id,
                                source_channel: tx_channel.clone(),
                                source_device: tx_device.clone(),
                            };
                            let dest = format!("{}:{}", rx_ip, port);
                            let _ = sock.send_to(&subscription.encode(), &dest).await;
                            sink.log(format!(
                                "[aoip-arc] RX_CHANNEL_SUB_SET ch={} <- {}@{} ({})",
                                rx_channel_id, tx_channel, tx_device, dest
                            ));
                        }
                        AoipCommand::PollStatus => {
                            let hdr = ConmonHeader::request(aoip::op::VERSIONS_QUERY, ConmonFraming::Spec24)
                                .with_sequence(sequence);
                            sequence = sequence.wrapping_add(1);
                            if let Ok(bytes) = hdr.encode(&[]) {
                                let _ = sock.send_to(&bytes, (AOIP_CONMON_MULTICAST_INFO, AOIP_CONMON_CONTROL_PORT)).await;
                            }
                        }
                        AoipCommand::SetSampleRate { target_ip, sample_rate_hz } => {
                            match AoipControlFrame::sample_rate_hz(sample_rate_hz) {
                                Ok(frame) => match send_control(&sock, &target_ip, frame, sequence).await {
                                    Ok(()) => sink.log(format!("[aoip-conmon] SRATE_CONTROL {sample_rate_hz} Hz -> {target_ip}")),
                                    Err(e) => sink.log(format!("[aoip-conmon] SRATE_CONTROL failed: {e}")),
                                },
                                Err(e) => sink.log(format!("[aoip-conmon] {e}")),
                            }
                            sequence = sequence.wrapping_add(1);
                        }
                        AoipCommand::SetLatencyMs { target_ip, latency_ms } => {
                            match AoipControlFrame::latency_ms(latency_ms) {
                                Ok(frame) => match send_control(&sock, &target_ip, frame, sequence).await {
                                    Ok(()) => sink.log(format!("[aoip-conmon] LATENCY_CONTROL {latency_ms} ms -> {target_ip}")),
                                    Err(e) => sink.log(format!("[aoip-conmon] LATENCY_CONTROL failed: {e}")),
                                },
                                Err(e) => sink.log(format!("[aoip-conmon] {e}")),
                            }
                            sequence = sequence.wrapping_add(1);
                        }
                        AoipCommand::SetDeviceLock { target_ip, locked } => {
                            let frame = AoipControlFrame::DeviceLock(locked);
                            match send_control(&sock, &target_ip, frame, sequence).await {
                                Ok(()) => sink.log(format!("[aoip-conmon] DEVICE_LOCK_CONTROL {locked} -> {target_ip}")),
                                Err(e) => sink.log(format!("[aoip-conmon] DEVICE_LOCK_CONTROL failed: {e}")),
                            }
                            sequence = sequence.wrapping_add(1);
                        }
                        AoipCommand::SetClockLeader { target_ip, leader } => {
                            match AoipControlFrame::clock_leader(leader) {
                                Ok(frame) => match send_control(&sock, &target_ip, frame, sequence).await {
                                    Ok(()) => sink.log(format!("[aoip-conmon] CLOCKING_CONTROL leader preference -> {target_ip}")),
                                    Err(e) => sink.log(format!("[aoip-conmon] CLOCKING_CONTROL failed: {e}")),
                                },
                                Err(e) => sink.log(format!("[aoip-conmon] {e}")),
                            }
                            sequence = sequence.wrapping_add(1);
                        }
                    }
                }
                recv_res = sock.recv_from(&mut buf) => {
                    if let Ok((len, src)) = recv_res {
                        let pkt = &buf[..len];
                        if let Ok(hdr) = ConmonHeader::parse_auto(pkt) {
                            if let Ok(payload) = hdr.payload(pkt) {
                                if hdr.opcode == aoip::op::METERING_STATUS {
                                    let meters = aoip::parse_metering_frame(payload);
                                    if !meters.is_empty() {
                                        let muted_count = meters.iter().filter(|m| matches!(m, AoipMeterLevel::Mute)).count();
                                        let (fault, alert) = with_state(&state, |snap| {
                                            snap.beltpack_fault_simulated = muted_count > 0;
                                            recompute_derived_alerts(snap);
                                            (snap.beltpack_fault_simulated, snap.silent_mic_alert.clone())
                                        });
                                        sink.state(state_patch(
                                            "aoip",
                                            json!({
                                                "beltpackFaultSimulated": fault,
                                                "silentMicAlert": alert,
                                            }),
                                        ));

                                        // Live per-channel dBFS peaks for the matrix UI.
                                        let meter_rows: Vec<serde_json::Value> = meters
                                            .iter()
                                            .enumerate()
                                            .filter_map(|(index, level)| {
                                                level.db().map(|dbfs| {
                                                    json!({
                                                        "index": index,
                                                        "channel": index + 1,
                                                        "dbfs": dbfs,
                                                        "peak": level.is_clipping(),
                                                        "muted": matches!(level, AoipMeterLevel::Mute),
                                                    })
                                                })
                                            })
                                            .collect();
                                        if !meter_rows.is_empty() {
                                            sink.emit_raw("aoip://meters", json!({
                                                "source": src.ip().to_string(),
                                                "device": src.ip().to_string(),
                                                "sequence": hdr.sequence,
                                                "channels": meter_rows,
                                            }));
                                        }
                                        health.ready(format!("Conmon meters active ({} ch from {})", meters.len(), src.ip()), 1);
                                    }
                                } else {
                                    let status = AoipRxStatus::Unicast.label();
                                    health.ready(format!("Conmon packet op=0x{:04X} ({})", hdr.opcode, status), 1);
                                }
                            }
                        }
                        if let Ok(reply) = AoipStatusReply::parse(pkt) {
                            health.ready(
                                format!(
                                    "ARC RXSTATUS ch={} -> {}",
                                    reply.rx_channel_id,
                                    reply.status.label()
                                ),
                                1,
                            );
                        }
                    }
                }
                _ = poll_tick.tick() => {
                    let hdr = ConmonHeader::request(aoip::op::CLOCKING_STATUS, ConmonFraming::Spec24)
                        .with_sequence(sequence);
                    sequence = sequence.wrapping_add(1);
                    if let Ok(bytes) = hdr.encode(&[]) {
                        let _ = sock.send_to(&bytes, (AOIP_CONMON_MULTICAST_INFO, AOIP_CONMON_CONTROL_PORT)).await;
                    }
                }
            }
        }
    })
}
