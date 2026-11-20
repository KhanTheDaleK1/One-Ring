use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

pub const DISCOVERY_PORT: u16 = 47888;
pub const BROADCAST_ADDR: &str = "255.255.255.255:47888";
pub const WS_SYNC_PORT: u16 = 47800;

/// Optional environment variable holding the shared sync secret. When empty, the hub accepts
/// unauthenticated clients so existing single-station setups keep working.
pub const SYNC_TOKEN_ENV: &str = "ONE_RING_SYNC_TOKEN";

const MAX_WS_CLIENTS: usize = 32;
const MAX_PEERS: usize = 64;
const MAX_STATION_NAME_CHARS: usize = 128;
const MAX_WS_MESSAGE_BYTES: usize = 256 * 1024;
const MAX_WS_FRAME_BYTES: usize = 64 * 1024;
const SYNC_TOKEN_HEADER: &str = "x-onering-token";

const ALLOWED_SYNC_KINDS: &[&str] = &[
    "cue_triggered",
    "slide_changed",
    "stage_alert",
    "ping",
    "pong",
    "auth",
    "sync_state",
];

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
        // Reject malformed announcements before they can reach the UI or the peer cap.
        if peer.ws_sync_port == 0
            || peer.station_name.trim().is_empty()
            || peer.station_name.chars().count() > MAX_STATION_NAME_CHARS
        {
            return;
        }
        peer.last_seen = Some(Instant::now());
        let mut list = self.peers.lock().unwrap();
        if let Some(pos) = list.iter().position(|p| p.instance_id == peer.instance_id) {
            list[pos] = peer;
            return;
        }
        if list.len() >= MAX_PEERS {
            let now = Instant::now();
            if let Some((oldest, _)) = list
                .iter()
                .enumerate()
                .min_by_key(|(_, p)| p.last_seen.unwrap_or(now))
            {
                list.remove(oldest);
            }
        }
        list.push(peer);
    }
}

fn is_allowed_sync_kind(kind: &str) -> bool {
    ALLOWED_SYNC_KINDS.contains(&kind)
}

/// Compare secrets without short-circuiting on the first differing byte.
fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let max_len = left.len().max(right.len());
    let mut diff = 0u8;
    for index in 0..max_len {
        let a = left.get(index).copied().unwrap_or(0);
        let b = right.get(index).copied().unwrap_or(0);
        diff |= a ^ b;
    }
    diff == 0 && left.len() == right.len()
}

struct ParsedSyncEnvelope {
    sender_id: Option<String>,
    kind: String,
    has_payload: bool,
    auth_token: Option<String>,
}

