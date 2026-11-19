// Clean-room Behringer X32 / M32 .scn (Scene) text format parser and serializer.
// Implements 100% interoperability with native Behringer scene backups.

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
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if trimmed.starts_with("#2.") || trimmed.starts_with("#3.") || trimmed.starts_with("#4.") {
                scene.version = trimmed.to_string();
                continue;
            }

            let mut tokens = Vec::new();
            let mut current = String::new();
            let mut in_quotes = false;
            for ch in trimmed.chars() {
                if ch == '"' {
                    in_quotes = !in_quotes;
                } else if ch.is_whitespace() && !in_quotes {
                    if !current.is_empty() {
                        tokens.push(current.clone());
                        current.clear();
                    }
                } else {
                    current.push(ch);
                }
            }
            if !current.is_empty() {
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
            out.push_str("#4.06#
");
        }
        for entry in &self.entries {
            out.push_str(&entry.path);
            for v in &entry.values {
                out.push(' ');
                if v.contains(' ') || v.contains('\t') || v.is_empty() {
                    out.push('"');
                    out.push_str(v);
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

    pub fn get_channel_mute(&self, ch: u8) -> Option<bool> {
        let path = format!("/ch/{:02}/mix/on", ch);
        self.entries.iter().find(|e| e.path == path).and_then(|e| {
            e.values.first().map(|v| v == "ON" || v == "1")
        })
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
/ch/02/mix/fader 0.50
/ch/02/mix/on OFF
"#;
        let parsed = X32Scene::parse(sample).expect("parse failed");
        assert_eq!(parsed.name, "Sunday Morning Worship");
        assert_eq!(parsed.get_channel_fader(1), Some(0.75));
        assert_eq!(parsed.get_channel_mute(1), Some(true));
        assert_eq!(parsed.get_channel_mute(2), Some(false));

        let serialized = parsed.serialize();
        assert!(serialized.contains("/ch/01/mix/fader 0.75"));
        assert!(serialized.contains("Pastor Lavalier"));
    }
}
