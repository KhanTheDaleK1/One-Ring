//! Built-in AI Production Assistant backend for One Ring.
//!
//! Supports:
//! - `opencode_cli`: invokes local OpenCode CLI (`opencode run -m <model>`) using free models
//! - `ollama`: local OpenAI-compatible HTTP endpoint (`http://127.0.0.1:11434/v1/chat/completions`)
//! - `openai_compatible`: any user-configured HTTPS OpenAI-compatible chat completions endpoint
//!
//! Returns a conversational reply plus structured, operator-confirmed `AiProposedAction` items
//! (adding songs, branded announcement slides, theme updates, cues, or stage alerts).

use crate::runtime::hide_console_window;
use crate::runtime::bible_engine::{lookup_passage, BibleProviderConfig};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::process::{Command, Stdio};

const MAX_PROMPT_BYTES: usize = 32 * 1024;
const MAX_RESPONSE_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProposedAction {
    pub kind: String,
    pub label: String,
    pub payload: Value,
    /// Optional summary/post-processing info (e.g. slide count, artist, source)
    pub summary: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistantStatus {
    pub available: bool,
    pub provider: String,
    pub model: String,
    pub opencode_installed: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatResponse {
    pub reply: String,
    pub actions: Vec<AiProposedAction>,
    pub provider: String,
    pub model: String,
}

const SYSTEM_PROMPT: &str = r##"You are the One Ring AI Production Assistant for a church live-production booth.
Help volunteers and engineers quickly build worship playlists, announcement slides, slide themes, cues, and stage alerts.
Keep replies concise, friendly, and practical.

When the user asks you to create or modify anything in One Ring, include a single ```onering-actions JSON block at the END of your reply with an array of actions:
```onering-actions
[
  {
    "kind": "add_announcement_slide",
    "label": "Add Christmas Outreach announcement slide",
    "payload": {
      "eyebrow": "CHRISTMAS OUTREACH",
      "title": "Gifts From The Heart",
      "subtitle": "Christmas Shop",
      "cta": "BRING A NEW, UNWRAPPED GIFT",
      "body": "New gifts for local children and teens. Registries are in the digital bulletin.",
      "backgroundColor": "#0F172A",
      "gradientTo": "#1E3A5F",
      "accentColor": "#38BDF8"
    }
  },
  {
    "kind": "add_song",
    "label": "Add Amazing Grace to Set List",
    "payload": {
      "type": "add_song",
      "title": "Amazing Grace",
      "artist": "Traditional",
      "linesPerSlide": 2
    }
  },
  {
    "kind": "add_scripture",
    "label": "Add Psalm 23 to Set List",
    "payload": {
      "type": "add_scripture",
      "reference": "Psalm 23",
      "translation": "ESV"
    }
  },
  {
    "kind": "update_theme",
    "label": "Apply Warm Sunset Worship Theme",
    "payload": {
      "backgroundType": "gradient",
      "backgroundColor": "#1E1B4B",
      "gradientTo": "#9A3412",
      "textColor": "#FFFFFF",
      "accentColor": "#F59E0B"
    }
  },
  {
    "kind": "set_stage_message",
    "label": "Send stage alert to band",
    "payload": {
      "text": "5 minutes until doors open — mic check complete"
    }
  }
]
```
Only emit valid JSON inside ```onering-actions. Supported kinds: add_announcement_slide, add_song, add_scripture, update_theme, set_stage_message.
NEVER write placeholder lyrics or hardcoded scripture text. The AI must emit structured actions with `type: "add_song"` (title, artist, linesPerSlide) or `type: "add_scripture"` (reference, translation). Real lyrics and verses will be fetched and balanced by the backend enrichment step.
Do NOT include copyrighted modern song lyrics in the AI's reply or payload. Use only public-domain or provided lyrics. The enrich_assistant_actions step below will resolve real content."##;

fn find_opencode_binary() -> Option<String> {
    if let Ok(explicit) = std::env::var("ONE_RING_OPENCODE_BIN") {
        let p = explicit.trim();
        if !p.is_empty() && std::path::Path::new(p).is_file() {
            return Some(p.to_string());
        }
    }
    let mut candidates = vec!["opencode".to_string()];
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(format!("{home}/.opencode/bin/opencode"));
        candidates.push(format!("{home}/.local/bin/opencode"));
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        candidates.push(format!("{profile}\\.opencode\\bin\\opencode.exe"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(format!("{local}\\opencode\\opencode.exe"));
    }
    for bin in candidates {
        let mut cmd = Command::new(&bin);
        cmd.arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hide_console_window(&mut cmd);
        if let Ok(status) = cmd.status() {
            if status.success() {
                return Some(bin);
            }
        }
    }
    None
}

/// One-click installer for the free CLI provider. The installer output is deliberately discarded;
/// success is decided only by the post-install status re-check.
#[cfg(not(target_os = "windows"))]
pub fn install_opencode_cli() -> Result<AiAssistantStatus, String> {
    let script = std::env::temp_dir().join(format!(
        "onering-opencode-install-{}-{}.sh",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));

    let mut download = Command::new("curl");
    download
        .args(["-fsSL", "--max-time", "20", "-o"])
        .arg(&script)
        .arg("https://opencode.ai/install")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console_window(&mut download);
    let fetched = download
        .output()
        .map_err(|e| format!("Failed to download the OpenCode CLI installer: {e}"))?;
    if !fetched.status.success() {
        let _ = std::fs::remove_file(&script);
        let stderr =
            String::from_utf8_lossy(&fetched.stderr[..fetched.stderr.len().min(4096)]).trim().to_string();
        return Err(if stderr.is_empty() {
            "Failed to download the OpenCode CLI installer (is curl installed and online?)".into()
        } else {
            format!("Failed to download the OpenCode CLI installer: {stderr}")
        });
    }

    let mut installer = Command::new("bash");
    installer
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console_window(&mut installer);
    let installed = installer.output();
    let _ = std::fs::remove_file(&script);
    let installed = installed.map_err(|e| format!("Failed to run the OpenCode CLI installer: {e}"))?;
    if !installed.status.success() {
        let stderr =
            String::from_utf8_lossy(&installed.stderr[..installed.stderr.len().min(4096)]).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("OpenCode CLI installer exited with status {}", installed.status)
        } else {
            format!("OpenCode CLI installer error: {stderr}")
        });
    }
    Ok(status("opencode_cli", "opencode/big-pickle", ""))
}

/// Windows counterpart of the one-click installer; the official PowerShell installer places the
/// binary under `.opencode\bin` or the local app data folder, both covered by `find_opencode_binary`.
#[cfg(target_os = "windows")]
pub fn install_opencode_cli() -> Result<AiAssistantStatus, String> {
    let mut installer = Command::new("powershell");
    installer
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            r#"$ErrorActionPreference = 'Stop'; $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }; $url = "https://github.com/anomalyco/opencode/releases/latest/download/opencode-windows-$arch.zip"; $dest = Join-Path $env:USERPROFILE '.opencode\bin'; New-Item -ItemType Directory -Force -Path $dest | Out-Null; $zip = Join-Path $env:TEMP "opencode-install-$PID.zip"; $stage = Join-Path $env:TEMP "opencode-stage-$PID"; Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip -TimeoutSec 60; Expand-Archive -Force -Path $zip -DestinationPath $stage; $exe = Get-ChildItem -Path $stage -Recurse -Filter 'opencode.exe' | Select-Object -First 1; if (-not $exe) { throw 'opencode.exe not found in downloaded archive' }; Copy-Item -Force $exe.FullName (Join-Path $dest 'opencode.exe'); Remove-Item -Force -ErrorAction SilentlyContinue $zip; Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $stage"#,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console_window(&mut installer);
    let output = installer
        .output()
        .map_err(|e| format!("Failed to run the OpenCode CLI installer: {e}"))?;
    if !output.status.success() {
        let stderr =
            String::from_utf8_lossy(&output.stderr[..output.stderr.len().min(4096)]).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("OpenCode CLI installer exited with status {}", output.status)
        } else {
            format!("OpenCode CLI installer error: {stderr}")
        });
    }
    Ok(status("opencode_cli", "opencode/big-pickle", ""))
}

