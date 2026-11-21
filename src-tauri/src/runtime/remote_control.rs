use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

// ── In-memory state for the remote control server ──────────────────────

/// Generated 6-digit pairing code (None = no code currently active).
type PairingCode = std::sync::Mutex<Option<u32>>;

/// Revocable bearer tokens stored in memory.
type Tokens = Arc<Mutex<Vec<String>>>;

// ── JSON payloads ──────────────────────────────────────────────────────

/// Request body for POST /api/pair.
#[derive(Debug, Serialize, Deserialize)]
pub struct PairRequest {
    /// 6-digit code (0 means "give me a new code").
    pub code: u32,
    /// Name of the connecting device.
    pub device_name: String,
}

/// Response body for POST /api/pair.
#[derive(Debug, Serialize)]
pub struct PairResponse {
    /// Bearer token for authenticated endpoints.
    pub token: String,
}

/// Request body for POST /api/command.
#[derive(Debug, Serialize, Deserialize)]
pub struct CommandReq {
    /// The command to execute.
    pub command: String,
    /// Optional command-specific arguments.
    pub args: Option<serde_json::Value>,
}

/// Simplified app state snapshot returned by the /api/state endpoint.
#[derive(Debug, Serialize)]
pub struct AppStateSnapshot {
    /// Index of the currently active cue (zero-based).
    pub active_cue_index: usize,
    /// Slide state snapshot.
    pub slides: SlideStateSnapshot,
    /// Whether rehearsal mode is active.
    pub rehearsal_mode: bool,
}

/// Simplified slide state for the snapshot.
#[derive(Debug, Serialize)]
pub struct SlideStateSnapshot {
    /// Current slide number (one-based).
    pub current_slide: usize,
    /// Total number of slides.
    pub total_slides: usize,
    /// Whether the slide layer is cleared.
    pub cleared: bool,
}

// ── Server state ────────────────────────────────────────────────────────

/// Shared state between the HTTP handler closures.
pub struct RemoteControlState {
    /// Current 6-digit pairing code (None = no code currently active).
    pairing_code: PairingCode,
    /// Revocable bearer tokens.
    tokens: Tokens,
}

