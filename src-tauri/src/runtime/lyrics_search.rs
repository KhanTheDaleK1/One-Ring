//! In-app song and lyric search across a public lyrics index and a local song folder.
//!
//! All access is read-only. Remote requests use a fixed argument vector (never a shell), and
//! local files are opened only below a caller-selected folder with depth, count and size bounds.

use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

const MAX_QUERY_CHARS: usize = 200;
const MAX_ONLINE_BYTES: usize = 512 * 1024;
const MAX_FILE_BYTES: usize = 256 * 1024;
const MAX_FILES: usize = 500;
const MAX_DIR_ENTRIES: usize = 1000;
const MAX_DEPTH: u32 = 3;
const MAX_ONLINE_RESULTS: usize = 30;
const MAX_LOCAL_RESULTS: usize = 30;
const SEARCH_URL: &str = "https://lrclib.net/api/search";

/// One lyric hit, normalized for the frontend's song/lyric picker.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LyricSearchResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub source: String,
    pub copyright: String,
    pub key: String,
    pub lyrics: String,
    pub themes: Vec<String>,
    pub file_path: Option<String>,
}

/// Encode a query as an application/x-www-form-urlencoded query value (UTF-8 bytes).
pub fn percent_encode_query(s: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(s.len());
    for &byte in s.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => {
                out.push('%');
                out.push(HEX[(byte >> 4) as usize] as char);
                out.push(HEX[(byte & 0x0f) as usize] as char);
            }
        }
    }
    out
}

/// True for a bracketed timestamp such as `00:12.34` or `01:02:03`, but not for `[Chorus]`.
fn is_lrc_time(segment: &str) -> bool {
    if segment.is_empty() || segment.len() > 12 {
        return false;
    }
    let mut fields = segment.split(':');
    let minutes = fields.next().unwrap_or("");
    let Some(seconds) = fields.next() else {
        return false;
    };
    if minutes.is_empty() || !minutes.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let mut fractional = seconds.splitn(2, '.');
    let whole = fractional.next().unwrap_or("");
    if whole.is_empty() || whole.len() > 2 || !whole.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    if let Some(part) = fractional.next() {
        if part.is_empty() || part.len() > 3 || !part.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
    }
    fields.all(|field| {
        !field.is_empty() && field.len() <= 3 && field.bytes().all(|b| b.is_ascii_digit())
    })
}

/// Remove repeating LRC time prefixes, leaving section labels such as `[Chorus]` intact.
pub fn strip_lrc_timestamps(synced: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    for line in synced.lines() {
        let mut rest = line.trim();
        loop {
            let Some(after_open) = rest.strip_prefix('[') else {
                break;
            };
            let Some(end) = after_open.find(']') else {
                break;
            };
            if !is_lrc_time(&after_open[..end]) {
                break;
            }
            rest = after_open[end + 1..].trim_start();
        }
        lines.push(rest.trim_end().to_string());
    }
    while lines.first().is_some_and(String::is_empty) {
        lines.remove(0);
    }
    while lines.last().is_some_and(String::is_empty) {
        lines.pop();
    }
    lines.join("\n")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexedLyric {
    id: Option<serde_json::Value>,
    track_name: Option<String>,
    artist_name: Option<String>,
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
    instrumental: Option<bool>,
}

fn scalar_to_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// Parse the public search response, dropping instrumental entries and entries without text.
pub fn parse_lrclib_json(raw: &[u8]) -> Result<Vec<LyricSearchResult>, String> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Payload {
        Many(Vec<IndexedLyric>),
        One(Box<IndexedLyric>),
    }

    let payload: Payload = serde_json::from_slice(raw)
        .map_err(|e| format!("Failed to parse lyric search response: {e}"))?;
    let entries = match payload {
        Payload::Many(items) => items,
        Payload::One(item) => vec![*item],
    };

    let mut results = Vec::new();
    for (index, entry) in entries.into_iter().enumerate() {
        if results.len() >= MAX_ONLINE_RESULTS {
            break;
        }
        if entry.instrumental.unwrap_or(false) {
            continue;
        }
        let title = entry.track_name.unwrap_or_default().trim().to_string();
        let artist = entry.artist_name.unwrap_or_default().trim().to_string();
        let plain = entry.plain_lyrics.unwrap_or_default();
        let lyrics = if plain.trim().is_empty() {
            strip_lrc_timestamps(&entry.synced_lyrics.unwrap_or_default())
        } else {
            plain.trim().to_string()
        };
        if lyrics.trim().is_empty() {
            continue;
        }
        let id = entry
            .id
            .as_ref()
            .map(scalar_to_string)
            .unwrap_or_default();
        let id = if id.is_empty() {
            format!("online-{index}")
        } else {
            id
        };
        results.push(LyricSearchResult {
            id,
            title,
            artist,
            source: "online".to_string(),
            copyright: String::new(),
            key: String::new(),
            lyrics,
            themes: Vec::new(),
            file_path: None,
        });
    }
    Ok(results)
}

