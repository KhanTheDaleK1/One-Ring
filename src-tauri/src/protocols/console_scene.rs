// Clean-room Console Console / Console .scn (Scene) text format parser and serializer.
// Implements interoperability with Console scene backups.
//
// Supported records (plain wire text, no vendor source material):
//   #<version># "<scene name>" "<color>" %<safe-bits> <flags>   scene header
//   SAFE <group> <0|1>                                          parameter-safe bit
//   SNIPPET <index> "<name>" <color> %<safe-bits> <fade-ms>      snippet header
//   CUE <index> <trigger> "<target>" <value> <delay-ms> <fade-ms> cue automation
//   /osc/path value...                                          generic scene parameter

use std::collections::HashMap;

/// Parameter-safe bitmask from a scene or snippet header.
///
/// Bit `n` protects safe group `n` from being overwritten by a recall. `width` records how many
/// binary digits the source file used so serialization can preserve the original token shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SceneSafeMask {
    pub bits: u32,
    pub width: usize,
}

impl Default for SceneSafeMask {
    fn default() -> Self {
        Self { bits: 0, width: 0 }
    }
}

impl SceneSafeMask {
    /// Parse a `%`-prefixed (or bare) binary mask token.
    pub fn from_binary(token: &str) -> Option<Self> {
        let digits = token.strip_prefix('%').unwrap_or(token);
        if digits.is_empty() || digits.len() > 32 || !digits.bytes().all(|b| b == b'0' || b == b'1') {
            return None;
        }
        Some(Self {
            bits: u32::from_str_radix(digits, 2).ok()?,
            width: digits.len(),
        })
    }

    /// Render the canonical `%`-prefixed token.
    pub fn to_token(&self) -> String {
        format!("%{:0width$b}", self.bits, width = self.width.max(1))
    }

    pub fn is_safe(&self, group: u32) -> bool {
        group < 32 && (self.bits & (1u32 << group)) != 0
    }

    pub fn set(&mut self, group: u32, safe: bool) {
        if group >= 32 {
            return;
        }
        if safe {
            self.bits |= 1u32 << group;
        } else {
            self.bits &= !(1u32 << group);
        }
        self.width = self.width.max(group as usize + 1);
    }

    pub fn safe_groups(&self) -> Vec<u32> {
        (0..32).filter(|group| self.is_safe(*group)).collect()
    }
}

/// Header of a snippet (a partial scene recall) embedded in a scene backup.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SnippetHeader {
    pub index: u32,
    pub name: String,
    pub color: String,
    pub safes: SceneSafeMask,
    pub fade_ms: u32,
}

impl SnippetHeader {
    pub fn from_tokens(tokens: &[String]) -> Option<Self> {
        if tokens.len() < 3 {
            return None;
        }
        let index = tokens.get(1)?.parse::<u32>().ok()?;
        let name = tokens[2].clone();
        let mut color = String::new();
        let mut safes = SceneSafeMask::default();
        let mut fade_ms = 0;
        for token in tokens.iter().skip(3) {
            // Only `%`-prefixed tokens are masks; a bare `1` is a fade value or flag.
            if let Some(mask) = token.strip_prefix('%').and_then(SceneSafeMask::from_binary) {
                safes = mask;
            } else if let Ok(value) = token.parse::<u32>() {
                fade_ms = value;
            } else if color.is_empty() && token != "-" && !token.is_empty() {
                color = token.clone();
            }
        }
        Some(Self {
            index,
            name,
            color,
            safes,
            fade_ms,
        })
    }

    pub fn to_line(&self) -> String {
        let color = if self.color.is_empty() { "-" } else { self.color.as_str() };
        let mut line = format!("SNIPPET {} \"{}\" {color}", self.index, escape_token(&self.name));
        if self.safes.width > 0 || self.safes.bits != 0 {
            line.push_str(&format!(" {}", self.safes.to_token()));
        }
        line.push_str(&format!(" {}", self.fade_ms));
        line
    }
}

/// One entry in a cue/automation list stored alongside a scene backup.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct CueAutomationEntry {
    pub index: u32,
    /// `MANUAL`, `AUTO` or `TIME`.
    pub trigger: String,
    /// OSC address or named recall target.
    pub target: String,
    pub value: String,
    pub delay_ms: u32,
    pub fade_ms: u32,
}

