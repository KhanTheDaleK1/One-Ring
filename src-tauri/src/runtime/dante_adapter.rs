//! Live Audinate Dante runtime adapter (`Conmon` UDP multicast + `ARC` routing control).

use crate::protocols::dante::{
    self, ArcPacket, ConmonFraming, ConmonHeader, DanteMeterLevel, DanteRxStatus,
};
use crate::runtime::events::{state_patch, EventSink};
use serde_json::json;
use crate::runtime::health::HealthReporter;
use crate::state::{recompute_derived_alerts, with_state, SharedState};
use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::UdpSocket;
use tokio::sync::mpsc;

pub const DANTE_CONMON_MULTICAST_INFO: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 230);
pub const DANTE_CONMON_MULTICAST_METERS: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 232);
pub const DANTE_CONMON_CONTROL_PORT: u16 = 8700;
pub const DANTE_CONMON_METER_PORT: u16 = 8751;
pub const DANTE_ARC_DEFAULT_PORT: u16 = 4440;

#[derive(Debug, Clone)]
pub struct DanteConfig {
    pub bind_ip: Ipv4Addr,
    pub meter_port: u16,
    pub arc_port: u16,
}

impl Default for DanteConfig {
    fn default() -> Self {
        Self {
            bind_ip: Ipv4Addr::UNSPECIFIED,
            meter_port: DANTE_CONMON_METER_PORT,
            arc_port: DANTE_ARC_DEFAULT_PORT,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum DanteCommand {
    IdentifyDevice { target_ip: String },
    RouteCrosspoint {
        rx_ip: String,
        rx_port: u16,
        rx_channel_id: u16,
        tx_channel: String,
        tx_device: String,
    },
    PollStatus,
}

pub fn spawn(
    config: DanteConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    mut rx: mpsc::UnboundedReceiver<DanteCommand>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let health = HealthReporter::new(
            "dante",
            "dante",
            "Dante",
            "Conmon/ARC UDP :8751",
            state.clone(),
            sink.clone(),
        );
        health.connecting("Binding Conmon multicast :8751...");

        let meter_sock = match UdpSocket::bind(SocketAddrV4::new(config.bind_ip, config.meter_port)).await {
            Ok(sock) => {
                let _ = sock.join_multicast_v4(DANTE_CONMON_MULTICAST_METERS, Ipv4Addr::UNSPECIFIED);
                let _ = sock.join_multicast_v4(DANTE_CONMON_MULTICAST_INFO, Ipv4Addr::UNSPECIFIED);
                health.ready("Listening on Conmon UDP :8751 multicast", 1);
                Some(sock)
            }
            Err(e) => {
                let bind_addr = SocketAddrV4::new(config.bind_ip, config.meter_port);
                sink.log(format!(
                    "[dante-conmon] Could not bind UDP {bind_addr} ({e}); using an ephemeral UDP source port so ARC control commands remain available"
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
                        DanteCommand::IdentifyDevice { target_ip } => {
                            let hdr = ConmonHeader::request(dante::op::IDENTIFY_QUERY, ConmonFraming::Spec24)
                                .with_sequence(sequence);
                            sequence = sequence.wrapping_add(1);
                            if let Ok(bytes) = hdr.encode(&[]) {
                                let dest = format!("{}:{}", target_ip, DANTE_CONMON_CONTROL_PORT);
                                let _ = sock.send_to(&bytes, &dest).await;
                                sink.log(format!("[dante-conmon] Sent IDENTIFY_QUERY (0x0063) -> {}", dest));
                            }
                        }
                        DanteCommand::RouteCrosspoint { rx_ip, rx_port, rx_channel_id, tx_channel, tx_device } => {
                            let port = if rx_port == 0 { config.arc_port } else { rx_port };
                            let mut body = Vec::with_capacity(64);
                            body.extend_from_slice(&0x3010u16.to_be_bytes());
                            body.extend_from_slice(&0u16.to_be_bytes());
                            body.extend_from_slice(&rx_channel_id.to_be_bytes());
                            body.extend_from_slice(tx_channel.as_bytes());
                            body.push(0);
                            body.extend_from_slice(tx_device.as_bytes());
                            body.push(0);

                            let pkt = ArcPacket::new(body);
                            let dest = format!("{}:{}", rx_ip, port);
                            let _ = sock.send_to(&pkt.encode(), &dest).await;
                            sink.log(format!(
                                "[dante-arc] RX_CHANNEL_SUB_SET ch={} <- {}@{} ({})",
                                rx_channel_id, tx_channel, tx_device, dest
                            ));
                        }
                        DanteCommand::PollStatus => {
                            let hdr = ConmonHeader::request(dante::op::VERSIONS_QUERY, ConmonFraming::Spec24)
                                .with_sequence(sequence);
                            sequence = sequence.wrapping_add(1);
                            if let Ok(bytes) = hdr.encode(&[]) {
                                let _ = sock.send_to(&bytes, (DANTE_CONMON_MULTICAST_INFO, DANTE_CONMON_CONTROL_PORT)).await;
                            }
                        }
                    }
                }
                recv_res = sock.recv_from(&mut buf) => {
                    if let Ok((len, src)) = recv_res {
                        let pkt = &buf[..len];
                        if let Ok(hdr) = ConmonHeader::parse_auto(pkt) {
                            if let Ok(payload) = hdr.payload(pkt) {
                                if hdr.opcode == dante::op::METERING_STATUS {
                                    let meters = dante::parse_metering_frame(payload);
                                    if !meters.is_empty() {
                                        let muted_count = meters.iter().filter(|m| matches!(m, DanteMeterLevel::Mute)).count();
                                        let (fault, alert) = with_state(&state, |snap| {
                                            snap.beltpack_fault_simulated = muted_count > 0;
                                            recompute_derived_alerts(snap);
                                            (snap.beltpack_fault_simulated, snap.silent_mic_alert.clone())
                                        });
                                        sink.state(state_patch(
                                            "dante",
                                            json!({
                                                "beltpackFaultSimulated": fault,
                                                "silentMicAlert": alert,
                                            }),
                                        ));
                                        health.ready(format!("Conmon meters active ({} ch from {})", meters.len(), src.ip()), 1);
                                    }
                                } else {
                                    let status = DanteRxStatus::Unicast.label();
                                    health.ready(format!("Conmon packet op=0x{:04X} ({})", hdr.opcode, status), 1);
                                }
                            }
                        }
                    }
                }
                _ = poll_tick.tick() => {
                    let hdr = ConmonHeader::request(dante::op::CLOCKING_STATUS, ConmonFraming::Spec24)
                        .with_sequence(sequence);
                    sequence = sequence.wrapping_add(1);
                    if let Ok(bytes) = hdr.encode(&[]) {
                        let _ = sock.send_to(&bytes, (DANTE_CONMON_MULTICAST_INFO, DANTE_CONMON_CONTROL_PORT)).await;
                    }
                }
            }
        }
    })
}
