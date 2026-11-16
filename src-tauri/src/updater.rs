use serde::{Deserialize, Serialize};

pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const GITHUB_REPO: &str = "KhanTheDaleK1/One-Ring";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub release_name: String,
    pub release_notes: String,
    pub published_at: String,
    pub html_url: String,
    pub download_url: Option<String>,
    pub update_available: bool,
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    html_url: String,
    assets: Vec<GitHubAsset>,
}

fn parse_semver_tuple(v: &str) -> (u32, u32, u32) {
    let clean = v.trim().trim_start_matches('v');
    let main_part = clean.split('-').next().unwrap_or("0.0.0");
    let parts: Vec<u32> = main_part
        .split('.')
        .map(|s| s.parse::<u32>().unwrap_or(0))
        .collect();
    (
        parts.get(0).copied().unwrap_or(0),
        parts.get(1).copied().unwrap_or(0),
        parts.get(2).copied().unwrap_or(0),
    )
}

fn is_newer(remote_tag: &str, current: &str) -> bool {
    let remote_tuple = parse_semver_tuple(remote_tag);
    let current_tuple = parse_semver_tuple(current);
    if remote_tuple > current_tuple {
        return true;
    }
    if remote_tuple == current_tuple {
        let r_clean = remote_tag.trim().trim_start_matches('v');
        let c_clean = current.trim().trim_start_matches('v');
        return r_clean != c_clean;
    }
    false
}

pub fn check_for_updates() -> Result<Option<UpdateInfo>, String> {
    let url = format!("https://api.github.com/repos/{}/releases", GITHUB_REPO);

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("powershell");
        let script = format!(
            "Invoke-RestMethod -Uri '{}' -Headers @{{'User-Agent'='One-Ring-App'}} | ConvertTo-Json -Depth 5",
            url
        );
        c.args(&["-NoProfile", "-Command", &script]);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = std::process::Command::new("curl");
        c.arg("-s")
            .arg("-H")
            .arg("User-Agent: One-Ring-Production-Suite")
            .arg(&url);
        c
    };

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute update check: {e}"))?;

    if !output.status.success() {
        return Err("Update check returned non-zero exit code".to_string());
    }

    let releases: Vec<GitHubRelease> = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse GitHub release response: {e}"))?;

    let latest = match releases.into_iter().next() {
        Some(r) => r,
        None => return Ok(None),
    };

    let latest_tag = latest.tag_name;
    let update_available = is_newer(&latest_tag, CURRENT_VERSION);

    let target_extension = if cfg!(target_os = "windows") {
        ".msi"
    } else if cfg!(target_os = "macos") {
        ".dmg"
    } else {
        ".deb"
    };

    let matched_asset = latest
        .assets
        .iter()
        .find(|a| a.name.ends_with(target_extension))
        .or_else(|| latest.assets.first());

    let download_url = matched_asset.map(|a| a.browser_download_url.clone());

    let assets: Vec<ReleaseAsset> = latest
        .assets
        .into_iter()
        .map(|a| ReleaseAsset {
            name: a.name,
            browser_download_url: a.browser_download_url,
            size: a.size,
        })
        .collect();

    Ok(Some(UpdateInfo {
        current_version: CURRENT_VERSION.to_string(),
        latest_version: latest_tag,
        release_name: latest.name.unwrap_or_else(|| "One Ring Update".to_string()),
        release_notes: latest.body.unwrap_or_default(),
        published_at: latest.published_at.unwrap_or_default(),
        html_url: latest.html_url,
        download_url,
        update_available,
        assets,
    }))
}
