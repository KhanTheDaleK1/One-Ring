// Clean-room MIDI 1.0 message codec for control surface mapping
// (Stream Deck, MIDI fader controllers, Akai APC, Behringer X-Touch, pedal triggers).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MidiMessageType {
    NoteOff = 0x80,
    NoteOn = 0x90,
    PolyAftertouch = 0xA0,
    ControlChange = 0xB0,
    ProgramChange = 0xC0,
    ChannelAftertouch = 0xD0,
    PitchBend = 0xE0,
    SystemExclusive = 0xF0,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MidiMessage {
    pub channel: u8,
    pub message_type: MidiMessageType,
    pub data1: u8,
    pub data2: u8,
}

impl MidiMessage {
    pub fn new(message_type: MidiMessageType, channel: u8, data1: u8, data2: u8) -> Self {
        Self {
            channel: channel & 0x0F,
            message_type,
            data1: data1 & 0x7F,
            data2: data2 & 0x7F,
        }
    }

    pub fn parse_bytes(bytes: &[u8]) -> Result<Self, String> {
        if bytes.is_empty() {
            return Err("Empty MIDI packet".into());
        }
        let status = bytes[0];
        let status_type = status & 0xF0;
        let channel = status & 0x0F;

        let message_type = match status_type {
            0x80 => MidiMessageType::NoteOff,
            0x90 => {
                if bytes.len() > 2 && bytes[2] == 0 {
                    MidiMessageType::NoteOff
                } else {
                    MidiMessageType::NoteOn
                }
            }
            0xA0 => MidiMessageType::PolyAftertouch,
            0xB0 => MidiMessageType::ControlChange,
            0xC0 => MidiMessageType::ProgramChange,
            0xD0 => MidiMessageType::ChannelAftertouch,
            0xE0 => MidiMessageType::PitchBend,
            _ => return Err(format!("Unsupported or system MIDI status: 0x{:02X}", status)),
        };

        let data1 = if bytes.len() > 1 { bytes[1] & 0x7F } else { 0 };
        let data2 = if bytes.len() > 2 { bytes[2] & 0x7F } else { 0 };

        Ok(Self {
            channel,
            message_type,
            data1,
            data2,
        })
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let status = (self.message_type as u8) | (self.channel & 0x0F);
        match self.message_type {
            MidiMessageType::ProgramChange | MidiMessageType::ChannelAftertouch => {
                vec![status, self.data1 & 0x7F]
            }
            _ => vec![status, self.data1 & 0x7F, self.data2 & 0x7F],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidiTriggerBinding {
    pub id: String,
    pub name: String,
    pub channel: u8,
    pub message_type: MidiMessageType,
    pub control_or_note: u8,
    pub target_action: String, // e.g. "cue_next", "mute_dca_1", "slide_next", "cam_preset_1"
}

impl MidiTriggerBinding {
    pub fn matches(&self, msg: &MidiMessage) -> bool {
        self.channel == msg.channel
            && self.message_type == msg.message_type
            && self.control_or_note == msg.data1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_midi_parse_and_serialize() {
        let note_on = vec![0x90, 0x3C, 0x64]; // Note On, Channel 0, Middle C (60), Velocity 100
        let parsed = MidiMessage::parse_bytes(&note_on).unwrap();
        assert_eq!(parsed.channel, 0);
        assert_eq!(parsed.message_type, MidiMessageType::NoteOn);
        assert_eq!(parsed.data1, 60);
        assert_eq!(parsed.data2, 100);
        assert_eq!(parsed.to_bytes(), note_on);

        let cc = vec![0xB1, 0x07, 0x7F]; // CC 7 (Volume), Channel 1, Value 127
        let parsed_cc = MidiMessage::parse_bytes(&cc).unwrap();
        assert_eq!(parsed_cc.channel, 1);
        assert_eq!(parsed_cc.message_type, MidiMessageType::ControlChange);
        assert_eq!(parsed_cc.data1, 7);
        assert_eq!(parsed_cc.data2, 127);
        assert_eq!(parsed_cc.to_bytes(), cc);
    }

    #[test]
    fn test_midi_binding_match() {
        let binding = MidiTriggerBinding {
            id: "bind-1".into(),
            name: "Go Next Cue".into(),
            channel: 0,
            message_type: MidiMessageType::NoteOn,
            control_or_note: 60,
            target_action: "cue_next".into(),
        };

        let msg_match = MidiMessage::new(MidiMessageType::NoteOn, 0, 60, 127);
        let msg_other = MidiMessage::new(MidiMessageType::NoteOn, 0, 61, 127);
        assert!(binding.matches(&msg_match));
        assert!(!binding.matches(&msg_other));
    }
}
