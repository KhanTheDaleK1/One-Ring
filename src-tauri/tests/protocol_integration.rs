//! Loopback integration tests for the clean-room protocol codecs.
//!
//! Every test uses real local sockets (or an in-process WebSocket peer) so the
//! wire bytes are exercised end to end, not just the pure encode/decode helpers.
//! All documented addresses are from the RFC 5737 documentation range.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::thread;
use std::time::Duration;

use one_ring_lib::protocols::{
    aoip, broadcast_ws, console_osc, ip_video, ptz_ip, slide_http, slide_tcp,
};
use one_ring_lib::runtime::broadcast_worker_ipc::{
    build_ffmpeg_filtergraph, AudioSourceSpec, RecordContainer, RecordOutputSpec, StreamOutputSpec,
    StreamProtocol, StudioCompositorPlan, VideoLayerSpec,
};

const TEST_TIMEOUT: Duration = Duration::from_secs(3);

fn dns_name(labels: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    for label in labels {
        out.push(label.len().min(63) as u8);
        out.extend_from_slice(&label[..label.len().min(63)]);
    }
    out.push(0);
    out
}

fn dns_name_from_str(name: &str) -> Vec<u8> {
    let labels: Vec<&[u8]> = name
        .trim_end_matches('.')
        .split('.')
        .map(str::as_bytes)
        .collect();
    dns_name(&labels)
}

/// Prepend one label to an already-encoded, zero-terminated DNS name.
fn prefixed_name(prefix: &[u8], suffix: &[u8]) -> Vec<u8> {
    let mut out = vec![prefix.len() as u8];
    out.extend_from_slice(prefix);
    out.extend_from_slice(suffix);
    out
}

fn push_rr(out: &mut Vec<u8>, name: &[u8], rtype: u16, rclass: u16, rdata: &[u8]) {
    out.extend_from_slice(name);
    out.extend_from_slice(&rtype.to_be_bytes());
    out.extend_from_slice(&rclass.to_be_bytes());
    out.extend_from_slice(&60u32.to_be_bytes());
    out.extend_from_slice(&(rdata.len() as u16).to_be_bytes());
    out.extend_from_slice(rdata);
}

fn dns_header(answers: u16) -> Vec<u8> {
    let mut out = Vec::with_capacity(12);
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&0x8400u16.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&answers.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes());
    out
}

fn udp_pair() -> (UdpSocket, UdpSocket) {
    let receiver = UdpSocket::bind("127.0.0.1:0").expect("bind loopback receiver");
    receiver
        .set_read_timeout(Some(TEST_TIMEOUT))
        .expect("set read timeout");
    let sender = UdpSocket::bind("127.0.0.1:0").expect("bind loopback sender");
    (receiver, sender)
}

// -------------------------------------------------------------------------------------------------
// Console OSC over UDP
// -------------------------------------------------------------------------------------------------

#[test]
fn console_osc_udp_handshake_fader_and_recorder_round_trip() {
    use console_osc::{OscArg, OscMessage, TAPE_STATE_ADDRESS, USB_RECORDER_STATE_LABELS};

    let (receiver, sender) = udp_pair();
    let target = receiver.local_addr().expect("receiver address");

    let info = OscMessage::xinfo();
    let remote = OscMessage::xremote();
    let fader = OscMessage::new("/ch/01/mix/fader", vec![OscArg::Float(0.75)]);
    let recorder = OscMessage::new(TAPE_STATE_ADDRESS, vec![OscArg::Int(2)]);

    for message in [&info, &remote, &fader, &recorder] {
        sender
            .send_to(&message.encode(), target)
            .expect("send OSC datagram");
    }

    let expected: Vec<OscMessage> = vec![info, remote, fader, recorder];
    let mut buffer = [0u8; 2048];
    for expected_message in expected {
        let (len, _) = receiver.recv_from(&mut buffer).expect("receive OSC datagram");
        let decoded = OscMessage::decode(&buffer[..len]).expect("decode OSC");
        assert_eq!(decoded, expected_message);
    }

    let unity_db = console_osc::fader_to_db(console_osc::FADER_UNITY).expect("fader to dB");
    assert!(unity_db.abs() < 0.01);
    assert_eq!(USB_RECORDER_STATE_LABELS[2], "Play");
}

// -------------------------------------------------------------------------------------------------
// AoIP discovery and routing over UDP
// -------------------------------------------------------------------------------------------------

