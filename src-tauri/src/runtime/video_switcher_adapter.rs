//! Async UDP :9910 manager for live two-way hardware video switcher control.

use crate::protocols::video_switcher::{
    self, apply_payload, build_ack_packet, build_command_packet, parse_packet_header,
    SwitcherState, DEFAULT_SWITCHER_PORT, FLAG_ACK_REPLY, FLAG_ACK_REQUEST, FLAG_NEW_SESSION,
    FLAG_RETRANSMIT, FLAG_RETRANSMIT_REQUEST, HELLO_PACKET,
};
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::net::UdpSocket;
use tokio::sync::mpsc;

pub const SWITCHER_EVENT: &str = "switcher://state";

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum SwitcherAction {
    SetProgram { me: Option<u8>, source: u16 },
    SetPreview { me: Option<u8>, source: u16 },
    Cut { me: Option<u8> },
    Auto { me: Option<u8> },
    SetPosition { me: Option<u8>, position: f64 },
    SetKey { me: Option<u8>, keyer: u8, on: bool },
    SetDsk { dsk: u8, on: bool },
    DskAuto { dsk: u8 },
    FadeToBlack { me: Option<u8> },
    SetAux { aux: u8, source: u16 },
    RunMacro { index: u16 },
    StopMacro,
}

struct ActiveSession {
    tx: mpsc::UnboundedSender<SwitcherAction>,
    task: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Clone, Default)]
pub struct VideoSwitcherManager {
    state: Arc<Mutex<SwitcherState>>,
    session: Arc<Mutex<Option<ActiveSession>>>,
}

impl VideoSwitcherManager {
    pub fn snapshot(&self) -> SwitcherState {
        self.state.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn disconnect(&self) -> SwitcherState {
        if let Ok(mut guard) = self.session.lock() {
            if let Some(active) = guard.take() {
                active.task.abort();
            }
        }
        let snap = SwitcherState::default();
        if let Ok(mut st) = self.state.lock() {
            *st = snap.clone();
        }
        snap
    }

    pub fn connect(&self, app: AppHandle, host: String, port: Option<u16>) -> Result<SwitcherState, String> {
        let host = host.trim().to_string();
        if host.is_empty() || host.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err("Enter a valid switcher IP address or hostname".into());
        }
        let port = port.unwrap_or(DEFAULT_SWITCHER_PORT);
        if port == 0 {
            return Err("Port must be between 1 and 65535".into());
        }

        self.disconnect();

        let (tx, mut rx) = mpsc::unbounded_channel::<SwitcherAction>();
        let initial = SwitcherState {
            host: host.clone(),
            port,
            link: "connecting".into(),
            detail: format!("Connecting to {host}:{port}..."),
            ..SwitcherState::default()
        };
        if let Ok(mut st) = self.state.lock() {
            *st = initial.clone();
        }
        let _ = app.emit(SWITCHER_EVENT, &initial);

        let shared = self.state.clone();
        let target_addr = format!("{host}:{port}");

        let task = tauri::async_runtime::spawn(async move {
            let Ok(sock) = UdpSocket::bind("0.0.0.0:0").await else {
                update_link(&shared, &app, "offline", "Could not open local UDP socket");
                return;
            };
            if let Err(err) = sock.connect(&target_addr).await {
                update_link(&shared, &app, "offline", &format!("Connect failed: {err}"));
                return;
            }

            let mut session_id: u16 = 0x53AB;
            let mut local_id: u16 = 0;
            let mut last_remote_id: Option<u16> = None;
            let mut connected = false;
            let mut ready = false;
            let mut in_flight: Vec<(u16, Vec<u8>, Instant, u8)> = Vec::new();
            let mut last_inbound = Instant::now();
            let mut last_hello = Instant::now();
            let _ = sock.send(&HELLO_PACKET).await;

            let mut buf = [0u8; 4096];
            let mut ticker = tokio::time::interval(Duration::from_millis(25));

            loop {
                tokio::select! {
                    recv = sock.recv(&mut buf) => {
                        let Ok(n) = recv else { continue; };
                        if n < 12 { continue; }
                        last_inbound = Instant::now();
                        let Some(hdr) = parse_packet_header(&buf[..n]) else { continue; };
                        session_id = hdr.session_id;

                        if hdr.flags & FLAG_NEW_SESSION != 0 {
                            connected = true;
                            last_remote_id = None;
                            let ack = build_ack_packet(session_id, hdr.remote_id);
                            let _ = sock.send(&ack).await;
                            update_link(&shared, &app, "connecting", "Handshake accepted, syncing state...");
                            continue;
                        }
                        if hdr.flags & FLAG_ACK_REQUEST != 0 {
                            let ack = build_ack_packet(session_id, hdr.remote_id);
                            let _ = sock.send(&ack).await;
                            let fresh = last_remote_id
                                .map(|prev| ((hdr.remote_id as i32 - prev as i32) + 32768) % 32768)
                                .unwrap_or(1);
                            if fresh > 0 && fresh < 16384 {
                                last_remote_id = Some(hdr.remote_id);
                                if hdr.length > 12 && n >= hdr.length {
                                    let snap = {
                                        let Ok(mut st) = shared.lock() else { continue; };
                                        if apply_payload(&buf[12..hdr.length], &mut st) {
                                            ready = true;
                                        }
                                        if ready { Some(st.clone()) } else { None }
                                    };
                                    if let Some(s) = snap {
                                        let _ = app.emit(SWITCHER_EVENT, &s);
                                    }
                                }
                            }
                        }
                        if hdr.flags & FLAG_ACK_REPLY != 0 {
                            in_flight.retain(|(id, _, _, _)| {
                                let diff = ((hdr.ack_id as i32 - *id as i32) + 32768) % 32768;
                                diff >= 16384
                            });
                        }
                        if hdr.flags & FLAG_RETRANSMIT_REQUEST != 0 {
                            for (_, pkt, _, _) in &in_flight {
                                let _ = sock.send(pkt).await;
                            }
                        }
                    }
                    maybe_cmd = rx.recv() => {
                        let Some(action) = maybe_cmd else { break; };
                        if !connected || !ready {
                            continue;
                        }
                        let (fourcc, data) = encode_action(&action);
                        local_id = (local_id + 1) % 32768;
                        let pkt = build_command_packet(session_id, local_id, fourcc, &data);
                        let _ = sock.send(&pkt).await;
                        in_flight.push((local_id, pkt, Instant::now(), 0));
                    }
                    _ = ticker.tick() => {
                        let now = Instant::now();
                        if now.duration_since(last_inbound) > Duration::from_secs(3) {
                            if now.duration_since(last_hello) > Duration::from_millis(1500) {
                                connected = false;
                                ready = false;
                                in_flight.clear();
                                session_id = 0x53AB;
                                local_id = 0;
                                last_hello = now;
                                update_link(&shared, &app, "offline", &format!("No answer from {host}:{port}"));
                                let _ = sock.send(&HELLO_PACKET).await;
                            }
                            continue;
                        }
                        let mut timed_out = false;
                        for (_, pkt, sent, tries) in &mut in_flight {
                            if now.duration_since(*sent) > Duration::from_millis(60) {
                                if *tries >= 10 {
                                    timed_out = true;
                                    break;
                                }
                                pkt[0] |= FLAG_RETRANSMIT << 3;
                                let _ = sock.send(pkt).await;
                                *sent = now;
                                *tries += 1;
                            }
                        }
                        if timed_out {
                            connected = false;
                            ready = false;
                            in_flight.clear();
                            update_link(&shared, &app, "offline", "Switcher stopped answering");
                            let _ = sock.send(&HELLO_PACKET).await;
                        }
                    }
                }
            }
        });

        if let Ok(mut guard) = self.session.lock() {
            *guard = Some(ActiveSession { tx, task });
        }
        Ok(initial)
    }

