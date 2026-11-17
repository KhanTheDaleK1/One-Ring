use serde::{Deserialize, Serialize};
use std::net::{SocketAddr, UdpSocket};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const DISCOVERY_PORT: u16 = 47888;
pub const BROADCAST_ADDR: &str = "255.255.255.255:47888";

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

    // 2. Spawner for beacon transmitter
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
                ws_sync_port: 47800,
                version: version.clone(),
            };
            if let Ok(bytes) = serde_json::to_vec(&msg) {
                let _ = socket.send_to(&bytes, BROADCAST_ADDR);
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}