#[test]
fn aoip_mdns_discovery_and_arc_subscribe_status_round_trip() {
    // One mock responder datagram carrying PTR, SRV, A and TXT records.
    let instance = prefixed_name(b"Mock-Rack", aoip::AOIP_CONTROL_SERVICE_LABELS);
    let host = dns_name(&[b"aoip-node", b"local"]);
    let mut response = dns_header(4);
    push_rr(
        &mut response,
        aoip::AOIP_CONTROL_SERVICE_LABELS,
        12,
        1,
        &instance,
    );
    let mut srv_rdata = Vec::new();
    srv_rdata.extend_from_slice(&0u16.to_be_bytes());
    srv_rdata.extend_from_slice(&0u16.to_be_bytes());
    srv_rdata.extend_from_slice(&aoip::CONMON_PORT_CONTROL.to_be_bytes());
    srv_rdata.extend_from_slice(&host);
    push_rr(&mut response, &instance, 33, 1, &srv_rdata);
    push_rr(&mut response, &host, 1, 1, &[192, 0, 2, 20]);
    let txt = b"\x0bchannels=32";
    push_rr(&mut response, &instance, 16, 1, txt);

    let (receiver, sender) = udp_pair();
    let target = receiver.local_addr().expect("receiver address");
    sender.send_to(&response, target).expect("send mDNS answer");

    let mut buffer = [0u8; 4096];
    let (len, _) = receiver.recv_from(&mut buffer).expect("receive mDNS answer");
    let devices =
        aoip::parse_mdns_response(&buffer[..len]).expect("parse AoIP mDNS response");
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].name, "Mock-Rack");
    assert_eq!(devices[0].port, aoip::CONMON_PORT_CONTROL);
    assert_eq!(devices[0].ip, Some("192.0.2.20".parse().unwrap()));
    assert_eq!(devices[0].channels, 32);

    // Subscribe to a receive crosspoint and read the status reply from the mock device.
    let subscription = aoip::ArcSubscription {
        dest_device: String::new(),
        dest_rx_channel: 7,
        source_device: "stage-node".to_string(),
        source_channel: "01".to_string(),
    };
    sender
        .send_to(&subscription.encode(), target)
        .expect("send ARC subscribe");
    let (len, _) = receiver.recv_from(&mut buffer).expect("receive ARC subscribe");
    let parsed = aoip::ArcSubscription::parse(&buffer[..len]).expect("parse ARC subscribe");
    assert_eq!(parsed.dest_rx_channel, 7);
    assert_eq!(parsed.source_device, "stage-node");
    assert_eq!(parsed.source_channel, "01");

    let status = aoip::AoipStatusReply::new(7, aoip::AoipRxStatus::Unicast);
    sender
        .send_to(&status.encode(), target)
        .expect("send ARC status");
    let (len, _) = receiver.recv_from(&mut buffer).expect("receive ARC status");
    let parsed_status =
        aoip::AoipStatusReply::parse(&buffer[..len]).expect("parse ARC status");
    assert_eq!(parsed_status, status);
    assert!(parsed_status.status.is_active());
    assert!(!parsed_status.status.is_error());
}

// -------------------------------------------------------------------------------------------------
// IP Video discovery XML over loopback TCP :5959
// -------------------------------------------------------------------------------------------------