pub fn validate_ai_endpoint(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.len() > 512 || trimmed.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("AI endpoint URL is invalid".into());
    }
    if trimmed.starts_with("https://")
        || trimmed.starts_with("http://127.0.0.1:")
        || trimmed.starts_with("http://localhost:")
    {
        Ok(trimmed.to_string())
    } else {
        Err("AI endpoint must use https:// (or http://127.0.0.1 / http://localhost for local Ollama)".into())
    }
}

pub fn status(provider: &str, model: &str, endpoint: &str) -> AiAssistantStatus {
    let provider = if provider.trim().is_empty() {
        "opencode_cli"
    } else {
        provider.trim()
    };
    let model = if model.trim().is_empty() {
        if provider == "ollama" {
            "llama3.2"
        } else {
            "opencode/big-pickle"
        }
    } else {
        model.trim()
    };
    let opencode_installed = find_opencode_binary().is_some();

    let (available, detail) = match provider {
        "opencode_cli" => {
            if opencode_installed {
                (true, format!("OpenCode CLI ready · model {model}"))
            } else {
                (
                    false,
                    "OpenCode CLI not found on PATH (install opencode or switch to Ollama / OpenAI-Compatible in Settings)".into(),
                )
            }
        }
        "ollama" => (
            validate_ai_endpoint(if endpoint.trim().is_empty() {
                "http://127.0.0.1:11434/v1/chat/completions"
            } else {
                endpoint
            })
            .is_ok(),
            format!("Local Ollama endpoint · model {model}"),
        ),
        "openai_compatible" => match validate_ai_endpoint(endpoint) {
            Ok(_) => (true, format!("OpenAI-compatible HTTPS endpoint · model {model}")),
            Err(e) => (false, e),
        },
        _ => (false, format!("Unsupported AI provider: {provider}")),
    };

    AiAssistantStatus {
        available,
        provider: provider.to_string(),
        model: model.to_string(),
        opencode_installed,
        detail,
    }
}

