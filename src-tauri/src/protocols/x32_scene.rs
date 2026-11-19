// Clean-room Behringer X32 / M32 .scn (Scene) text format parser and serializer.
// Implements interoperability with Behringer scene backups.

use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub struct X32SceneEntry {
    pub path: String,
    pub values: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct X32Scene {
    pub version: String,
    pub name: String,
    pub entries: Vec<X32SceneEntry>,
    pub metadata: HashMap<String, String>,
}

impl X32Scene {
    pub fn parse(input: &str) -> Result<Self, String> {
        let mut scene = X32Scene::default();
        for line in input.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if trimmed.starts_with("#2.") || trimmed.starts_with("#3.") || trimmed.starts_with("#4.") {
                scene.version = trimmed.to_string();
                continue;
            }
            if trimmed.starts_with('#') {
                continue;
            }

            let mut tokens = Vec::new();
            let mut current = String::new();
            let mut in_quotes = false;
            let mut saw_quotes = false;
            let mut escape_next = false;

            for ch in trimmed.chars() {
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

            if tokens.is_empty() {
                continue;
            }

            let path = tokens[0].clone();
            let values = tokens[1..].to_vec();

            if path == "/scene/name" && !values.is_empty() {
                scene.name = values.join(" ");
            }

            scene.entries.push(X32SceneEntry { path, values });
        }
        Ok(scene)
    }

    pub fn serialize(&self) -> String {
        let mut out = String::new();
        if !self.version.is_empty() {
            out.push_str(&self.version);
            out.push('\n');
        } else {
            out.push_str("#4.06#\n");
        }
        for entry in &self.entries {
            out.push_str(&entry.path);
            for v in &entry.values {
                out.push(' ');
                if v.contains(' ') || v.contains('\t') || v.contains('"') || v.is_empty() {
                    out.push('"');
                    out.push_str(&v.replace('\\', "\\\\").replace('"', "\\\""));
                    out.push('"');
                } else {
                    out.push_str(v);
                }
            }
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_x32_scene_parse_and_serialize() {
        let sample = r#"#4.06#
/scene/name "Sunday Morning Worship"
/ch/01/config/name "Pastor Lavalier"
/ch/01/mix/fader 0.75
/ch/01/mix/on ON
/ch/02/config "" 1 YE
/ch/02/mix/fader 0.50
/ch/02/mix/on OFF
"#;
        let parsed = X32Scene::parse(sample).expect("parse failed");
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
}
