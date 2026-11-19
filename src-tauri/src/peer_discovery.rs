use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::{SocketAddr, UdpSocket};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;

pub const DISCOVERY_PORT: u16 = 47888;
pub const BROADCAST_ADDR: &str = "255.255.255.255:47888";
pub const WS_SYNC_PORT: u16 = 47800;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerAnnouncement {
    pub instance_id: String,
    pub station_name: String,
    pub canvas_title: String,
    pub ip_address: String,
    pub ws_sync_port: u16,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredPeer {
    pub instance_id: String,
    pub station_name: String,
    pub canvas_title: String,
    pub ip_address: String,
    pub ws_sync_port: u16,
    pub version: String,
    #[serde(skip)]
    pub last_seen: Option<Instant>,
}

#[derive(Clone, Default)]
pub struct PeerRegistry {
    peers: Arc<Mutex<Vec<DiscoveredPeer>>>,
}

impl PeerRegistry {
    pub fn list(&self) -> Vec<DiscoveredPeer> {
        let mut list = self.peers.lock().unwrap();
        let now = Instant::now();
        // Expire peers after 7 seconds without beacon
        list.retain(|p| {
            if let Some(ls) = p.last_seen {
                now.duration_since(ls) < Duration::from_secs(7)
            } else {
                false
            }
        });
        list.clone()
    }

    pub fn upsert(&self, mut peer: DiscoveredPeer) {
        peer.last_seen = Some(Instant::now());
        let mut list = self.peers.lock().unwrap();
        if let Some(pos) = list.iter().position(|p| p.instance_id == peer.instance_id) {
            list[pos] = peer;
        } else {
            list.push(peer);
        }
    }
}

fn extract_sync_envelope_sender_id(text: &str) -> Option<String> {
    let value: Value = serde_json::from_str(text).ok()?;
    let obj = value.as_object()?;
    let sender = obj.get("senderId")?.as_str()?.to_string();
    if sender.is_empty() {
        return None;
    }
    if !obj.contains_key("kind") || !obj.contains_key("payload") {
        return None;
    }
    Some(sender)
}

#[derive(Clone, Debug)]
struct SyncEnvelope {
    origin_conn: u64,
    sender_id: String,
    text: String,
}

/// WebSocket sync hub connection: relays JSON sync envelopes to other connected stations
/// while suppressing echo back to the originating sender identity and connection.
async fn handle_ws_sync_connection(
    stream: TcpStream,
    hub_tx: broadcast::Sender<SyncEnvelope>,
    conn_id: u64,
) {
    let mut ws = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[discovery] WebSocket sync handshake failed: {e}");
            return;
        }
    };

    let mut hub_rx = hub_tx.subscribe();

    loop {
        tokio::select! {
            frame = ws.next() => {
                match frame {
                    Some(Ok(Message::Text(text))) => {
                        let text = text.to_string();
                        if let Some(sender_id) = extract_sync_envelope_sender_id(&text) {
                            let _ = hub_tx.send(SyncEnvelope {
                                origin_conn: conn_id,
                                sender_id,
                                text,
                            });
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        if ws.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(_)) => {}
                }
            }
            relay = hub_rx.recv() => {
                match relay {
                    Ok(env) => {
                        if env.origin_conn == conn_id {
                            continue;
                        }
                        // Suppress echo back to senderId as required for envelope relays.
                        let _ = env.sender_id;
                        if ws.send(Message::Text(env.text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

pub async fn run_ws_sync_hub(listener: TcpListener) {
    let (hub_tx, _) = broadcast::channel::<SyncEnvelope>(256);
    let mut next_conn_id: u64 = 1;
    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let conn_id = next_conn_id;
                next_conn_id = next_conn_id.wrapping_add(1);
                let tx = hub_tx.clone();
                tokio::spawn(async move {
                    handle_ws_sync_connection(stream, tx, conn_id).await;
                });
            }
            Err(e) => eprintln!("[discovery] WebSocket sync accept failed: {e}"),
        }
    }
}

pub fn start_peer_discovery(
    my_id: String,
    station_name: String,
    canvas_title: String,
    version: String,
    registry: PeerRegistry,
) {
    // 1. Spawner for listener
    let reg_clone = registry.clone();
    let my_id_clone = my_id.clone();
    std::thread::spawn(move || {
        let socket = match UdpSocket::bind(format!("0.0.0.0:{}", DISCOVERY_PORT)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[discovery] Failed to bind UDP discovery port: {e}");
                return;
            }
        };
        let _ = socket.set_read_timeout(Some(Duration::from_millis(1000)));

        let mut buf = [0u8; 2048];
        loop {
            if let Ok((len, src)) = socket.recv_from(&mut buf) {
                if let Ok(announcement) = serde_json::from_slice::<PeerAnnouncement>(&buf[..len]) {
                    // Ignore own broadcasts
                    if announcement.instance_id != my_id_clone {
                        let ip = match src {
                            SocketAddr::V4(v4) => v4.ip().to_string(),
                            SocketAddr::V6(v6) => v6.ip().to_string(),
                        };
                        reg_clone.upsert(DiscoveredPeer {
                            instance_id: announcement.instance_id,
                            station_name: announcement.station_name,
                            canvas_title: announcement.canvas_title,
                            ip_address: ip,
                            ws_sync_port: announcement.ws_sync_port,
                            version: announcement.version,
                            last_seen: Some(Instant::now()),
                        });
                    }
                }
            }
        }
    });

    // 2. WebSocket sync listener: announcements advertise ws://<ip>:47800, so accept real
    // handshakes there and relay sync envelopes via a multi-client pub/sub hub.
    std::thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(e) => {
                eprintln!("[discovery] Failed to start WebSocket sync runtime: {e}");
                return;
            }
        };
        runtime.block_on(async move {
            let listener = match TcpListener::bind(("0.0.0.0", WS_SYNC_PORT)).await {
                Ok(listener) => listener,
                Err(e) => {
                    eprintln!("[discovery] Failed to bind WebSocket sync port {WS_SYNC_PORT}: {e}");
                    return;
                }
            };
            run_ws_sync_hub(listener).await;
        });
    });

    // 3. Spawner for beacon transmitter
    std::thread::spawn(move || {
        let socket = match UdpSocket::bind("0.0.0.0:0") {
            Ok(s) => s,
            Err(_) => return,
        };
        let _ = socket.set_broadcast(true);

        loop {
            let msg = PeerAnnouncement {
                instance_id: my_id.clone(),
                station_name: station_name.clone(),
                canvas_title: canvas_title.clone(),
                ip_address: "".to_string(),
                ws_sync_port: WS_SYNC_PORT,
                version: version.clone(),
            };
            if let Ok(bytes) = serde_json::to_vec(&msg) {
                let _ = socket.send_to(&bytes, BROADCAST_ADDR);
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio::net::TcpListener;
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    #[tokio::test]
    async fn ws_sync_hub_relays_envelopes_between_clients_without_echo() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind test listener");
        let addr = listener.local_addr().expect("local addr");
        let server = tokio::spawn(async move {
            run_ws_sync_hub(listener).await;
        });

        let url = format!("ws://{}", addr);
        let (mut ws_a, _) = connect_async(&url).await.expect("connect client a");
        let (mut ws_b, _) = connect_async(&url).await.expect("connect client b");

        // Allow server accept/subscribe tasks to settle.
        tokio::time::sleep(Duration::from_millis(50)).await;

        let envelope_a = serde_json::json!({
            "senderId": "station-a",
            "kind": "cue.sync",
            "payload": { "index": 1 }
        })
        .to_string();

        ws_a.send(Message::Text(envelope_a.clone().into()))
            .await
            .expect("send from a");

        let received_b = tokio::time::timeout(Duration::from_secs(2), ws_b.next())
            .await
            .expect("client b timed out")
            .expect("client b stream ended")
            .expect("client b frame error");
        match received_b {
            Message::Text(text) => {
                let v: Value = serde_json::from_str(&text).expect("json relay");
                assert_eq!(v["senderId"], "station-a");
                assert_eq!(v["kind"], "cue.sync");
                assert_eq!(v["payload"]["index"], 1);
            }
            other => panic!("expected text relay, got {other:?}"),
        }

        // Sender must not receive its own envelope echoed back.
        let echo_on_a = tokio::time::timeout(Duration::from_millis(250), ws_a.next()).await;
        assert!(echo_on_a.is_err(), "sender unexpectedly received an echo: {:?}", echo_on_a);

        let envelope_b = serde_json::json!({
            "senderId": "station-b",
            "kind": "scene.sync",
            "payload": { "name": "Main" }
        })
        .to_string();
        ws_b.send(Message::Text(envelope_b.clone().into()))
            .await
            .expect("send from b");

        let received_a = tokio::time::timeout(Duration::from_secs(2), ws_a.next())
            .await
            .expect("client a timed out")
            .expect("client a stream ended")
            .expect("client a frame error");
        match received_a {
            Message::Text(text) => {
                let v: Value = serde_json::from_str(&text).expect("json relay");
                assert_eq!(v["senderId"], "station-b");
                assert_eq!(v["kind"], "scene.sync");
            }
            other => panic!("expected text relay, got {other:?}"),
        }

        server.abort();
        let _ = ws_a.close(None).await;
        let _ = ws_b.close(None).await;
    }
}