pub fn extract_actions(raw: &str) -> (String, Vec<AiProposedAction>) {
    let fence = "```onering-actions";
    let Some(start) = raw.find(fence) else {
        return (raw.trim().to_string(), Vec::new());
    };
    let after_fence = &raw[start + fence.len()..];
    let Some(end_rel) = after_fence.find("```") else {
        return (raw.trim().to_string(), Vec::new());
    };
    let json_block = after_fence[..end_rel].trim();
    let actions = serde_json::from_str::<Vec<AiProposedAction>>(json_block).unwrap_or_default();
    let mut cleaned = String::new();
    cleaned.push_str(raw[..start].trim_end());
    let tail = after_fence[end_rel + 3..].trim();
    if !tail.is_empty() {
        if !cleaned.is_empty() {
            cleaned.push_str("\n\n");
        }
        cleaned.push_str(tail);
    }
    if cleaned.is_empty() && !actions.is_empty() {
        cleaned = format!("Prepared {} ready-to-apply production action(s).", actions.len());
    }
    (cleaned, actions)
}

/// Post-processing enrichment: resolve real lyrics/scripture and build SlideCue slides.
/// Called after extract_actions and before returning AiChatResponse.
fn enrich_assistant_actions(
    actions: &mut Vec<AiProposedAction>,
    bible_cfg: &BibleProviderConfig,
) {
    use crate::runtime::lyrics_search::search_song_lyrics;

    for action in actions.iter_mut() {
        // Ensure payload is a JSON object
        if !action.payload.is_object() {
            action.payload = serde_json::Value::Object(Map::new());
        }
        let payload: &mut serde_json::Map<String, Value> = action.payload.as_object_mut().unwrap();
        let kind = action.kind.as_str();

        if kind == "add_song" {
            // Fetch real song lyrics using the online lyric index (and/or local search)
            let title = payload
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string();
            let artist = payload
                .get("artist")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let lines_per_slide = payload
                .get("linesPerSlide")
                .and_then(|v| v.as_u64())
                .unwrap_or(2);

            match search_song_lyrics(&title, if artist.is_empty() { None } else { Some(&artist.as_str()) }, true) {
                Ok(lyric_results) => {
                    if let Some(song) = lyric_results.first() {
                        // Get the lyrics and split into clean, word-boundary-balanced lines
                        let lyrics = &song.lyrics;
                        let lines: Vec<&str> = lyrics.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();

                        // Balance lines into groups of `linesPerSlide` lines, respecting word boundaries
                        let mut balanced_lines: Vec<String> = Vec::new();
                        let mut current_line_set: Vec<String> = Vec::new();
                        let mut current_chars = 0usize;

                        for line in lines {
                            let line_len = line.chars().count();
                            // If adding this line would exceed ~46 chars or we have a full set, finalize current set
                            if current_chars + line_len > 46 && !current_line_set.is_empty() {
                                // Join the current set into a single line text
                                let text = current_line_set.join(" ");
                                balanced_lines.push(text);
                                current_line_set = Vec::new();
                                current_chars = 0;
                            }
                            current_line_set.push(line.to_string());
                            current_chars += line_len;
                        }
                        // Flush remaining lines
                        if !current_line_set.is_empty() {
                            let text = current_line_set.join(" ");
                            balanced_lines.push(text);
                        }

                        // Chunk into slides of 2 lines per slide (or 4 if linesPerSlide suggests)
                        let slides: Vec<serde_json::Value> = balanced_lines
                            .chunks(lines_per_slide as usize)
                            .enumerate()
                            .map(|(i, chunk)| {
                                let section = if chunk.len() == 1 {
                                    "Verse".to_string()
                                } else {
                                    format!("Chorus/Verse {}", i + 1)
                                };
                                serde_json::json!({
                                    "section": section,
                                    "text": chunk.join("\n")
                                })
                            })
                            .collect();

                        // Compute slide count before inserting (slides will be moved into payload)
                        let slide_count = slides.len();
                        payload.insert("slides".to_string(), serde_json::Value::Array(slides));
                        let _artist_source = format!("Add {} ({} slides · Online Lyrics)", title, slide_count);
                        action.summary = Some(serde_json::json!({ "slideCount": slide_count, "artist": song.artist, "source": "online" }));
                    } else {
                        // No results found - keep placeholder
                        payload.insert("slides".to_string(), serde_json::Value::Array([].to_vec()));
                        action.summary = Some(serde_json::json!({ "slideCount": 0, "artist": title, "source": "no-match" }));
                    }
                }
                Err(_) => {
                    // Search failed - keep placeholder
                    payload.insert("slides".to_string(), serde_json::Value::Array([].to_vec()));
                    action.summary = Some(serde_json::json!({ "slideCount": 0, "artist": title, "source": "search-failed" }));
                }
            }
        } else if kind == "add_scripture" {
            let reference = payload
                .get("reference")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let translation = payload
                .get("translation")
                .and_then(|v| v.as_str())
                .unwrap_or("ESV")
                .to_string();

            match lookup_passage(&reference, &translation, bible_cfg) {
                Ok(passage) => {
                    // Build 1-2 verses per slide
                    let verses: Vec<&str> = passage
                        .verses
                        .iter()
                        .map(|v| v.text.as_str())
                        .collect();

                    let slides: Vec<serde_json::Value> = verses
                        .chunks(2)
                        .enumerate()
                        .map(|(i, chunk)| {
                            let ref_str = passage.reference.clone();
                            serde_json::json!({
                                "section": format!("{} {:?}", ref_str, i + 1),
                                "text": chunk.join(" ")
                            })
                        })
                        .collect();

                    let slide_count = slides.len();
                    payload.insert("slides".to_string(), serde_json::Value::Array(slides));
                    action.summary = Some(serde_json::json!({
                        "slideCount": slide_count,
                        "reference": reference,
                        "translation": translation,
                        "source": passage.source
                    }));
                }
                Err(_) => {
                    payload.insert("slides".to_string(), serde_json::Value::Array([].to_vec()));
                    action.summary = Some(serde_json::json!({ "slideCount": 0, "reference": reference, "translation": translation, "source": "lookup-failed" }));
                }
            }
        }
    }
}