    pub fn send_action(&self, action: SwitcherAction) -> Result<(), String> {
        let guard = self.session.lock().map_err(|_| "Switcher lock poisoned".to_string())?;
        let Some(active) = guard.as_ref() else {
            return Err("Hardware switcher is not connected".into());
        };
        active
            .tx
            .send(action)
            .map_err(|_| "Switcher session closed".into())
    }
}

fn update_link(shared: &Arc<Mutex<SwitcherState>>, app: &AppHandle, link: &str, detail: &str) {
    if let Ok(mut st) = shared.lock() {
        if st.link != link || st.detail != detail {
            st.link = link.to_string();
            st.detail = detail.to_string();
            let snap = st.clone();
            drop(st);
            let _ = app.emit(SWITCHER_EVENT, &snap);
        }
    }
}

fn encode_action(action: &SwitcherAction) -> (&'static [u8; 4], Vec<u8>) {
    match *action {
        SwitcherAction::SetProgram { me, source } => video_switcher::cmd_set_program(me.unwrap_or(0), source),
        SwitcherAction::SetPreview { me, source } => video_switcher::cmd_set_preview(me.unwrap_or(0), source),
        SwitcherAction::Cut { me } => video_switcher::cmd_cut(me.unwrap_or(0)),
        SwitcherAction::Auto { me } => video_switcher::cmd_auto(me.unwrap_or(0)),
        SwitcherAction::SetPosition { me, position } => video_switcher::cmd_set_position(me.unwrap_or(0), position),
        SwitcherAction::SetKey { me, keyer, on } => video_switcher::cmd_set_key_on_air(me.unwrap_or(0), keyer, on),
        SwitcherAction::SetDsk { dsk, on } => video_switcher::cmd_set_dsk_on_air(dsk, on),
        SwitcherAction::DskAuto { dsk } => video_switcher::cmd_dsk_auto(dsk),
        SwitcherAction::FadeToBlack { me } => video_switcher::cmd_fade_to_black(me.unwrap_or(0)),
        SwitcherAction::SetAux { aux, source } => video_switcher::cmd_set_aux(aux, source),
        SwitcherAction::RunMacro { index } => video_switcher::cmd_run_macro(index),
        SwitcherAction::StopMacro => video_switcher::cmd_stop_macro(),
    }
}
