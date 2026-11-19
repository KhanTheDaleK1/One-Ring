// Clean-room PTZ_IP-over-IP (Camera/Camera/Camera/Camera) UDP protocol codec.
// Standard UDP port: 52381.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PtzIpPayloadType {
    Command = 0x0100,
    Inquiry = 0x0110,
    Reply = 0x0111,
    DeviceSetting = 0x0120,
    Control = 0x0200,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PtzIpPacket {
    pub payload_type: PtzIpPayloadType,
    pub sequence_number: u32,
    pub payload: Vec<u8>,
}

impl PtzIpPacket {
    pub fn new(payload_type: PtzIpPayloadType, sequence_number: u32, payload: Vec<u8>) -> Self {
        Self {
            payload_type,
            sequence_number,
            payload,
        }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(8 + self.payload.len());
        // 2 bytes payload type (big-endian)
        let pt = self.payload_type as u16;
        bytes.push((pt >> 8) as u8);
        bytes.push((pt & 0xFF) as u8);

        // 2 bytes payload length (big-endian)
        let len = self.payload.len() as u16;
        bytes.push((len >> 8) as u8);
        bytes.push((len & 0xFF) as u8);

        // 4 bytes sequence number (big-endian)
        bytes.extend_from_slice(&self.sequence_number.to_be_bytes());

        // Raw PTZ_IP payload bytes
        bytes.extend_from_slice(&self.payload);
        bytes
    }

    pub fn parse_bytes(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() < 8 {
            return Err("PTZ_IP packet too short (< 8 bytes)".into());
        }
        let pt_raw = ((bytes[0] as u16) << 8) | (bytes[1] as u16);
        let payload_type = match pt_raw {
            0x0100 => PtzIpPayloadType::Command,
            0x0110 => PtzIpPayloadType::Inquiry,
            0x0111 => PtzIpPayloadType::Reply,
            0x0120 => PtzIpPayloadType::DeviceSetting,
            0x0200 => PtzIpPayloadType::Control,
            _ => return Err(format!("Unknown PTZ_IP payload type: 0x{:04X}", pt_raw)),
        };

        let payload_len = (((bytes[2] as u16) << 8) | (bytes[3] as u16)) as usize;
        let mut seq_bytes = [0u8; 4];
        seq_bytes.copy_from_slice(&bytes[4..8]);
        let sequence_number = u32::from_be_bytes(seq_bytes);

        if bytes.len() < 8 + payload_len {
            return Err(format!(
                "PTZ_IP packet truncated: expected {} payload bytes, found {}",
                payload_len,
                bytes.len() - 8
            ));
        }

        let payload = bytes[8..8 + payload_len].to_vec();
        Ok(Self {
            payload_type,
            sequence_number,
            payload,
        })
    }

    // Standard PTZ Command Builders:
    pub fn pan_tilt_drive(seq: u32, pan_speed: u8, tilt_speed: u8, pan_dir: i8, tilt_dir: i8) -> Self {
        // 81 01 06 01 VV WW 0X 0Y FF
        let p_byte = if pan_dir > 0 { 0x02 } else if pan_dir < 0 { 0x01 } else { 0x03 };
        let t_byte = if tilt_dir > 0 { 0x01 } else if tilt_dir < 0 { 0x02 } else { 0x03 };
        let payload = vec![
            0x81, 0x01, 0x06, 0x01,
            pan_speed.clamp(1, 24),
            tilt_speed.clamp(1, 20),
            p_byte,
            t_byte,
            0xFF,
        ];
        Self::new(PtzIpPayloadType::Command, seq, payload)
    }

    pub fn zoom_drive(seq: u32, zoom_dir: i8, speed: u8) -> Self {
        // 81 01 04 07 2p FF (tele) or 3p (wide) or 00 (stop)
        let z_byte = if zoom_dir > 0 {
            0x20 | (speed.clamp(0, 7) & 0x07)
        } else if zoom_dir < 0 {
            0x30 | (speed.clamp(0, 7) & 0x07)
        } else {
            0x00
        };
        let payload = vec![0x81, 0x01, 0x04, 0x07, z_byte, 0xFF];
        Self::new(PtzIpPayloadType::Command, seq, payload)
    }

    pub fn recall_preset(seq: u32, preset_idx: u8) -> Self {
        // 81 01 04 3F 02 pp FF
        let payload = vec![0x81, 0x01, 0x04, 0x3F, 0x02, preset_idx, 0xFF];
        Self::new(PtzIpPayloadType::Command, seq, payload)
    }

    pub fn set_preset(seq: u32, preset_idx: u8) -> Self {
        // 81 01 04 3F 01 pp FF
        let payload = vec![0x81, 0x01, 0x04, 0x3F, 0x01, preset_idx, 0xFF];
        Self::new(PtzIpPayloadType::Command, seq, payload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ptz_packet_serialize_and_parse() {
        let recall = PtzIpPacket::recall_preset(42, 3);
        let bytes = recall.to_bytes();
        assert_eq!(bytes.len(), 8 + 7);
        assert_eq!(&bytes[0..2], &[0x01, 0x00]); // Command
        assert_eq!(&bytes[2..4], &[0x00, 0x07]); // Length 7
        assert_eq!(&bytes[4..8], &[0x00, 0x00, 0x00, 0x2A]); // Seq 42
        assert_eq!(&bytes[8..], &[0x81, 0x01, 0x04, 0x3F, 0x02, 0x03, 0xFF]);

        let parsed = PtzIpPacket::parse_bytes(&bytes).unwrap();
        assert_eq!(parsed.sequence_number, 42);
        assert_eq!(parsed.payload_type, PtzIpPayloadType::Command);
        assert_eq!(parsed.payload, recall.payload);
    }
}