fn build_combined_prompt(
    message: &str,
    history: &[AiChatMessage],
    context: &Value,
) -> Result<String, String> {
    let msg = message.trim();
    if msg.is_empty() {
        return Err("Prompt message must not be empty".into());
    }
    let mut out = String::new();
    out.push_str(SYSTEM_PROMPT);
    out.push_str("\n\nCURRENT ONE RING SERVICE CONTEXT (JSON):\n");
    out.push_str(&serde_json::to_string(context).unwrap_or_else(|_| "{}".into()));
    out.push_str("\n\nCONVERSATION:\n");
    for item in history.iter().rev().take(8).rev() {
        let role = if item.role == "assistant" { "Assistant" } else { "User" };
        out.push_str(role);
        out.push_str(": ");
        out.push_str(item.content.trim());
        out.push('\n');
    }
    out.push_str("User: ");
    out.push_str(msg);
    out.push_str("\nAssistant:");
    if out.len() > MAX_PROMPT_BYTES {
        out.truncate(MAX_PROMPT_BYTES);
    }
    Ok(out)
}

fn run_opencode_cli(model: &str, prompt: &str) -> Result<String, String> {
    let bin = find_opencode_binary().ok_or_else(|| {
        "OpenCode CLI is not installed on this machine. Install OpenCode or switch to Ollama / OpenAI-Compatible in Settings -> General -> AI Production Assistant.".to_string()
    })?;
    let clean_model = model.trim();
    if clean_model.is_empty()
        || clean_model.len() > 120
        || clean_model.starts_with('-')
        || clean_model.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err("Invalid AI model identifier".into());
    }
    let mut cmd = Command::new(bin);
    cmd.args(["run", "-m", clean_model, prompt])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run OpenCode CLI: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout[..output.stdout.len().min(MAX_RESPONSE_BYTES)]).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr[..output.stderr.len().min(4096)]).trim().to_string();
    if !output.status.success() && stdout.is_empty() {
        return Err(if stderr.is_empty() {
            format!("OpenCode CLI exited with status {}", output.status)
        } else {
            format!("OpenCode CLI error: {stderr}")
        });
    }
    if stdout.contains("Free usage limit reached") {
        return Err("OpenCode free model daily limit reached. Switch model or select Ollama / OpenAI-Compatible in Settings.".into());
    }
    Ok(stdout)
}