/// Parse and validate a sync envelope. Unknown kinds never reach the relay.
fn parse_sync_envelope(text: &str) -> Option<ParsedSyncEnvelope> {
    let value: Value = serde_json::from_str(text).ok()?;
    let obj = value.as_object()?;
    let kind = obj.get("kind")?.as_str()?.to_string();
    if !is_allowed_sync_kind(&kind) {
        return None;
    }
    let sender_id = obj
        .get("senderId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_string);
    let auth_token = obj
        .get("token")
        .and_then(Value::as_str)
        .or_else(|| {
            obj.get("payload")
                .and_then(|payload| payload.get("token"))
                .and_then(Value::as_str)
        })
        .map(str::to_string);
    Some(ParsedSyncEnvelope {
        sender_id,
        kind,
        has_payload: obj.contains_key("payload"),
        auth_token,
    })
}

#[derive(Clone, Debug)]
struct SyncEnvelope {
    origin_conn: u64,
    sender_id: String,
    text: String,
}

/// Decrements the live-client counter even when a handshake or relay task exits early.
struct SyncClientGuard(Arc<AtomicUsize>);

impl Drop for SyncClientGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// WebSocket sync hub connection: relays JSON sync envelopes to other connected stations
/// while suppressing echo back to the originating sender identity and connection.
async fn handle_ws_sync_connection(
    stream: TcpStream,
    hub_tx: broadcast::Sender<SyncEnvelope>,
    conn_id: u64,
    sync_token: String,
    authenticated: Arc<AtomicBool>,
) {
    let auth_required = !sync_token.is_empty();
    let callback = {
        let authenticated = authenticated.clone();
        let expected = sync_token.clone();
        move |request: &Request, response: Response| -> Result<Response, ErrorResponse> {
            if !expected.is_empty() {
                let provided = request
                    .headers()
                    .get(SYNC_TOKEN_HEADER)
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("");
                if constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
                    authenticated.store(true, Ordering::SeqCst);
                }
            }
            Ok(response)
        }
    };
    let config = WebSocketConfig {
        max_message_size: Some(MAX_WS_MESSAGE_BYTES),
        max_frame_size: Some(MAX_WS_FRAME_BYTES),
        ..Default::default()
    };

    let mut ws = match tokio_tungstenite::accept_hdr_async_with_config(stream, callback, Some(config)).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[discovery] WebSocket sync handshake failed: {e}");
            return;
        }
    };

    let mut hub_rx = hub_tx.subscribe();
    let mut client_sender_id: Option<String> = None;

    loop {
        tokio::select! {
            frame = ws.next() => {
                match frame {
                    Some(Ok(Message::Text(text))) => {
                        let text = text.to_string();
                        let Some(envelope) = parse_sync_envelope(&text) else {
                            eprintln!("[discovery] rejected sync frame with an unknown or invalid kind");
                            continue;
                        };
                        if envelope.kind == "auth" {
                            // Auth frames carry credentials: consume them locally, never relay them.
                            let supplied = envelope.auth_token.as_deref().unwrap_or("");
                            if constant_time_eq(supplied.as_bytes(), sync_token.as_bytes()) {
                                authenticated.store(true, Ordering::SeqCst);
                            } else {
                                eprintln!("[discovery] rejected sync auth frame");
                            }
                            continue;
                        }
                        if auth_required && !authenticated.load(Ordering::SeqCst) {
                            eprintln!("[discovery] dropped unauthenticated sync frame");
                            continue;
                        }
                        let (Some(sender_id), true) = (envelope.sender_id, envelope.has_payload) else {
                            continue;
                        };
                        if client_sender_id.is_none() {
                            client_sender_id = Some(sender_id.clone());
                        }
                        let _ = hub_tx.send(SyncEnvelope {
                            origin_conn: conn_id,
                            sender_id,
                            text,
                        });
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
                        // Suppress echo back to the sender identity this connection claimed.
                        if client_sender_id.as_deref() == Some(env.sender_id.as_str()) {
                            continue;
                        }
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

/// Backward-compatible entry point: the hub runs without a shared secret.
pub async fn run_ws_sync_hub(listener: TcpListener) {
    run_ws_sync_hub_with_token(listener, String::new()).await;
}

/// Run the sync hub with an optional shared secret. At most [`MAX_WS_CLIENTS`] clients are
/// admitted at once, and frame/message sizes are bounded by the WebSocket configuration.
pub async fn run_ws_sync_hub_with_token(listener: TcpListener, sync_token: String) {
    let (hub_tx, _) = broadcast::channel::<SyncEnvelope>(256);
    let active_clients = Arc::new(AtomicUsize::new(0));
    let mut next_conn_id: u64 = 1;
    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let previous = active_clients.fetch_add(1, Ordering::SeqCst);
                if previous >= MAX_WS_CLIENTS {
                    active_clients.fetch_sub(1, Ordering::SeqCst);
                    eprintln!("[discovery] WebSocket sync hub client limit reached");
                    continue;
                }
                let guard = SyncClientGuard(active_clients.clone());
                let conn_id = next_conn_id;
                next_conn_id = next_conn_id.wrapping_add(1);
                let tx = hub_tx.clone();
                let token = sync_token.clone();
                let authenticated = Arc::new(AtomicBool::new(token.is_empty()));
                tokio::spawn(async move {
                    let _guard = guard;
                    handle_ws_sync_connection(stream, tx, conn_id, token, authenticated).await;
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
    let sync_token = std::env::var(SYNC_TOKEN_ENV).unwrap_or_default();
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
            run_ws_sync_hub_with_token(listener, sync_token).await;
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
    use serde_json::json;
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    async fn start_test_hub(token: &str) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test listener");
        let addr = listener.local_addr().expect("local addr");
        let token = token.to_string();
        let server = tokio::spawn(async move {
            run_ws_sync_hub_with_token(listener, token).await;
        });
        // Allow the accept task to start before clients connect.
        tokio::time::sleep(Duration::from_millis(20)).await;
        (format!("ws://{addr}"), server)
    }

    async fn next_text(
        socket: &mut tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    ) -> Value {
        let frame = tokio::time::timeout(Duration::from_secs(2), socket.next())
            .await
            .expect("relay timed out")
            .expect("stream ended")
            .expect("frame error");
        match frame {
            Message::Text(text) => serde_json::from_str(&text).expect("json relay"),
            other => panic!("expected text relay, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn ws_sync_hub_relays_envelopes_between_clients_without_echo() {
        let (url, server) = start_test_hub("").await;
        let (mut ws_a, _) = connect_async(&url).await.expect("connect client a");
        let (mut ws_b, _) = connect_async(&url).await.expect("connect client b");
        tokio::time::sleep(Duration::from_millis(50)).await;

        let envelope_a = json!({
            "senderId": "station-a",
            "kind": "cue_triggered",
            "payload": { "index": 1 }
        })
        .to_string();
        ws_a.send(Message::Text(envelope_a.into()))
            .await
            .expect("send from a");

        let received_b = next_text(&mut ws_b).await;
        assert_eq!(received_b["senderId"], "station-a");
        assert_eq!(received_b["kind"], "cue_triggered");
        assert_eq!(received_b["payload"]["index"], 1);

        // Sender must not receive its own envelope echoed back.
        let echo_on_a = tokio::time::timeout(Duration::from_millis(250), ws_a.next()).await;
        assert!(echo_on_a.is_err(), "sender unexpectedly received an echo: {echo_on_a:?}");

        let envelope_b = json!({
            "senderId": "station-b",
            "kind": "slide_changed",
            "payload": { "name": "Main" }
        })
        .to_string();
        ws_b.send(Message::Text(envelope_b.into()))
            .await
            .expect("send from b");

        let received_a = next_text(&mut ws_a).await;
        assert_eq!(received_a["senderId"], "station-b");
        assert_eq!(received_a["kind"], "slide_changed");

        server.abort();
        let _ = ws_a.close(None).await;
        let _ = ws_b.close(None).await;
    }

    #[tokio::test]
    async fn ws_sync_hub_rejects_unknown_kinds() {
        let (url, server) = start_test_hub("").await;
        let (mut ws_a, _) = connect_async(&url).await.expect("connect client a");
        let (mut ws_b, _) = connect_async(&url).await.expect("connect client b");
        tokio::time::sleep(Duration::from_millis(50)).await;

        let invalid = json!({
            "senderId": "station-a",
            "kind": "unknown_kind",
            "payload": {}
        })
        .to_string();
        ws_a.send(Message::Text(invalid.into()))
            .await
            .expect("send invalid kind");
        assert!(
            tokio::time::timeout(Duration::from_millis(250), ws_b.next())
                .await
                .is_err(),
            "unknown kind was relayed"
        );

        let valid = json!({
            "senderId": "station-a",
            "kind": "stage_alert",
            "payload": { "level": "notice" }
        })
        .to_string();
        ws_a.send(Message::Text(valid.into()))
            .await
            .expect("send allowed kind");
        let received = next_text(&mut ws_b).await;
        assert_eq!(received["kind"], "stage_alert");
        assert_eq!(received["payload"]["level"], "notice");

        server.abort();
        let _ = ws_a.close(None).await;
        let _ = ws_b.close(None).await;
    }

    #[tokio::test]
    async fn ws_sync_hub_echo_suppression_tracks_sender_identity() {
        let (url, server) = start_test_hub("").await;
        let (mut ws_a, _) = connect_async(&url).await.expect("connect client a");
        let (mut ws_b, _) = connect_async(&url).await.expect("connect client b");
        let (mut ws_c, _) = connect_async(&url).await.expect("connect client c");
        tokio::time::sleep(Duration::from_millis(50)).await;

        let from_a = json!({
            "senderId": "station-a",
            "kind": "cue_triggered",
            "payload": { "cue": 1 }
        })
        .to_string();
        ws_a.send(Message::Text(from_a.into()))
            .await
            .expect("send from a");
        assert_eq!(next_text(&mut ws_b).await["payload"]["cue"], 1);
        assert_eq!(next_text(&mut ws_c).await["payload"]["cue"], 1);

        // Client b claims a's identity. Client a must suppress it even though it came from
        // a different connection, while a client with no claimed identity still receives it.
        let spoofed = json!({
            "senderId": "station-a",
            "kind": "slide_changed",
            "payload": { "slide": 2 }
        })
        .to_string();
        ws_b.send(Message::Text(spoofed.into()))
            .await
            .expect("send from b");
        assert_eq!(next_text(&mut ws_c).await["payload"]["slide"], 2);
        assert!(
            tokio::time::timeout(Duration::from_millis(300), ws_a.next())
                .await
                .is_err(),
            "echo suppression did not use the claimed sender identity"
        );

        // The hub still relays unrelated sender identities to the suppressed client.
        let from_c = json!({
            "senderId": "station-c",
            "kind": "sync_state",
            "payload": { "ready": true }
        })
        .to_string();
        ws_c.send(Message::Text(from_c.into()))
            .await
            .expect("send from c");
        assert_eq!(next_text(&mut ws_a).await["senderId"], "station-c");

        server.abort();
        let _ = ws_a.close(None).await;
        let _ = ws_b.close(None).await;
        let _ = ws_c.close(None).await;
    }

    #[tokio::test]
    async fn ws_sync_hub_requires_token_when_configured() {
        let (url, server) = start_test_hub("shared-secret").await;

        let (mut unauthenticated, _) = connect_async(&url).await.expect("connect plain client");
        let mut request = url.clone().into_client_request().expect("client request");
        request.headers_mut().insert(
            "X-OneRing-Token",
            "shared-secret".parse().expect("header value"),
        );
        let (mut header_client, _) = connect_async(request).await.expect("connect header client");
        tokio::time::sleep(Duration::from_millis(50)).await;

        let envelope = json!({
            "senderId": "header-station",
            "kind": "cue_triggered",
            "payload": {}
        })
        .to_string();
        header_client
            .send(Message::Text(envelope.into()))
            .await
            .expect("send authenticated envelope");
        assert_eq!(next_text(&mut unauthenticated).await["senderId"], "header-station");

        let denied = json!({
            "senderId": "plain-station",
            "kind": "slide_changed",
            "payload": { "n": 1 }
        })
        .to_string();
        unauthenticated
            .send(Message::Text(denied.clone()))
            .await
            .expect("send unauthenticated envelope");
        assert!(
            tokio::time::timeout(Duration::from_millis(250), header_client.next())
                .await
                .is_err(),
            "unauthenticated frame was relayed"
        );

        let auth = json!({ "kind": "auth", "token": "shared-secret" }).to_string();
        unauthenticated
            .send(Message::Text(auth.into()))
            .await
            .expect("send auth frame");
        unauthenticated
            .send(Message::Text(denied.into()))
            .await
            .expect("send envelope after auth");
        assert_eq!(next_text(&mut header_client).await["senderId"], "plain-station");

        server.abort();
        let _ = unauthenticated.close(None).await;
        let _ = header_client.close(None).await;
    }

    fn sample_peer(id: &str) -> DiscoveredPeer {
        DiscoveredPeer {
            instance_id: id.to_string(),
            station_name: "Station".to_string(),
            canvas_title: "Main".to_string(),
            ip_address: "192.0.2.10".to_string(),
            ws_sync_port: WS_SYNC_PORT,
            version: "1".to_string(),
            last_seen: None,
        }
    }

    #[test]
    fn peer_registry_caps_at_sixty_four_and_evicts_oldest() {
        let registry = PeerRegistry::default();
        for index in 0..64u32 {
            registry.upsert(sample_peer(&format!("peer-{index}")));
        }
        assert_eq!(registry.list().len(), MAX_PEERS);

        // Upsert stamps last_seen, so the earliest inserted peer is the oldest one.
        registry.upsert(sample_peer("peer-64"));
        let listed = registry.list();
        assert_eq!(listed.len(), MAX_PEERS);
        assert!(!listed.iter().any(|p| p.instance_id == "peer-0"));
        assert!(listed.iter().any(|p| p.instance_id == "peer-63"));
        assert!(listed.iter().any(|p| p.instance_id == "peer-64"));
    }

    #[test]
    fn peer_registry_rejects_invalid_announcements() {
        let registry = PeerRegistry::default();
        let mut no_port = sample_peer("no-port");
        no_port.ws_sync_port = 0;
        registry.upsert(no_port);

        let mut no_name = sample_peer("no-name");
        no_name.station_name.clear();
        registry.upsert(no_name);

        let mut long_name = sample_peer("long-name");
        long_name.station_name = "x".repeat(MAX_STATION_NAME_CHARS + 1);
        registry.upsert(long_name);

        assert!(registry.list().is_empty());
        assert!(is_allowed_sync_kind("sync_state"));
        assert!(!is_allowed_sync_kind("cue.sync"));
        assert!(constant_time_eq(b"secret", b"secret"));
        assert!(!constant_time_eq(b"secret", b"secrex"));
    }
}