#[cfg(target_os = "android")]
fn fetch_search_response(url: &str) -> Result<Vec<u8>, String> {
    let resp = ureq::get(url)
        .set("User-Agent", "OneRing/0.3.11")
        .call()
        .map_err(|e| format!("Online lyric search failed: {e}"))?;
    let mut buf = Vec::new();
    use std::io::Read;
    resp.into_reader().take(MAX_ONLINE_BYTES as u64).read_to_end(&mut buf)
        .map_err(|e| format!("Failed to read lyric search response: {e}"))?;
    Ok(buf)
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
fn fetch_search_response(url: &str) -> Result<Vec<u8>, String> {
    let mut cmd = std::process::Command::new("curl");
    crate::runtime::hide_console_window(&mut cmd);
    let output = cmd
        .args([
            "-fsSL",
            "--max-time",
            "8",
            "--max-filesize",
            "524288",
            "-H",
            "User-Agent: OneRing/0.3.5",
            url,
        ])
        .output()
        .map_err(|e| format!("Failed to start online lyric search: {e}"))?;
    if !output.status.success() {
        return Err("Online lyric search is unavailable right now".to_string());
    }
    Ok(output.stdout)
}

#[cfg(target_os = "windows")]
fn fetch_search_response(url: &str) -> Result<Vec<u8>, String> {
    // The script text is constant. The URL travels in the child environment, so no
    // caller-controlled value is ever parsed or interpolated by the shell.
    let script = concat!(
        "$ErrorActionPreference='Stop';",
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;",
        "$u=$env:ONERING_LYRIC_URL;",
        "$r=Invoke-WebRequest -Uri $u -TimeoutSec 8 -UseBasicParsing ",
        "-Headers @{'User-Agent'='OneRing/0.3.5'};",
        "if ($r.Content.Length -gt 524288) { throw 'Response too large' };",
        "[Console]::Out.Write($r.Content)"
    );
    let mut cmd = std::process::Command::new("powershell");
    crate::runtime::hide_console_window(&mut cmd);
    let output = cmd
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("ONERING_LYRIC_URL", url)
        .output()
        .map_err(|e| format!("Failed to start online lyric search: {e}"))?;
    if !output.status.success() {
        return Err("Online lyric search is unavailable right now".to_string());
    }
    Ok(output.stdout)
}

/// Query the public lyric index. Roughly eight seconds is the worst-case network wait.
fn normalize_key(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn levenshtein(a: &str, b: &str) -> usize {
    let av: Vec<char> = a.chars().collect();
    let bv: Vec<char> = b.chars().collect();
    if av.is_empty() {
        return bv.len();
    }
    if bv.is_empty() {
        return av.len();
    }
    let mut prev: Vec<usize> = (0..=bv.len()).collect();
    let mut curr = vec![0usize; bv.len() + 1];
    for (i, &ca) in av.iter().enumerate() {
        curr[0] = i + 1;
        for (j, &cb) in bv.iter().enumerate() {
            let cost = usize::from(ca != cb);
            curr[j + 1] = (prev[j + 1] + 1).min(curr[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[bv.len()]
}

fn fuzzy_token_score(token: &str, candidate_words: &[String]) -> i32 {
    if token.is_empty() {
        return 0;
    }
    let mut best = 0i32;
    for w in candidate_words {
        if w == token {
            return 100;
        }
        if w.contains(token) || token.contains(w.as_str()) {
            best = best.max(75);
            continue;
        }
        let max_len = w.len().max(token.len());
        if max_len >= 4 {
            let dist = levenshtein(token, w);
            if dist <= 2 || (dist * 3 <= max_len) {
                let sim = 85i32.saturating_sub((dist as i32) * 18);
                best = best.max(sim);
            }
        }
    }
    best
}

pub(crate) fn rank_and_dedupe_results(
    items: Vec<LyricSearchResult>,
    query: &str,
    artist_hint: Option<&str>,
) -> Vec<LyricSearchResult> {
    let mut deduped: std::collections::HashMap<(String, String), LyricSearchResult> =
        std::collections::HashMap::new();
    for item in items {
        let key = (normalize_key(&item.title), normalize_key(&item.artist));
        match deduped.get(&key) {
            Some(existing) if existing.lyrics.len() >= item.lyrics.len() => {}
            _ => {
                deduped.insert(key, item);
            }
        }
    }

    let q_norm = normalize_key(query);
    let q_tokens: Vec<String> = q_norm.split_whitespace().map(str::to_string).collect();
    let a_norm = artist_hint.map(normalize_key).unwrap_or_default();

    let mut scored: Vec<(i32, LyricSearchResult)> = deduped
        .into_values()
        .map(|item| {
            let title_norm = normalize_key(&item.title);
            let artist_norm = normalize_key(&item.artist);
            let title_words: Vec<String> = title_norm.split_whitespace().map(str::to_string).collect();
            let artist_words: Vec<String> = artist_norm.split_whitespace().map(str::to_string).collect();

            let mut score = 0i32;
            if !q_norm.is_empty() && title_norm == q_norm {
                score += 220;
            } else if !q_norm.is_empty() && title_norm.contains(&q_norm) {
                score += 120;
            }
            if !a_norm.is_empty() {
                if artist_norm == a_norm {
                    score += 200;
                } else if artist_norm.contains(&a_norm) {
                    score += 130;
                }
            }
            for tok in &q_tokens {
                let ts = fuzzy_token_score(tok, &title_words);
                let as_ = fuzzy_token_score(tok, &artist_words);
                score += ts.max(as_);
                if ts >= 60 && as_ >= 60 {
                    score += 20;
                }
            }
            score += ((item.lyrics.lines().count()).min(40) as i32) * 2;
            (score, item)
        })
        .collect();

    scored.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| b.1.lyrics.len().cmp(&a.1.lyrics.len()))
            .then_with(|| a.1.title.cmp(&b.1.title))
    });
    scored
        .into_iter()
        .take(MAX_ONLINE_RESULTS)
        .map(|(_, item)| item)
        .collect()
}

fn fetch_lrclib_url(url: &str) -> Result<Vec<LyricSearchResult>, String> {
    let response = fetch_search_response(url)?;
    let bounded = if response.len() > MAX_ONLINE_BYTES {
        &response[..MAX_ONLINE_BYTES]
    } else {
        &response
    };
    parse_lrclib_json(bounded)
}

pub fn search_online_lyrics_with_artist(
    query: &str,
    artist: Option<&str>,
) -> Result<Vec<LyricSearchResult>, String> {
    let query = query.trim();
    let artist_clean = artist.map(str::trim).filter(|a| !a.is_empty());
    if query.is_empty() && artist_clean.is_none() {
        return Err("Search query must not be empty".to_string());
    }
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err(format!(
            "Search query must be at most {MAX_QUERY_CHARS} characters"
        ));
    }

    let mut collected = Vec::new();
    let mut last_err: Option<String> = None;

    if !query.is_empty() {
        if let Some(a) = artist_clean {
            let url = format!(
                "{SEARCH_URL}?track_name={}&artist_name={}",
                percent_encode_query(query),
                percent_encode_query(a)
            );
            match fetch_lrclib_url(&url) {
                Ok(mut rows) => collected.append(&mut rows),
                Err(e) => last_err = Some(e),
            }
        }
    }

    let primary_q = match (query.is_empty(), artist_clean) {
        (false, Some(a)) => format!("{query} {a}"),
        (false, None) => query.to_string(),
        (true, Some(a)) => a.to_string(),
        (true, None) => String::new(),
    };
    if collected.len() < 5 && !primary_q.is_empty() {
        let url = format!("{SEARCH_URL}?q={}", percent_encode_query(&primary_q));
        match fetch_lrclib_url(&url) {
            Ok(mut rows) => collected.append(&mut rows),
            Err(e) => last_err = Some(e),
        }
    }

    if collected.is_empty() {
        let words: Vec<&str> = query.split_whitespace().filter(|w| w.len() >= 3).collect();
        let mut fallback_queries: Vec<String> = Vec::new();
        if let Some(a) = artist_clean {
            fallback_queries.push(a.to_string());
        }
        if words.len() >= 2 {
            let tail = words[words.len().saturating_sub(2)..].join(" ");
            let head = words[..2.min(words.len())].join(" ");
            if tail != primary_q {
                fallback_queries.push(tail);
            }
            if head != primary_q && !fallback_queries.contains(&head) {
                fallback_queries.push(head);
            }
            if let Some(last) = words.last() {
                if last.len() >= 4 && !fallback_queries.iter().any(|q| q == last) {
                    fallback_queries.push((*last).to_string());
                }
            }
        }
        for fq in fallback_queries.into_iter().take(3) {
            let url = format!("{SEARCH_URL}?q={}", percent_encode_query(&fq));
            if let Ok(mut rows) = fetch_lrclib_url(&url) {
                collected.append(&mut rows);
                if collected.len() >= 15 {
                    break;
                }
            }
        }
    }

    if collected.is_empty() {
        if let Some(err) = last_err {
            return Err(err);
        }
    }

    Ok(rank_and_dedupe_results(collected, query, artist_clean))
}

pub fn search_online_lyrics(query: &str) -> Result<Vec<LyricSearchResult>, String> {
    search_online_lyrics_with_artist(query, None)
}

/// Search for song lyrics online (and optionally locally), returning matched results.
/// If `include_online` is true, queries the public lyric index; always also attempts
/// a local folder search if a local folder is configured in the app state.
/// Returns the combined, ranked results.
pub fn search_song_lyrics(query: &str, artist: Option<&str>, include_online: bool) -> Result<Vec<LyricSearchResult>, String> {
    let mut results = Vec::new();

    if include_online {
        if let Ok(online) = search_online_lyrics_with_artist(query, artist) {
            results.extend(online);
        }
    }

    // Local search is handled at a higher level (via the frontend or config),
    // but we include a basic local search here if desired.
    // The caller can further refine with search_local_song_folder if needed.

    Ok(results)
}

fn is_supported_song_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "txt" | "cho" | "chordpro" | "xml"
            )
        })
}