fn run_openai_compatible_http(
    endpoint: &str,
    model: &str,
    api_key: &str,
    message: &str,
    history: &[AiChatMessage],
    context: &Value,
) -> Result<String, String> {
    let url = validate_ai_endpoint(endpoint)?;
    let mut messages = vec![json!({
        "role": "system",
        "content": format!(
            "{SYSTEM_PROMPT}\n\nCURRENT ONE RING SERVICE CONTEXT (JSON):\n{}",
            serde_json::to_string(context).unwrap_or_else(|_| "{}".into())
        )
    })];
    for item in history.iter().rev().take(8).rev() {
        let role = if item.role == "assistant" { "assistant" } else { "user" };
        messages.push(json!({ "role": role, "content": item.content }));
    }
    messages.push(json!({ "role": "user", "content": message.trim() }));

    let body = serde_json::to_string(&json!({
        "model": model.trim(),
        "messages": messages,
        "temperature": 0.4
    }))
    .map_err(|e| e.to_string())?;

    let tmp_path = std::env::temp_dir().join(format!(
        "onering-ai-req-{}-{}.json",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::write(&tmp_path, &body).map_err(|e| format!("Failed to stage AI request: {e}"))?;

    let raw_out = {
        #[cfg(not(target_os = "windows"))]
        {
            let mut cmd = Command::new("curl");
            cmd.args([
                "-fsSL",
                "--max-time",
                "30",
                "--max-filesize",
                "262144",
                "-H",
                "Content-Type: application/json",
            ]);
            if !api_key.trim().is_empty() && !api_key.chars().any(char::is_control) {
                cmd.args(["-H", &format!("Authorization: Bearer {}", api_key.trim())]);
            }
            cmd.args(["--data-binary", &format!("@{}", tmp_path.display()), &url]);
            hide_console_window(&mut cmd);
            cmd.output()
        }
        #[cfg(target_os = "windows")]
        {
            let mut cmd = Command::new("powershell");
            cmd.args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$headers = @{ 'Content-Type' = 'application/json' }; if ($env:ONERING_AI_KEY) { $headers['Authorization'] = 'Bearer ' + $env:ONERING_AI_KEY }; $body = Get-Content -Raw -Path $env:ONERING_AI_BODY; (Invoke-WebRequest -UseBasicParsing -Uri $env:ONERING_AI_URL -Method Post -Headers $headers -Body $body -TimeoutSec 30).Content",
            ]);
            cmd.env("ONERING_AI_URL", &url);
            cmd.env("ONERING_AI_BODY", tmp_path.as_os_str());
            cmd.env("ONERING_AI_KEY", api_key.trim());
            hide_console_window(&mut cmd);
            cmd.output()
        }
    };
    let _ = std::fs::remove_file(&tmp_path);

    let output = raw_out.map_err(|e| format!("AI HTTP request failed: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("AI endpoint returned an error: {}", err.trim()));
    }
    let parsed: Value = serde_json::from_slice(&output.stdout[..output.stdout.len().min(MAX_RESPONSE_BYTES)])
        .map_err(|e| format!("Invalid JSON from AI endpoint: {e}"))?;
    let content = parsed
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .or_else(|| parsed.pointer("/message/content").and_then(Value::as_str))
        .ok_or_else(|| "AI endpoint response missing assistant message content".to_string())?;
    Ok(content.to_string())
}

pub fn chat(
    provider: &str,
    model: &str,
    endpoint: &str,
    api_key: &str,
    message: &str,
    history: &[AiChatMessage],
    context: &Value,
    bible_cfg: &BibleProviderConfig,
) -> Result<AiChatResponse, String> {
    let provider = if provider.trim().is_empty() {
        "opencode_cli"
    } else {
        provider.trim()
    };
    let model = if model.trim().is_empty() {
        if provider == "ollama" {
            "llama3.2"
        } else {
            "opencode/big-pickle"
        }
    } else {
        model.trim()
    };

    let raw_reply = match provider {
        "opencode_cli" => {
            let prompt = build_combined_prompt(message, history, context)?;
            run_opencode_cli(model, &prompt)?
        }
        "ollama" => {
            let url = if endpoint.trim().is_empty() {
                "http://127.0.0.1:11434/v1/chat/completions"
            } else {
                endpoint
            };
            run_openai_compatible_http(url, model, "", message, history, context)?
        }
        "openai_compatible" => {
            run_openai_compatible_http(endpoint, model, api_key, message, history, context)?
        }
        other => return Err(format!("Unsupported AI provider: {other}")),
    };

    let (reply, mut actions) = extract_actions(&raw_reply);

    // Post-process: resolve real lyrics/scripture and populate slides
    enrich_assistant_actions(&mut actions, bible_cfg);

    Ok(AiChatResponse {
        reply,
        actions,
        provider: provider.to_string(),
        model: model.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_actions_parses_fenced_action_block() {
        let sample = "I created your announcement slide.\n\n```onering-actions\n[{\"kind\":\"add_announcement_slide\",\"label\":\"Add Christmas Outreach\",\"payload\":{\"title\":\"Gifts From The Heart\"}}]\n```";
        let (reply, actions) = extract_actions(sample);
        assert_eq!(reply, "I created your announcement slide.");
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].kind, "add_announcement_slide");
        assert_eq!(actions[0].payload["title"], "Gifts From The Heart");
    }

    #[test]
    fn validate_ai_endpoint_enforces_https_or_loopback() {
        assert!(validate_ai_endpoint("https://api.example.com/v1/chat/completions").is_ok());
        assert!(validate_ai_endpoint("http://127.0.0.1:11434/v1/chat/completions").is_ok());
        assert!(validate_ai_endpoint("http://192.0.2.50/v1/chat").is_err());
        assert!(validate_ai_endpoint("file:///etc/passwd").is_err());
    }
}