#[test]
fn ip_video_discovery_and_control_receiver_over_tcp() {
    let listener = TcpListener::bind(("127.0.0.1", ip_video::IP_VIDEO_DISCOVERY_PORT))
        .expect("bind IP Video discovery port");
    let hello_len = ip_video::handshake_compatible().len();
    let query_len = ip_video::query_receivers().len();
    let control = ip_video::control_receiver("recv-1", "Stage Camera");
    let control_len = control.len();
    let control_for_server = control.clone();
    let receiver_reply = "<receivers><receiver><receiver_id>recv-1</receiver_id><name>Loopback Receiver</name></receiver></receivers>".to_string();
    let receiver_reply_len = receiver_reply.len();

    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept discovery client");
        stream
            .set_read_timeout(Some(TEST_TIMEOUT))
            .expect("set server read timeout");

        let mut hello = vec![0u8; hello_len];
        stream.read_exact(&mut hello).expect("read compatible hello");
        assert_eq!(hello, ip_video::encode_message(&ip_video::handshake_compatible()));
        stream
            .write_all(ip_video::encode_message(&ip_video::handshake_advertiser()).as_slice())
            .expect("write advertiser reply");

        let mut query = vec![0u8; query_len];
        stream.read_exact(&mut query).expect("read receiver query");
        assert_eq!(query, ip_video::query_receivers().as_bytes());
        stream
            .write_all(receiver_reply.as_bytes())
            .expect("write receiver list");

        let mut control_bytes = vec![0u8; control_len];
        stream
            .read_exact(&mut control_bytes)
            .expect("read control receiver");
        assert_eq!(control_bytes, control_for_server.as_bytes());
        stream
            .write_all(ip_video::encode_message(&ip_video::handshake_compatible()).as_slice())
            .expect("write control acknowledgement");
    });

    let mut client = TcpStream::connect(("127.0.0.1", ip_video::IP_VIDEO_DISCOVERY_PORT))
        .expect("connect to loopback discovery service");
    client
        .set_read_timeout(Some(TEST_TIMEOUT))
        .expect("set client read timeout");

    client
        .write_all(ip_video::encode_message(&ip_video::handshake_compatible()).as_slice())
        .expect("send compatible hello");
    let mut advertiser = vec![0u8; hello_len];
    client
        .read_exact(&mut advertiser)
        .expect("read advertiser reply");
    assert!(matches!(
        ip_video::decode_message(&advertiser).expect("decode advertiser"),
        ip_video::IpVideoMessage::Advertiser
    ));

    client
        .write_all(ip_video::encode_message(&ip_video::query_receivers()).as_slice())
        .expect("send receiver query");
    let mut list = vec![0u8; receiver_reply_len];
    client.read_exact(&mut list).expect("read receiver list");
    match ip_video::decode_message(&list).expect("decode receiver list") {
        ip_video::IpVideoMessage::Receivers(receivers) => {
            assert_eq!(receivers.len(), 1);
            assert_eq!(receivers[0].id, "recv-1");
        }
        other => panic!("unexpected discovery message: {other:?}"),
    }

    client
        .write_all(ip_video::encode_message(&control).as_slice())
        .expect("send control receiver");
    let mut ack = vec![0u8; hello_len];
    client.read_exact(&mut ack).expect("read control acknowledgement");
    assert!(matches!(
        ip_video::decode_message(&ack).expect("decode acknowledgement"),
        ip_video::IpVideoMessage::Compatible
    ));

    server.join().expect("discovery mock thread");
}

// -------------------------------------------------------------------------------------------------
// PTZ_IP commands over loopback UDP :52381
// -------------------------------------------------------------------------------------------------

#[test]
fn ptz_ip_udp_pan_tilt_zoom_preset_and_optics_packets() {
    use ptz_ip::{PtzIpPacket, PtzIpPayloadType};

    let receiver = UdpSocket::bind(("127.0.0.1", 52381))
        .expect("bind standard PTZ control port 52381");
    receiver
        .set_read_timeout(Some(TEST_TIMEOUT))
        .expect("set read timeout");
    let sender = UdpSocket::bind("127.0.0.1:0").expect("bind loopback sender");
    let target = receiver.local_addr().expect("receiver address");

    let packets = vec![
        ptz_ip::PtzIpPacket::pan_tilt_drive(1, 24, 20, 1, 0),
        ptz_ip::PtzIpPacket::zoom_drive(2, 1, 5),
        ptz_ip::PtzIpPacket::recall_preset(3, 2),
        ptz_ip::PtzIpPacket::set_preset(4, 7),
        ptz_ip::PtzIpPacket::home(5),
        ptz_ip::PtzIpPacket::focus_mode(6, true),
        ptz_ip::PtzIpPacket::iris_step(7, -1),
        ptz_ip::PtzIpPacket::white_balance_mode(8, 1),
        ptz_ip::PtzIpPacket::exposure_mode(9, 3),
    ];

    for packet in &packets {
        sender
            .send_to(&packet.to_bytes(), target)
            .expect("send PTZ packet");
    }

    let mut buffer = [0u8; 256];
    for expected in packets {
        let (len, _) = receiver.recv_from(&mut buffer).expect("receive PTZ packet");
        let parsed = PtzIpPacket::parse_bytes(&buffer[..len]).expect("parse PTZ packet");
        assert_eq!(parsed.payload_type, PtzIpPayloadType::Command);
        assert_eq!(parsed.sequence_number, expected.sequence_number);
        assert_eq!(parsed.payload, expected.payload);
    }
}

// -------------------------------------------------------------------------------------------------
// Presentation service discovery and control handshake
// -------------------------------------------------------------------------------------------------

