//! Live NDI 6 Discovery Service (`TCP :5959`) & PTZ Control Adapter.

use crate::protocols::ndi::{self, NdiMessage};
use crate::runtime::events::EventSink;
use crate::runtime::health::HealthReporter;
use crate::state::{with_state, NdiReceiver as StateNdiReceiver, SharedState};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

pub const NDI_DISCOVERY_PORT: u16 = 5959;

#[derive(Debug, Clone)]
pub struct NdiConfig {
    pub discovery_host: String,
    pub discovery_port: u16,
    pub listener_id: String,
}

impl Default for NdiConfig {
    fn default() -> Self {
        Self {
            discovery_host: "127.0.0.1".into(),
            discovery_port: NDI_DISCOVERY_PORT,
            listener_id: "one-ring-controller".into(),
        }
    }
}

impl NdiConfig {
    pub fn endpoint(&self) -> String {
        format!("{}:{}", self.discovery_host, self.discovery_port)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum NdiCommand {
    RefreshTopology,
    ControlReceiver {
        receiver_id: String,
        source_name: String,
    },
    RecallPtzPreset {
        source_id: String,
        preset_index: u8,
        speed: f64,
    },
    PanTiltSpeed {
        source_id: String,
        pan: f64,
        tilt: f64,
    },
}

pub fn spawn(
    config: NdiConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    mut rx: mpsc::UnboundedReceiver<NdiCommand>,
) {
    tokio::spawn(async move {
        let health = HealthReporter::new(
            "ndi",
            "ndi",
            "NDI 6",
            "Discovery TCP :5959",
            state.clone(),
            sink.clone(),
        );
        let mut backoff = Duration::from_secs(1);

        loop {
            health.connecting(format!("Connecting to NDI Discovery {}...", config.endpoint()));
            match tokio::time::timeout(Duration::from_secs(3), TcpStream::connect(config.endpoint())).await {
                Ok(Ok(mut stream)) => {
                    backoff = Duration::from_secs(1);
                    health.ready(format!("Connected to NDI Discovery {}", config.endpoint()), 2);

                    let hs = ndi::encode_message(&ndi::handshake_listener(&config.listener_id));
                    if stream.write_all(&hs).await.is_err() {
                        continue;
                    }
                    let _ = stream.write_all(&ndi::encode_message(&ndi::query_sources())).await;
                    let _ = stream.write_all(&ndi::encode_message(&ndi::query_receivers())).await;

                    let mut read_buf = vec![0u8; 8192];
                    let mut refresh_tick = tokio::time::interval(Duration::from_secs(12));

                    loop {
                        tokio::select! {
                            cmd = rx.recv() => {
                                let Some(cmd) = cmd else { return; };
                                match cmd {
                                    NdiCommand::RefreshTopology => {
                                        let _ = stream.write_all(&ndi::encode_message(&ndi::query_sources())).await;
                                        let _ = stream.write_all(&ndi::encode_message(&ndi::query_receivers())).await;
                                    }
                                    NdiCommand::ControlReceiver { receiver_id, source_name } => {
                                        let msg = ndi::control_receiver(&receiver_id, &source_name);
                                        let _ = stream.write_all(&ndi::encode_message(&msg)).await;
                                        sink.log(format!("[ndi-6] Switched receiver '{}' -> '{}'", receiver_id, source_name));
                                    }
                                    NdiCommand::RecallPtzPreset { source_id, preset_index, speed } => {
                                        let xml = ndi::ptz_recall_preset(preset_index, speed);
                                        let msg = ndi::control_source(&source_id, "metadata", &xml);
                                        let _ = stream.write_all(&ndi::encode_message(&msg)).await;
                                        sink.log(format!("[ndi-ptz] Recalled preset {} on '{}'", preset_index, source_id));
                                    }
                                    NdiCommand::PanTiltSpeed { source_id, pan, tilt } => {
                                        let xml = ndi::ptz_pan_tilt_speed(pan, tilt);
                                        let msg = ndi::control_source(&source_id, "metadata", &xml);
                                        let _ = stream.write_all(&ndi::encode_message(&msg)).await;
                                    }
                                }
                            }
                            read_res = stream.read(&mut read_buf) => {
                                match read_res {
                                    Ok(0) | Err(_) => {
                                        health.degraded("NDI Discovery stream closed — reconnecting");
                                        break;
                                    }
                                    Ok(n) => {
                                        if let Ok(parsed) = ndi::decode_message(&read_buf[..n]) {
                                            match parsed {
                                                NdiMessage::Sources(srcs) => {
                                                    let names: Vec<String> = srcs.into_iter().map(|s| s.name).collect();
                                                    with_state(&state, |snap| {
                                                        snap.ndi_sources = names;
                                                    });
                                                }
                                                NdiMessage::Receivers(rxs) => {
                                                    with_state(&state, |snap| {
                                                        snap.ndi_receivers = rxs.into_iter().map(|r| {
                                                            let input = r.input_name.unwrap_or_default();
                                                            StateNdiReceiver {
                                                                id: r.id,
                                                                receiver_name: r.name,
                                                                ip: r.address.unwrap_or_default(),
                                                                subscribed_source: input.clone(),
                                                                expected_source: input,
                                                                status: "CONNECTED".into(),
                                                                tally_program: false,
                                                            }
                                                        }).collect();
                                                    });
                                                }
                                                _ => {}
                                            }
                                        }
                                    }
                                }
                            }
                            _ = refresh_tick.tick() => {
                                if stream.write_all(&ndi::encode_message(&ndi::query_sources())).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                }
                _ => {
                    health.degraded(format!("NDI Discovery {} unreachable (waiting)", config.endpoint()));
                }
            }

            tokio::select! {
                _ = tokio::time::sleep(backoff) => {
                    backoff = (backoff * 2).min(Duration::from_secs(15));
                }
                cmd = rx.recv() => {
                    if cmd.is_none() { return; }
                }
            }
        }
    });
}
