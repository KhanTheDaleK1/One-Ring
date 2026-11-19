//! Live IP_VIDEO 6 Discovery Service (`TCP :5959`) & PTZ Control Adapter.

use crate::protocols::ip_video::{self, IpVideoMessage};
use crate::runtime::events::{state_patch, EventSink};
use serde_json::json;
use crate::runtime::health::HealthReporter;
use crate::state::{with_state, IpVideoReceiver as StateNdiReceiver, SharedState};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

pub const IP_VIDEO_DISCOVERY_PORT: u16 = 5959;

#[derive(Debug, Clone)]
pub struct IpVideoConfig {
    pub discovery_host: String,
    pub discovery_port: u16,
    pub listener_id: String,
}

impl Default for IpVideoConfig {
    fn default() -> Self {
        Self {
            discovery_host: "127.0.0.1".into(),
            discovery_port: IP_VIDEO_DISCOVERY_PORT,
            listener_id: "one-ring-controller".into(),
        }
    }
}

impl IpVideoConfig {
    pub fn endpoint(&self) -> String {
        format!("{}:{}", self.discovery_host, self.discovery_port)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum IpVideoCommand {
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
    config: IpVideoConfig,
    state: SharedState,
    sink: Arc<dyn EventSink>,
    mut rx: mpsc::UnboundedReceiver<IpVideoCommand>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let health = HealthReporter::new(
            "ip_video",
            "ip_video",
            "IP_VIDEO 6",
            "Discovery TCP :5959",
            state.clone(),
            sink.clone(),
        );
        let mut backoff = Duration::from_secs(1);

        loop {
            health.connecting(format!("Connecting to IP_VIDEO Discovery {}...", config.endpoint()));
            match tokio::time::timeout(Duration::from_secs(3), TcpStream::connect(config.endpoint())).await {
                Ok(Ok(mut stream)) => {
                    backoff = Duration::from_secs(1);
                    health.ready(format!("Connected to IP_VIDEO Discovery {}", config.endpoint()), 2);

                    let hs = ip_video::encode_message(&ip_video::handshake_listener(&config.listener_id));
                    if stream.write_all(&hs).await.is_err() {
                        continue;
                    }
                    let _ = stream.write_all(&ip_video::encode_message(&ip_video::query_sources())).await;
                    let _ = stream.write_all(&ip_video::encode_message(&ip_video::query_receivers())).await;

                    let mut read_buf = vec![0u8; 8192];
                    let mut stream_acc: Vec<u8> = Vec::with_capacity(8192);
                    let mut refresh_tick = tokio::time::interval(Duration::from_secs(12));

                    loop {
                        tokio::select! {
                            cmd = rx.recv() => {
                                let Some(cmd) = cmd else { return; };
                                match cmd {
                                    IpVideoCommand::RefreshTopology => {
                                        let _ = stream.write_all(&ip_video::encode_message(&ip_video::query_sources())).await;
                                        let _ = stream.write_all(&ip_video::encode_message(&ip_video::query_receivers())).await;
                                    }
                                    IpVideoCommand::ControlReceiver { receiver_id, source_name } => {
                                        let msg = ip_video::control_receiver(&receiver_id, &source_name);
                                        let _ = stream.write_all(&ip_video::encode_message(&msg)).await;
                                        sink.log(format!("[ip_video-6] Switched receiver '{}' -> '{}'", receiver_id, source_name));
                                    }
                                    IpVideoCommand::RecallPtzPreset { source_id, preset_index, speed } => {
                                        let xml = ip_video::ptz_recall_preset(preset_index, speed);
                                        let msg = ip_video::control_source(&source_id, "metadata", &xml);
                                        let _ = stream.write_all(&ip_video::encode_message(&msg)).await;
                                        sink.log(format!("[ip_video-ptz] Recalled preset {} on '{}'", preset_index, source_id));
                                    }
                                    IpVideoCommand::PanTiltSpeed { source_id, pan, tilt } => {
                                        let xml = ip_video::ptz_pan_tilt_speed(pan, tilt);
                                        let msg = ip_video::control_source(&source_id, "metadata", &xml);
                                        let _ = stream.write_all(&ip_video::encode_message(&msg)).await;
                                    }
                                }
                            }
                            read_res = stream.read(&mut read_buf) => {
                                match read_res {
                                    Ok(0) | Err(_) => {
                                        health.degraded("IP_VIDEO Discovery stream closed — reconnecting");
                                        break;
                                    }
                                    Ok(n) => {
                                        stream_acc.extend_from_slice(&read_buf[..n]);
                                        if stream_acc.len() > 1024 * 1024 {
                                            stream_acc.clear();
                                            continue;
                                        }
                                        while let Some(frame_xml) = take_xml_frame(&mut stream_acc) {
                                            if let Ok(parsed) = ip_video::decode_message(frame_xml.as_bytes()) {
                                                match parsed {
                                                    IpVideoMessage::Sources(srcs) => {
                                                        let names: Vec<String> = srcs.into_iter().map(|s| s.name).collect();
                                                        let ip_video_sources = with_state(&state, |snap| {
                                                            snap.ip_video_sources = names;
                                                            snap.ip_video_sources.clone()
                                                        });
                                                        sink.state(state_patch("ip_video", json!({ "ipVideoSources": ip_video_sources })));
                                                    }
                                                    IpVideoMessage::Receivers(rxs) => {
                                                        let ip_video_receivers = with_state(&state, |snap| {
                                                            let prev_expected: std::collections::HashMap<String, String> = snap
                                                                .ip_video_receivers
                                                                .iter()
                                                                .map(|r| (r.id.clone(), r.expected_source.clone()))
                                                                .collect();
                                                            snap.ip_video_receivers = rxs.into_iter().map(|r| {
                                                                let input = r.input_name.unwrap_or_default();
                                                                let expected = prev_expected
                                                                    .get(&r.id)
                                                                    .filter(|e| !e.is_empty())
                                                                    .cloned()
                                                                    .unwrap_or_else(|| input.clone());
                                                                let status = if expected.is_empty() || input == expected {
                                                                    "CONNECTED".into()
                                                                } else {
                                                                    "DRIFT".into()
                                                                };
                                                                StateNdiReceiver {
                                                                    id: r.id,
                                                                    receiver_name: r.name,
                                                                    ip: r.address.unwrap_or_default(),
                                                                    subscribed_source: input,
                                                                    expected_source: expected,
                                                                    status,
                                                                    tally_program: false,
                                                                }
                                                            }).collect();
                                                            snap.ip_video_receivers.clone()
                                                        });
                                                        sink.state(state_patch("ip_video", json!({ "ipVideoReceivers": ip_video_receivers })));
                                                    }
                                                    _ => {}
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            _ = refresh_tick.tick() => {
                                if stream.write_all(&ip_video::encode_message(&ip_video::query_sources())).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                }
                _ => {
                    health.degraded(format!("IP_VIDEO Discovery {} unreachable (waiting)", config.endpoint()));
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
    })
}


/// Extract one complete root XML element (or NUL-terminated XML document) from a TCP stream buffer.
fn take_xml_frame(buf: &mut Vec<u8>) -> Option<String> {
    if let Some(nul) = buf.iter().position(|&b| b == 0) {
        let frame: Vec<u8> = buf.drain(..=nul).collect();
        let text = String::from_utf8_lossy(&frame[..nul]).trim().to_string();
        return if text.is_empty() { take_xml_frame(buf) } else { Some(text) };
    }
    let text = std::str::from_utf8(buf).ok()?;
    let start = text.find('<')?;
    let after = &text[start + 1..];
    let tag_end = after.find(|c: char| c.is_whitespace() || c == '>' || c == '/')?;
    let tag_name = &after[..tag_end];
    if tag_name.is_empty() || tag_name.starts_with('/') {
        buf.drain(..=start);
        return None;
    }
    let open_close = text[start..].find('>')?;
    let open_tag = &text[start..start + open_close + 1];
    let frame_end = if open_tag.trim_end().ends_with("/>") {
        start + open_close + 1
    } else {
        let close_pat = format!("</{tag_name}>");
        let rel_end = text[start + open_close + 1..].find(&close_pat)?;
        start + open_close + 1 + rel_end + close_pat.len()
    };
    let extracted = text[start..frame_end].to_string();
    buf.drain(..frame_end);
    Some(extracted)
}