#[test]
fn slide_http_mdns_discovery_and_slide_tcp_json_handshake() {
    // mDNS answer for the HTTP presentation service.
    let service = slide_http::PRESENTATION_SERVICE_TYPE;
    let instance_name = dns_name_from_str(&format!("Sanctuary-Slides.{service}"));
    let host = dns_name(&[b"slides-node", b"local"]);
    let mut response = dns_header(3);
    push_rr(&mut response, &dns_name_from_str(service), 12, 1, &instance_name);
    let mut srv_rdata = Vec::new();
    srv_rdata.extend_from_slice(&0u16.to_be_bytes());
    srv_rdata.extend_from_slice(&0u16.to_be_bytes());
    srv_rdata.extend_from_slice(&8080u16.to_be_bytes());
    srv_rdata.extend_from_slice(&host);
    push_rr(&mut response, &instance_name, 33, 1, &srv_rdata);
    push_rr(&mut response, &host, 1, 1, &[192, 0, 2, 30]);

    let (discovery_rx, discovery_tx) = udp_pair();
    let discovery_target = discovery_rx.local_addr().expect("receiver address");
    discovery_tx
        .send_to(&response, discovery_target)
        .expect("send presentation answer");
    let mut buffer = [0u8; 4096];
    let (len, _) = discovery_rx
        .recv_from(&mut buffer)
        .expect("receive presentation answer");
    let services = slide_http::parse_presentation_response(&buffer[..len])
        .expect("parse presentation answer");
    assert_eq!(services.len(), 1);
    assert_eq!(services[0].instance, "sanctuary-slides");
    assert_eq!(services[0].endpoint(), "192.0.2.30:8080");

    // Newline-delimited JSON control session against a loopback mock server.
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind control listener");
    let addr = listener.local_addr().expect("control listener address");
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().expect("accept control client");
        let mut reader = BufReader::with_capacity(1024, stream.try_clone().expect("clone stream"));
        let mut line = String::new();
        reader.read_line(&mut line).expect("read connect frame");
        let value: serde_json::Value =
            serde_json::from_str(line.trim()).expect("parse connect frame");
        assert_eq!(value["action"], "connect");
        assert_eq!(value["uid"], "loopback-uid");
        assert_eq!(value["device_type"], slide_tcp::DEVICE_TYPE_COMPANION);

        let mut writer = stream;
        writer
            .write_all(b"{\"action\":\"paired\"}\r\n")
            .expect("write paired reply");
        writer.flush().expect("flush paired reply");

        line.clear();
        reader.read_line(&mut line).expect("read heartbeat frame");
        let heartbeat: serde_json::Value =
            serde_json::from_str(line.trim()).expect("parse heartbeat frame");
        assert_eq!(heartbeat["action"], "heartbeat");
        writer
            .write_all(b"{\"action\":\"heartbeat\"}\r\n")
            .expect("write heartbeat reply");
        writer.flush().expect("flush heartbeat reply");
    });

    let client = TcpStream::connect(addr).expect("connect control client");
    client
        .set_read_timeout(Some(TEST_TIMEOUT))
        .expect("set client read timeout");
    let mut writer = client.try_clone().expect("clone client stream");
    writer
        .write_all(slide_tcp::connect_frame("loopback-uid", "Loopback Controller").as_bytes())
        .expect("send connect frame");
    writer.flush().expect("flush connect frame");

    let mut reader = BufReader::new(client);
    let mut line = String::new();
    reader.read_line(&mut line).expect("read paired reply");
    assert!(matches!(
        slide_tcp::parse_server_line(&line).expect("parse paired reply"),
        slide_tcp::ServerMessage::Paired
    ));

    writer
        .write_all(slide_tcp::heartbeat_frame().as_bytes())
        .expect("send heartbeat frame");
    writer.flush().expect("flush heartbeat frame");
    line.clear();
    reader.read_line(&mut line).expect("read heartbeat reply");
    assert!(matches!(
        slide_tcp::parse_server_line(&line).expect("parse heartbeat reply"),
        slide_tcp::ServerMessage::Heartbeat
    ));

    server.join().expect("control mock thread");
}

// -------------------------------------------------------------------------------------------------
// Broadcast WebSocket authentication and compositor plan
// -------------------------------------------------------------------------------------------------