impl CueAutomationEntry {
    pub fn from_tokens(tokens: &[String]) -> Option<Self> {
        if tokens.len() < 4 {
            return None;
        }
        let index = tokens.get(1)?.parse::<u32>().ok()?;
        let trigger = tokens[2].clone();
        let target = tokens[3].clone();
        let value = tokens
            .get(4)
            .filter(|value| value.as_str() != "-")
            .cloned()
            .unwrap_or_default();
        let delay_ms = tokens
            .get(5)
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(0);
        let fade_ms = tokens
            .get(6)
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(0);
        Some(Self {
            index,
            trigger,
            target,
            value,
            delay_ms,
            fade_ms,
        })
    }

    pub fn to_line(&self) -> String {
        let value = if self.value.is_empty() { "-" } else { self.value.as_str() };
        format!(
            "CUE {} {} \"{}\" {value} {} {}",
            self.index,
            self.trigger,
            escape_token(&self.target),
            self.delay_ms,
            self.fade_ms
        )
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConsoleSceneEntry {
    pub path: String,
    pub values: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ConsoleScene {
    pub version: String,
    pub name: String,
    pub entries: Vec<ConsoleSceneEntry>,
    pub metadata: HashMap<String, String>,
    /// Parameter safes from the scene header and any `SAFE` records.
    pub safes: SceneSafeMask,
    /// Snippet headers included in this backup.
    pub snippets: Vec<SnippetHeader>,
    /// Cue automation entries included in this backup.
    pub cues: Vec<CueAutomationEntry>,
}

impl ConsoleScene {
    pub fn parse(input: &str) -> Result<Self, String> {
        let mut scene = ConsoleScene::default();
        for line in input.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            if let Some(version) = version_token(trimmed) {
                scene.version = format!("#{version}#");
                let tokens = tokenize(trimmed);
                for (position, token) in tokens.iter().enumerate().skip(1) {
                    // Only `%`-prefixed tokens are masks; bare digits are header flags.
                    if let Some(mask) = token.strip_prefix('%').and_then(SceneSafeMask::from_binary) {
                        scene.safes = mask;
                    } else if position == 1 && scene.name.is_empty() && !token.is_empty() {
                        scene.name = token.clone();
                    } else {
                        scene.metadata.insert(format!("header_{position}"), token.clone());
                    }
                }
                continue;
            }
            if trimmed.starts_with('#') {
                continue;
            }

            let tokens = tokenize(trimmed);
            if tokens.is_empty() {
                continue;
            }

            match tokens[0].as_str() {
                keyword if keyword.eq_ignore_ascii_case("SAFE") => {
                    let group = tokens.get(1).and_then(|value| value.parse::<u32>().ok());
                    let enabled = tokens
                        .get(2)
                        .map(|value| value.eq_ignore_ascii_case("ON") || value == "1");
                    if let (Some(group), Some(enabled)) = (group, enabled) {
                        scene.safes.set(group, enabled);
                    }
                    continue;
                }
                keyword if keyword.eq_ignore_ascii_case("SNIPPET") => {
                    if let Some(header) = SnippetHeader::from_tokens(&tokens) {
                        scene.snippets.push(header);
                    }
                    continue;
                }
                keyword if keyword.eq_ignore_ascii_case("CUE") => {
                    if let Some(entry) = CueAutomationEntry::from_tokens(&tokens) {
                        scene.cues.push(entry);
                    }
                    continue;
                }
                _ => {}
            }

            let path = tokens[0].clone();
            let values = tokens[1..].to_vec();

            if path == "/scene/name" && !values.is_empty() {
                scene.name = values.join(" ");
            }

            scene.entries.push(ConsoleSceneEntry { path, values });
        }
        Ok(scene)
    }

    pub fn serialize(&self) -> String {
        let mut out = String::new();
        let version = if self.version.is_empty() {
            "#4.06#".to_string()
        } else {
            self.version.clone()
        };

        // Keep the legacy one-token header for plain scenes; emit the extended header only
        // when there is safe/snippet/cue data to preserve.
        if self.safes.width > 0 || self.safes.bits != 0 || !self.snippets.is_empty() || !self.cues.is_empty() {
            out.push_str(&format!(
                "{} \"{}\" \"\" {}\n",
                version,
                escape_token(&self.name),
                self.safes.to_token()
            ));
        } else {
            out.push_str(&version);
            out.push('\n');
        }

        for entry in &self.entries {
            out.push_str(&entry.path);
            for value in &entry.values {
                out.push(' ');
                if value.contains(' ') || value.contains('\t') || value.contains('"') || value.is_empty() {
                    out.push('"');
                    out.push_str(&escape_token(value));
                    out.push('"');
                } else {
                    out.push_str(value);
                }
            }
            out.push('\n');
        }

        for snippet in &self.snippets {
            out.push_str(&snippet.to_line());
            out.push('\n');
        }
        for cue in &self.cues {
            out.push_str(&cue.to_line());
            out.push('\n');
        }
        out
    }

    pub fn get_channel_fader(&self, ch: u8) -> Option<f32> {
        let path = format!("/ch/{:02}/mix/fader", ch);
        self.entries.iter().find(|e| e.path == path).and_then(|e| {
            e.values.first().and_then(|v| v.parse::<f32>().ok())
        })
    }

    /// Returns `Some(true)` when `/ch/NN/mix/on` is ON/1 (channel active/unmuted).
    pub fn get_channel_on(&self, ch: u8) -> Option<bool> {
        let path = format!("/ch/{:02}/mix/on", ch);
        self.entries.iter().find(|e| e.path == path).and_then(|e| {
            e.values.first().map(|v| v.eq_ignore_ascii_case("ON") || v == "1")
        })
    }

    /// Returns `Some(true)` when the channel is muted (`/ch/NN/mix/on` is OFF/0).
    pub fn get_channel_mute(&self, ch: u8) -> Option<bool> {
        self.get_channel_on(ch).map(|on| !on)
    }

    /// True when safe group `group` is protected from a scene recall.
    pub fn is_safe(&self, group: u32) -> bool {
        self.safes.is_safe(group)
    }

    /// Protect (or unprotect) a parameter group. The mask is included on the next serialize.
    pub fn set_safe(&mut self, group: u32, safe: bool) {
        self.safes.set(group, safe);
    }

    /// Cue automation entries in file order.
    pub fn cue_entries(&self) -> &[CueAutomationEntry] {
        &self.cues
    }
}

/// Extract a `#version#` token, returning the inner text. Lines that merely begin with `#`
/// (ordinary comments) do not have a closing marker and are ignored.
fn version_token(line: &str) -> Option<&str> {
    let rest = line.strip_prefix('#')?;
    let end = rest.find('#')?;
    Some(&rest[..end])
}

fn escape_token(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn tokenize(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut saw_quotes = false;
    let mut escape_next = false;

    for ch in line.chars() {
        if escape_next {
            current.push(ch);
            escape_next = false;
            continue;
        }
        if ch == '\\' && in_quotes {
            escape_next = true;
        } else if ch == '"' {
            in_quotes = !in_quotes;
            saw_quotes = true;
        } else if ch.is_whitespace() && !in_quotes {
            if !current.is_empty() || saw_quotes {
                tokens.push(current.clone());
                current.clear();
                saw_quotes = false;
            }
        } else {
            current.push(ch);
        }
    }
    if !current.is_empty() || saw_quotes {
        tokens.push(current);
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_console_scene_parse_and_serialize() {
        let sample = r#"#4.06#
 /scene/name "Sunday Morning Worship"
 /ch/01/config/name "Pastor Lavalier"
 /ch/01/mix/fader 0.75
 /ch/01/mix/on ON
 /ch/02/config "" 1 YE
 /ch/02/mix/fader 0.50
 /ch/02/mix/on OFF
 "#;
        let parsed = ConsoleScene::parse(sample).expect("parse failed");
        assert_eq!(parsed.version, "#4.06#");
        assert_eq!(parsed.name, "Sunday Morning Worship");
        assert_eq!(parsed.get_channel_fader(1), Some(0.75));
        assert_eq!(parsed.get_channel_on(1), Some(true));
        assert_eq!(parsed.get_channel_mute(1), Some(false));
        assert_eq!(parsed.get_channel_on(2), Some(false));
        assert_eq!(parsed.get_channel_mute(2), Some(true));

        let ch2_cfg = parsed.entries.iter().find(|e| e.path == "/ch/02/config").unwrap();
        assert_eq!(ch2_cfg.values, vec!["", "1", "YE"]);

        let serialized = parsed.serialize();
        assert!(serialized.starts_with("#4.06#\n"));
        assert!(serialized.contains("/ch/01/mix/fader 0.75"));
        assert!(serialized.contains("Pastor Lavalier"));
        assert!(serialized.contains("/ch/02/config \"\" 1 YE"));
    }

    #[test]
    fn safe_mask_parses_sets_and_serializes() {
        let mask = SceneSafeMask::from_binary("%1001").unwrap();
        assert_eq!(mask.bits, 9);
        assert_eq!(mask.width, 4);
        assert!(mask.is_safe(0));
        assert!(!mask.is_safe(1));
        assert!(mask.is_safe(3));
        assert_eq!(mask.safe_groups(), vec![0, 3]);
        assert_eq!(mask.to_token(), "%1001");

        let mut edited = mask;
        edited.set(5, true);
        assert!(edited.is_safe(5));
        assert_eq!(edited.to_token(), "%101001");
        edited.set(0, false);
        assert!(!edited.is_safe(0));
        edited.set(40, true);
        assert_eq!(edited.bits, 0b101000); // group 40 is ignored

        assert!(SceneSafeMask::from_binary("").is_none());
        assert!(SceneSafeMask::from_binary("%1020").is_none());
        assert!(SceneSafeMask::from_binary(&"1".repeat(33)).is_none());
    }

    #[test]
    fn scene_safes_header_and_safe_lines_roundtrip() {
        let sample = r#"#2.1# "Service" "" %000000000 1
SAFE 3 1
SAFE 7 ON
/ch/01/mix/fader 0.75
"#;
        let parsed = ConsoleScene::parse(sample).unwrap();
        assert_eq!(parsed.version, "#2.1#");
        assert_eq!(parsed.name, "Service");
        assert!(parsed.is_safe(3));
        assert!(parsed.is_safe(7));
        assert!(!parsed.is_safe(4));
        assert_eq!(parsed.safes.width, 9);

        let serialized = parsed.serialize();
        assert!(serialized.starts_with("#2.1# \"Service\" \"\" %010001000"));
        let reparsed = ConsoleScene::parse(&serialized).unwrap();
        assert_eq!(reparsed.safes, parsed.safes);
        assert_eq!(reparsed.get_channel_fader(1), Some(0.75));
    }

    #[test]
    fn snippet_headers_roundtrip() {
        let sample = r#"#4.06#
SNIPPET 1 "Verse Pad" BL %0011 250
SNIPPET 12 "Post Sermon" - %10000000 0
/ch/01/mix/on ON
"#;
        let parsed = ConsoleScene::parse(sample).unwrap();
        assert_eq!(parsed.snippets.len(), 2);
        assert_eq!(parsed.snippets[0].index, 1);
        assert_eq!(parsed.snippets[0].name, "Verse Pad");
        assert_eq!(parsed.snippets[0].color, "BL");
        assert_eq!(parsed.snippets[0].fade_ms, 250);
        assert!(parsed.snippets[0].safes.is_safe(0));
        assert_eq!(parsed.snippets[1].index, 12);
        assert_eq!(parsed.snippets[1].color, "");

        let serialized = parsed.serialize();
        assert!(serialized.contains("SNIPPET 1 \"Verse Pad\" BL %0011 250"));
        let reparsed = ConsoleScene::parse(&serialized).unwrap();
        assert_eq!(reparsed.snippets, parsed.snippets);
    }

    #[test]
    fn cue_automation_entries_roundtrip() {
        let sample = r#"#4.06#
CUE 1 MANUAL "/-action/goscene" 4 0 300
CUE 2 AUTO "/ch/01/mix/fader" 0.75 1500 0
CUE 3 TIME "/-action/gosnippet" - 0 0
"#;
        let parsed = ConsoleScene::parse(sample).unwrap();
        assert_eq!(parsed.cue_entries().len(), 3);
        assert_eq!(parsed.cues[0].index, 1);
        assert_eq!(parsed.cues[0].trigger, "MANUAL");
        assert_eq!(parsed.cues[0].target, "/-action/goscene");
        assert_eq!(parsed.cues[0].value, "4");
        assert_eq!(parsed.cues[0].fade_ms, 300);
        assert_eq!(parsed.cues[1].delay_ms, 1500);
        assert_eq!(parsed.cues[2].value, "");

        let serialized = parsed.serialize();
        assert!(serialized.contains("CUE 1 MANUAL \"/-action/goscene\" 4 0 300"));
        let reparsed = ConsoleScene::parse(&serialized).unwrap();
        assert_eq!(reparsed.cues, parsed.cues);
    }

    #[test]
    fn malformed_auxiliary_records_are_ignored() {
        let parsed = ConsoleScene::parse(
            "#4.06#\nSAFE nope 1\nSNIPPET\nCUE 1\n/ch/01/mix/on OFF\n",
        )
        .unwrap();
        assert_eq!(parsed.safes.bits, 0);
        assert!(parsed.snippets.is_empty());
        assert!(parsed.cues.is_empty());
        assert_eq!(parsed.get_channel_on(1), Some(false));
    }
}