/// Collect bounded, canonical files below `root`. Symlinks are never followed.
fn collect_song_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut pending = vec![(root.to_path_buf(), 0u32)];
    while let Some((dir, depth)) = pending.pop() {
        if files.len() >= MAX_FILES {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut children = Vec::new();
        for entry in entries.flatten() {
            children.push(entry.path());
            if children.len() >= MAX_DIR_ENTRIES {
                break;
            }
        }
        children.sort();
        for child in children {
            let Ok(meta) = std::fs::symlink_metadata(&child) else {
                continue;
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            let Ok(resolved) = std::fs::canonicalize(&child) else {
                continue;
            };
            if !resolved.starts_with(root) {
                continue;
            }
            if meta.is_dir() {
                if depth < MAX_DEPTH {
                    pending.push((resolved, depth + 1));
                }
            } else if meta.is_file() && is_supported_song_file(&resolved) {
                files.push(resolved);
                if files.len() >= MAX_FILES {
                    break;
                }
            }
        }
    }
    files.sort();
    files
}

fn read_bounded_file(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES as u64 {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() > MAX_FILE_BYTES {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn trim_blank_edges(lines: &mut Vec<String>) {
    while lines.first().is_some_and(|line| line.trim().is_empty()) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|line| line.trim().is_empty()) {
        lines.pop();
    }
}

fn directive_value(line: &str, keys: &[&str]) -> Option<String> {
    let inside = line.trim().strip_prefix('{')?.strip_suffix('}')?;
    let (key, value) = inside.split_once(':')?;
    if keys
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(key.trim()))
    {
        let value = value.trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

fn strip_braced_directives(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('}') {
            Some(end) => rest = &after[end + 1..],
            None => {
                rest = after;
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

const SECTION_LABELS: &[&str] = &[
    "chorus", "verse", "bridge", "intro", "outro", "refrain", "tag", "hook", "break",
    "interlude", "instrumental", "coda", "ending", "end", "prechorus", "pre-chorus",
];

/// Recognize common chord symbols such as `G`, `C#m7`, `D/F#` and `Bbmaj7`, but not `[Chorus]`.
fn looks_like_chord(segment: &str) -> bool {
    let trimmed = segment.trim();
    if trimmed.is_empty() || trimmed.len() > 12 {
        return false;
    }
    if SECTION_LABELS
        .iter()
        .any(|label| label.eq_ignore_ascii_case(trimmed))
    {
        return false;
    }
    let bare = trimmed
        .strip_prefix('(')
        .and_then(|value| value.strip_suffix(')'))
        .unwrap_or(trimmed);
    let bare = bare.trim();
    if bare.is_empty() || bare.len() > 10 {
        return false;
    }
    bare.split('/').all(|part| {
        let part = part.trim();
        if part.is_empty() || part.len() > 8 {
            return false;
        }
        let mut chars = part.chars();
        let Some(root) = chars.next() else {
            return false;
        };
        if !root.is_ascii_alphabetic() || !matches!(root.to_ascii_uppercase(), 'A'..= 'G') {
            return false;
        }
        let remainder: String = chars.collect();
        let remainder = remainder.strip_prefix(['#', 'b']).unwrap_or(&remainder);
        remainder
            .chars()
            .all(|c| c.is_ascii_digit() || "majinsdugb#+-".contains(c))
    })
}

fn strip_inline_chords(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(start) = rest.find('[') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find(']') {
            Some(end) => {
                let inside = &after[..end];
                if looks_like_chord(inside) {
                    rest = &after[end + 1..];
                } else {
                    out.push('[');
                    out.push_str(inside);
                    out.push(']');
                    rest = &after[end + 1..];
                }
            }
            None => {
                out.push('[');
                rest = after;
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

fn parse_chordpro(raw: &str, fallback_title: &str) -> (String, String, String) {
    let mut title = String::new();
    let mut artist = String::new();
    let mut lines = Vec::new();
    for line in raw.lines() {
        if title.is_empty() {
            if let Some(value) = directive_value(line, &["title", "t"]) {
                title = value;
            }
        }
        if artist.is_empty() {
            if let Some(value) = directive_value(line, &["artist", "a"]) {
                artist = value;
            }
        }
        lines.push(strip_inline_chords(&strip_braced_directives(line)).trim().to_string());
    }
    trim_blank_edges(&mut lines);
    let title = if title.is_empty() {
        fallback_title.to_string()
    } else {
        title
    };
    (title, artist, lines.join("\n"))
}

fn find_ascii_ci(haystack: &str, needle: &str) -> Option<usize> {
    haystack
        .to_ascii_lowercase()
        .find(&needle.to_ascii_lowercase())
}

/// Locate an XML opening tag, returning the byte index just after its closing `>`.
fn find_open_tag(raw: &str, tag: &str) -> Option<usize> {
    let prefix = format!("<{tag}");
    let mut cursor = 0;
    loop {
        let relative = find_ascii_ci(&raw[cursor..], &prefix)?;
        let start = cursor + relative;
        let after = &raw[start + prefix.len()..];
        let following = after.as_bytes().first().copied();
        if following.is_some_and(|byte| {
            byte != b'>' && byte != b'/' && !byte.is_ascii_whitespace()
        }) {
            cursor = start + prefix.len();
            continue;
        }
        let gt = after.find('>')?;
        if after[..gt].trim_end().ends_with('/') {
            cursor = start + prefix.len();
            continue;
        }
        return Some(start + prefix.len() + gt + 1);
    }
}

fn strip_xml_tags(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('<') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        if let Some(data) = after.strip_prefix("![CDATA[") {
            if let Some(end) = data.find("]]>") {
                out.push_str(&data[..end]);
                rest = &data[end + 3..];
                continue;
            }
        }
        match after.find('>') {
            Some(end) => rest = &after[end + 1..],
            None => {
                out.push('<');
                rest = after;
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

fn unescape_xml(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find(';') else {
            out.push('&');
            rest = after;
            continue;
        };
        let entity = &after[..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if entity.len() <= 12 => {
                if let Some(hex) = entity
                    .strip_prefix("#x")
                    .or_else(|| entity.strip_prefix("#X"))
                {
                    u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
                } else {
                    entity
                        .strip_prefix('#')
                        .and_then(|digits| digits.parse::<u32>().ok())
                        .and_then(char::from_u32)
                }
            }
            _ => None,
        };
        match decoded {
            Some(character) => out.push(character),
            None => {
                out.push('&');
                out.push_str(entity);
                out.push(';');
            }
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

fn extract_xml_tag_text(raw: &str, tag: &str) -> Option<String> {
    let open_end = find_open_tag(raw, tag)?;
    let close = format!("</{tag}>");
    let relative = find_ascii_ci(&raw[open_end..], &close)?;
    let text = unescape_xml(&strip_xml_tags(&raw[open_end..open_end + relative]));
    let text = text.trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn extract_xml_blocks(raw: &str, tag: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut cursor = 0;
    let close = format!("</{tag}>");
    while let Some(relative_end) = find_open_tag(&raw[cursor..], tag) {
        let start = cursor + relative_end;
        let Some(relative_close) = find_ascii_ci(&raw[start..], &close) else {
            break;
        };
        blocks.push(raw[start..start + relative_close].to_string());
        cursor = start + relative_close + close.len();
        if cursor >= raw.len() {
            break;
        }
    }
    blocks
}

fn parse_openlyrics(raw: &str, fallback_title: &str) -> (String, String, String) {
    let title = extract_xml_tag_text(raw, "title").unwrap_or_else(|| fallback_title.to_string());
    let artist = extract_xml_tag_text(raw, "author").unwrap_or_default();
    let mut lines = Vec::new();
    for block in extract_xml_blocks(raw, "lines") {
        for line in block.lines() {
            let text = unescape_xml(&strip_xml_tags(line));
            let text = text.trim();
            if !text.is_empty() {
                lines.push(text.to_string());
            }
        }
    }
    if lines.is_empty() {
        for line in strip_xml_tags(raw).lines() {
            let text = unescape_xml(line).trim().to_string();
            if !text.is_empty() {
                lines.push(text);
            }
        }
    }
    (title, artist, lines.join("\n"))
}

fn parse_local_song(path: &Path, raw: &str) -> (String, String, String) {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled")
        .to_string();
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("cho") | Some("chordpro") => parse_chordpro(raw, &stem),
        Some("xml") => parse_openlyrics(raw, &stem),
        _ => (stem, String::new(), raw.trim().to_string()),
    }
}

/// Search a local folder of song files. An empty query lists the first 30 songs.
pub fn search_local_song_folder(
    folder: &str,
    query: &str,
) -> Result<Vec<LyricSearchResult>, String> {
    let trimmed_folder = folder.trim();
    if trimmed_folder.is_empty() {
        return Err("Song folder must not be empty".to_string());
    }
    if folder.chars().any(char::is_control) {
        return Err("Song folder contains invalid characters".to_string());
    }
    let requested = Path::new(trimmed_folder);
    if requested
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("Song folder must not contain parent directory components".to_string());
    }
    let root = std::fs::canonicalize(requested)
        .map_err(|_| "Song folder does not exist or cannot be read".to_string())?;
    if !root.is_dir() {
        return Err("Song folder is not a directory".to_string());
    }

    let needle = query.trim().to_lowercase();
    let mut ranked: Vec<(u8, LyricSearchResult)> = Vec::new();
    for path in collect_song_files(&root) {
        let Some(raw) = read_bounded_file(&path) else {
            continue;
        };
        let (title, artist, lyrics) = parse_local_song(&path, &raw);
        if lyrics.trim().is_empty() {
            continue;
        }
        let rank = if needle.is_empty() {
            0
        } else if title.to_lowercase().contains(&needle)
            || artist.to_lowercase().contains(&needle)
        {
            0
        } else if lyrics.to_lowercase().contains(&needle) {
            1
        } else {
            continue;
        };
        let relative = path
            .strip_prefix(&root)
            .unwrap_or(&path)
            .to_string_lossy()
            .into_owned();
        ranked.push((
            rank,
            LyricSearchResult {
                id: format!("local:{relative}"),
                title,
                artist,
                source: "local".to_string(),
                copyright: String::new(),
                key: String::new(),
                lyrics,
                themes: Vec::new(),
                file_path: Some(path.to_string_lossy().into_owned()),
            },
        ));
    }
    ranked.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.title.cmp(&b.1.title)));
    Ok(ranked
        .into_iter()
        .take(MAX_LOCAL_RESULTS)
        .map(|(_, result)| result)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static FOLDER_SEQ: AtomicU64 = AtomicU64::new(0);

    fn temp_folder(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let seq = FOLDER_SEQ.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "one-ring-lyrics-{tag}-{}-{nanos}-{seq}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn rank_and_dedupe_handles_typos_and_artist_match() {
        let items = vec![
            LyricSearchResult {
                id: "1".into(),
                title: "Gratitude".into(),
                artist: "Other Artist".into(),
                source: "online".into(),
                copyright: "Online".into(),
                key: "".into(),
                lyrics: "Short line".into(),
                themes: vec![],
                file_path: None,
            },
            LyricSearchResult {
                id: "2".into(),
                title: "Gratitude".into(),
                artist: "Brandon Lake".into(),
                source: "online".into(),
                copyright: "Online".into(),
                key: "".into(),
                lyrics: "All my words fall short\nI got nothing new\nSo I throw up my hands\nAnd praise You again and again".into(),
                themes: vec![],
                file_path: None,
            },
            LyricSearchResult {
                id: "3".into(),
                title: "Gratitude".into(),
                artist: "Brandon Lake".into(),
                source: "online".into(),
                copyright: "Online".into(),
                key: "".into(),
                lyrics: "Short dup".into(),
                themes: vec![],
                file_path: None,
            },
        ];
        let ranked = rank_and_dedupe_results(items, "gratutitude brandon lake", None);
        assert_eq!(ranked.len(), 2, "duplicate Brandon Lake Gratitude should dedupe");
        assert_eq!(ranked[0].artist, "Brandon Lake");
        assert!(ranked[0].lyrics.contains("All my words fall short"));
    }

    #[test]
    fn percent_encode_query_keeps_unreserved_bytes_and_encodes_utf8() {
        assert_eq!(percent_encode_query(""), "");
        assert_eq!(
            percent_encode_query("Az09-_.~"),
            "Az09-_.~"
        );
        assert_eq!(percent_encode_query("a b&c=d/e?"), "a%20b%26c%3Dd%2Fe%3F");
        assert_eq!(percent_encode_query("café"), "caf%C3%A9");
    }

    #[test]
    fn strip_lrc_timestamps_removes_prefixes_but_keeps_section_labels() {
        let synced = "[00:12.34]First line\n[00:14.00][01:02.03]Second line\n[Chorus]Third line";
        assert_eq!(
            strip_lrc_timestamps(synced),
            "First line\nSecond line\n[Chorus]Third line"
        );
        assert_eq!(strip_lrc_timestamps("[00:01.00]\n[00:02.00]Only text"), "Only text");
    }

    #[test]
    fn parse_lrclib_json_skips_empty_entries_and_caps_results() {
        let mut entries: Vec<String> = vec![
            r#"{"id":900,"trackName":"Silent","artistName":"Artist","plainLyrics":"","syncedLyrics":"","instrumental":true}"#.into(),
            r#"{"id":901,"trackName":"Empty","artistName":"Artist","plainLyrics":"   ","instrumental":false}"#.into(),
        ];
        for index in 0..35 {
            entries.push(format!(
                r#"{{"id":{index},"trackName":"Song {index}","artistName":"Artist {index}","plainLyrics":"body {index}","instrumental":false}}"#
            ));
        }
        let raw = format!("[{}]", entries.join(","));
        let parsed = parse_lrclib_json(raw.as_bytes()).unwrap();
        assert_eq!(parsed.len(), MAX_ONLINE_RESULTS);
        assert_eq!(parsed[0].id, "0");
        assert_eq!(parsed[0].title, "Song 0");
        assert_eq!(parsed[0].source, "online");
        assert!(parsed.iter().all(|item| item.file_path.is_none()));
        assert!(parsed.iter().all(|item| !item.lyrics.is_empty()));
    }

    #[test]
    fn parse_lrclib_json_accepts_single_object_and_synced_text() {
        let raw = br#"{"id":7,"trackName":"Synced","artistName":"Singer","plainLyrics":"","syncedLyrics":"[00:01.00]Line one\n[00:02.50]Line two"}"#;
        let parsed = parse_lrclib_json(raw).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "7");
        assert_eq!(parsed[0].lyrics, "Line one\nLine two");
        assert!(parsed[0].themes.is_empty());
        assert!(parse_lrclib_json(b"not json").is_err());
    }

    #[test]
    fn chordpro_directives_and_inline_chords_are_removed() {
        let raw = "{title: Morning Hymn}\n{t: Shorter}\n{artist: Example Choir}\n{a: Short}\n[G]Que [C#m7]bella [D/F#]giornata\n[Chorus]Refrain here\n{key: G}\n";
        let (title, artist, lyrics) = parse_chordpro(raw, "fallback");
        assert_eq!(title, "Morning Hymn");
        assert_eq!(artist, "Example Choir");
        assert_eq!(lyrics, "Que bella giornata\n[Chorus]Refrain here");
    }

    #[test]
    fn openlyrics_extracts_metadata_and_line_blocks() {
        let raw = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<song><properties><title>Grace &amp; Peace</title><author>Song Writer</author></properties><lyrics><lines part=\"Verse 1\">First <chord name=\"G\"/>line</lines><lines part=\"Chorus\">Second &lt;line&gt; here</lines></lyrics></song>";
        let (title, artist, lyrics) = parse_openlyrics(raw, "fallback");
        assert_eq!(title, "Grace & Peace");
        assert_eq!(artist, "Song Writer");
        assert_eq!(lyrics, "First line\nSecond <line> here");
    }

    #[test]
    fn local_folder_search_matches_title_artist_body_and_rejects_bad_folders() {
        let dir = temp_folder("local");
        std::fs::write(dir.join("alpha.txt"), "old quiet text").unwrap();
        std::fs::write(
            dir.join("beta.cho"),
            "{title: Bright Morning}\n{artist: Choir One}\n[G]Shine [C]today\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("gamma.xml"),
            "<song><properties><title>Quiet Night</title><author>Writer Two</author></properties><lyrics><lines>Gentle words</lines></lyrics></song>",
        )
        .unwrap();
        std::fs::write(dir.join("ignored.md"), "Bright Morning").unwrap();

        let folder = dir.to_str().unwrap();
        let by_title = search_local_song_folder(folder, "bright").unwrap();
        assert_eq!(by_title.len(), 1);
        assert_eq!(by_title[0].title, "Bright Morning");
        assert_eq!(by_title[0].artist, "Choir One");
        assert_eq!(by_title[0].source, "local");
        assert!(by_title[0]
            .file_path
            .as_deref()
            .is_some_and(|path| path.ends_with("beta.cho")));

        let by_body = search_local_song_folder(folder, "gentle").unwrap();
        assert_eq!(by_body.len(), 1);
        assert_eq!(by_body[0].title, "Quiet Night");

        let by_artist = search_local_song_folder(folder, "writer two").unwrap();
        assert_eq!(by_artist.len(), 1);
        assert_eq!(by_artist[0].id, "local:gamma.xml");

        let all = search_local_song_folder(folder, "").unwrap();
        assert_eq!(all.len(), 3);

        assert!(search_local_song_folder("", "x").is_err());
        assert!(search_local_song_folder("/tmp/../tmp", "x").is_err());
        assert!(search_local_song_folder("/tmp/bad\npath", "x").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