impl RemoteControlState {
    pub fn new() -> Self {
        Self {
            pairing_code: std::sync::Mutex::new(None),
            tokens: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Generate a new 6-digit pairing code and store it.
    pub fn generate_code(&self) -> u32 {
        let code = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
            % 1_000_000) as u32;
        let mut guard = self.pairing_code.lock().unwrap();
        *guard = Some(code);
        code
    }

    /// Get the current pairing code, if any.
    pub fn get_code(&self) -> Option<u32> {
        *self.pairing_code.lock().unwrap()
    }

    /// Set a bearer token (add to the list).
    pub fn set_token(&self, token: String) {
        let mut guard = self.tokens.lock().unwrap();
        if !guard.contains(&token) {
            guard.push(token);
        }
    }

    /// Revoke all bearer tokens.
    pub fn revoke_all_tokens(&self) {
        let mut guard = self.tokens.lock().unwrap();
        guard.clear();
    }

    /// Check whether a bearer token is valid.
    pub fn is_token_valid(&self, token: &str) -> bool {
        let guard = self.tokens.lock().unwrap();
        guard.contains(&token.to_string())
    }
}

// ── HTTP helper: write response directly to TcpStream ───────────────────

/// Write an HTTP/1.1 JSON response with CORS headers to a TcpStream.
async fn write_response(
    stream: &mut TcpStream,
    status: &str,
    body: &str,
) -> Result<(), String> {
    let content_length = body.len();
    let response = format!(
        "HTTP/1.1 {}\r\n\
         Content-Type: application/json\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, Authorization\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n{}",
        status,
        content_length,
        body
    );
    stream.write_all(response.as_bytes()).await.map_err(|e| format!("Write error: {e}"))?;
    Ok(())
}

/// Read an HTTP request line and headers from a TcpStream.
async fn read_request(stream: &mut TcpStream) -> Result<(String, String, String), String> {
    let mut buf = Vec::new();
    // Read until we have a complete request (simplified: read all available)
    let _ = stream.read_to_end(&mut buf).await;
    let text = String::from_utf8_lossy(&buf).to_string();

    // Parse the first line: METHOD /path HTTP/1.1
    let parts: Vec<&str> = text.splitn(3, ' ').collect();
    if parts.len() < 2 {
        return Err("malformed request line".into());
    }
    let method = parts[0].to_string();
    let path = parts[1].to_string();

    // Extract headers from the text (simple scan for Authorization)
    let _auth_header = text.lines().find(|l| l.to_lowercase().starts_with("authorization:"));

    Ok((method, path, text))
}

// ── Endpoint handlers ──────────────────────────────────────────────────

/// Handle a single HTTP connection for the remote control server.
async fn handle_connection(
    mut stream: TcpStream,
    state: Arc<RemoteControlState>,
) -> Result<(), String> {
    let (method, path, headers) = read_request(&mut stream).await?;

    let has_auth_header = headers.contains("Authorization:");

    // ── POST /api/pair ──────────────────────────────────────────────
    if method == "POST" && path == "/api/pair" {
        // The body was already read in read_request; re-parse from the buffered text
        // For simplicity, read the body again from the stream
        let mut body = Vec::new();
        let _ = stream.read_to_end(&mut body).await;

        let pair_req: PairRequest = match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(_) => {
                let _ = write_response(&mut stream, "400", r#"{"error":"invalid JSON"}"#).await;
                return Ok(());
            }
        };

        // Generate (or reuse) a 6-digit pairing code
        let code = state.generate_code();
        let token = format!("Bearer-{}", format!("{:08x}", code % 0x10000000));

        // Store the token so later endpoints can validate it
        state.set_token(token.clone());

        let resp = PairResponse { token };
        let json = serde_json::to_string(&resp).unwrap_or_else(|_| "{}".into());
        let _ = write_response(&mut stream, "200", &json).await;
        return Ok(());
    }

    // ── GET /api/state ──────────────────────────────────────────────
    if method == "GET" && path == "/api/state" {
        // Simple Bearer token validation from the Authorization header
        let provided_token = if has_auth_header {
            headers
                .lines()
                .find(|l| l.to_lowercase().starts_with("authorization:"))
                .map(|l| {
                    l.split_whitespace().nth(1).unwrap_or("")
                        .trim()
                        .to_string()
                })
                .unwrap_or_default()
        } else {
            String::new()
        };

        let valid = !provided_token.is_empty() && state.is_token_valid(&provided_token);

        if !valid {
            let _ = write_response(&mut stream, "401", r#"{"error":"unauthorized"}"#).await;
            return Ok(());
        }

        // Build and send a simplified app state snapshot
        let snapshot = AppStateSnapshot {
            active_cue_index: 0,
            slides: SlideStateSnapshot {
                current_slide: 1,
                total_slides: 10,
                cleared: false,
            },
            rehearsal_mode: false,
        };
        let json = serde_json::to_string(&snapshot).unwrap_or_else(|_| "{}".into());
        let _ = write_response(&mut stream, "200", &json).await;
        return Ok(());
    }

    // ── POST /api/command ───────────────────────────────────────────
    if method == "POST" && path == "/api/command" {
        // Read the JSON body
        let mut body = Vec::new();
        let _ = stream.read_to_end(&mut body).await;

        let cmd_req: CommandReq = match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(_) => {
                let _ = write_response(&mut stream, "400", r#"{"error":"invalid JSON"}"#).await;
                return Ok(());
            }
        };

        // Auth check (same pattern as /api/state)
        let provided_token = if has_auth_header {
            headers
                .lines()
                .find(|l| l.to_lowercase().starts_with("authorization:"))
                .map(|l| {
                    l.split_whitespace().nth(1).unwrap_or("")
                        .trim()
                        .to_string()
                })
                .unwrap_or_default()
        } else {
            String::new()
        };

        let valid = !provided_token.is_empty() && state.is_token_valid(&provided_token);

        if !valid {
            let _ = write_response(&mut stream, "401", r#"{"error":"unauthorized"}"#).await;
            return Ok(());
        }

        // Route the command to the appropriate handler
        match cmd_req.command.as_str() {
            "go_to_slide" => {
                if let Some(slide) = cmd_req.args.as_ref().and_then(|a| a.get("slide_number").and_then(|n| n.as_u64())) {
                    // In a full integration this would dispatch to the cue engine.
                }
            }
            "trigger_slide_action" => {
                // handle slide action
            }
            "start_stream" => {
                // start stream
            }
            "stop_stream" => {
                // stop stream
            }
            "blackout" => {
                // toggle blackout
            }
            "clear_text" => {
                // clear text
            }
            "ai_prompt" => {
                // AI prompt
            }
            _ => {}
        }

        let response = format!(
            r#"{{"command":"{}","args":{}}}"#,
            cmd_req.command,
            cmd_req.args.as_ref().map(|a| serde_json::to_string(a).unwrap_or_default()).unwrap_or_else(|| "null".into())
        );
        let _ = write_response(&mut stream, "200", &response).await;
        return Ok(());
    }

    // ── OPTIONS /api/* ────────────────────────────────────────────────
    // CORS preflight handler — return 204 with appropriate CORS headers.
    if method == "OPTIONS" && path.starts_with("/api/") {
        let _ = write_response(&mut stream, "204", "").await;
        return Ok(());
    }

    // 404 fallback
    let _ = write_response(&mut stream, "404", r#"{"error":"not found"}"#).await;
    Ok(())
}

/// Start the remote control HTTP server on 0.0.0.0:39880.
/// This function blocks and listens for connections indefinitely.
pub async fn start_server(state: Arc<RemoteControlState>) -> Result<(), String> {
    let addr = "0.0.0.0:39880";
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind to {addr}: {e}"))?;

    println!("[remote-control] Listening on {addr}");

    loop {
        let (stream, _) = listener.accept().await
            .map_err(|e| format!("Accept error: {e}"))?;

        let state_clone = Arc::clone(&state);
        tokio::spawn(async move {
            let _ = handle_connection(stream, state_clone).await;
        });
    }
}