#[tokio::test]
async fn broadcast_ws_authentication_and_compositor_filtergraph() {
    use futures_util::{SinkExt, StreamExt};
    use tokio::net::TcpListener;
    use tokio_tungstenite::{accept_async, tungstenite::Message};

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind websocket listener");
    let addr = listener.local_addr().expect("websocket address");
    let password = "loopback-secret";
    let salt = "loopback-salt";
    let challenge = "loopback-challenge";

    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("accept websocket client");
        let mut ws = accept_async(stream).await.expect("complete websocket upgrade");

        let hello = serde_json::json!({
            "op": broadcast_ws::OpCode::Hello.code(),
            "d": {
                "rpcVersion": broadcast_ws::BROADCAST_RPC_VERSION,
                "authentication": { "challenge": challenge, "salt": salt }
            }
        });
        ws.send(Message::Text(hello.to_string().into()))
            .await
            .expect("send hello");

        let identify = ws
            .next()
            .await
            .expect("identify stream open")
            .expect("identify frame");
        let Message::Text(text) = identify else {
            panic!("expected identify text frame");
        };
        let frame = broadcast_ws::BroadcastFrame::from_json(&text).expect("parse identify");
        assert_eq!(frame.op, broadcast_ws::OpCode::Identify);
        assert_eq!(
            frame.d["rpcVersion"],
            broadcast_ws::BROADCAST_RPC_VERSION
        );
        let expected = broadcast_ws::compute_authentication(password, salt, challenge);
        assert_eq!(frame.d["authentication"], expected);

        let identified = broadcast_ws::BroadcastFrame::new(
            broadcast_ws::OpCode::Identified,
            serde_json::json!({ "negotiatedRpcVersion": broadcast_ws::BROADCAST_RPC_VERSION }),
        );
        ws.send(Message::Text(identified.to_json().into()))
            .await
            .expect("send identified");
    });

    let url = format!("ws://{addr}");
    let (mut ws, _) = tokio_tungstenite::connect_async(&url)
        .await
        .expect("connect websocket client");
    let hello = ws.next().await.expect("hello stream open").expect("hello frame");
    let Message::Text(hello_text) = hello else {
        panic!("expected hello text frame");
    };
    let hello_frame = broadcast_ws::BroadcastFrame::from_json(&hello_text).expect("parse hello");
    assert_eq!(hello_frame.op, broadcast_ws::OpCode::Hello);
    let returned_challenge = hello_frame.d["authentication"]["challenge"]
        .as_str()
        .expect("challenge string");
    let returned_salt = hello_frame.d["authentication"]["salt"]
        .as_str()
        .expect("salt string");
    let auth = broadcast_ws::compute_authentication(password, returned_salt, returned_challenge);
    let identify = broadcast_ws::broadcast_identify(Some(&auth), 0);
    ws.send(Message::Text(identify.to_json().into()))
        .await
        .expect("send identify");

    let identified = ws
        .next()
        .await
        .expect("identified stream open")
        .expect("identified frame");
    let Message::Text(identified_text) = identified else {
        panic!("expected identified text frame");
    };
    let identified_frame =
        broadcast_ws::BroadcastFrame::from_json(&identified_text).expect("parse identified");
    assert_eq!(identified_frame.op, broadcast_ws::OpCode::Identified);
    server.await.expect("websocket mock server");

    let plan = StudioCompositorPlan {
        canvas_width: 1280,
        canvas_height: 720,
        frame_rate: 30,
        video_layers: vec![VideoLayerSpec {
            input_index: 0,
            x: 0,
            y: 0,
            width: 1280,
            height: 720,
            crop: None,
            chroma_key: None,
            enabled: true,
        }],
        audio_sources: vec![AudioSourceSpec {
            input_index: 0,
            gain_db: -3.0,
            muted: false,
            delay_ms: 0,
            enabled: true,
        }],
        stream_outputs: vec![StreamOutputSpec {
            protocol: StreamProtocol::Srt,
            url: "srt://192.0.2.40:9000".to_string(),
        }],
        record_outputs: vec![RecordOutputSpec {
            container: RecordContainer::Mkv,
            path: "loopback-compositor.mkv".to_string(),
        }],
    };
    let args = build_ffmpeg_filtergraph(&plan).join(" ");
    assert!(args.contains("color=c=black:s=1280x720:r=30"));
    assert!(args.contains("scale=1280:720"));
    assert!(args.contains("volume=-3.00dB") || args.contains("volume=-3dB"));
    assert!(args.contains("srt://192.0.2.40:9000"));
    assert!(args.contains("loopback-compositor.mkv"));
    assert!(args.contains("-f mpegts"));
    assert!(args.contains("-f matroska"));
}
