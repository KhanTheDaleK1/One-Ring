use serde::{Deserialize, Deserializer, Serialize};

pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Optional release repository, supplied at build time via `ONE_RING_UPDATE_REPO`.
/// When unset, update checks are disabled and return `Ok(None)`.
pub const GITHUB_REPO: Option<&str> = option_env!("ONE_RING_UPDATE_REPO");

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
    #[serde(default, deserialize_with = "deserialize_one_or_many")]
    assets: Vec<GitHubAsset>,
}

/// PowerShell's `ConvertTo-Json` unwraps 1-element arrays into bare objects; accept either.
fn deserialize_one_or_many<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany<T> {
        Many(Vec<T>),
        One(T),
        Null,
    }
    match Option::<OneOrMany<T>>::deserialize(deserializer)? {
        Some(OneOrMany::Many(v)) => Ok(v),
        Some(OneOrMany::One(v)) => Ok(vec![v]),
        Some(OneOrMany::Null) | None => Ok(Vec::new()),
    }
}

fn parse_releases_json(bytes: &[u8]) -> Result<Vec<GitHubRelease>, String> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum ReleasesPayload {
        Many(Vec<GitHubRelease>),
        One(Box<GitHubRelease>),
    }
    match serde_json::from_slice::<ReleasesPayload>(bytes) {
        Ok(ReleasesPayload::Many(v)) => Ok(v),
        Ok(ReleasesPayload::One(r)) => Ok(vec![*r]),
        Err(e) => Err(format!("Failed to parse GitHub release response: {e}")),
    }
}

/// Returns `((major, minor, patch), is_stable, prerelease_tag)` so `0.3.2` > `0.3.2-alpha`.
fn parse_semver(v: &str) -> ((u32, u32, u32), bool, String) {
    let clean = v.trim().trim_start_matches('v').trim_start_matches('V');
    let (main_part, pre) = match clean.split_once('-') {
        Some((m, p)) => (m, Some(p.to_ascii_lowercase())),
        None => (clean, None),
    };
    let parts: Vec<u32> = main_part
        .split('.')
        .map(|s| s.parse::<u32>().unwrap_or(0))
        .collect();
    let core = (
        parts.first().copied().unwrap_or(0),
        parts.get(1).copied().unwrap_or(0),
        parts.get(2).copied().unwrap_or(0),
    );
    match pre {
        None => (core, true, String::new()),
        Some(tag) => (core, false, tag),
    }
}

fn is_newer(remote_tag: &str, current: &str) -> bool {
    parse_semver(remote_tag) > parse_semver(current)
}

pub fn check_for_updates() -> Result<Option<UpdateInfo>, String> {
    let Some(repo) = GITHUB_REPO else {
        return Ok(None);
    };
    let url = format!("https://api.github.com/repos/{repo}/releases");

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("powershell");
        let script = format!(
            "ConvertTo-Json -InputObject @(Invoke-RestMethod -TimeoutSec 10 -Uri '{}' -Headers @{{'User-Agent'='One-Ring-App'}}) -Depth 5",
            url
        );
        c.args(["-NoProfile", "-Command", &script]);
        crate::runtime::hide_console_window(&mut c);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = std::process::Command::new("curl");
        c.args([
            "-sL",
            "--max-time",
            "10",
            "-H",
            "User-Agent: One-Ring-Production-Suite",
            &url,
        ]);
        crate::runtime::hide_console_window(&mut c);
        c
    };

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute update check: {e}"))?;

    if !output.status.success() {
        return Err("Update check returned non-zero exit code".to_string());
    }

    let releases = parse_releases_json(&output.stdout)?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_handles_prereleases_properly() {
        assert!(is_newer("v0.3.2", "0.3.2-alpha"));
        assert!(is_newer("v0.3.2-beta", "0.3.2-alpha"));
        assert!(!is_newer("v0.3.2-alpha", "0.3.2"));
        assert!(is_newer("v0.3.3-alpha", "0.3.2"));
        assert!(!is_newer("v0.3.2", "0.3.2"));
    }

    #[test]
    fn parses_single_release_object_and_single_asset_object() {
        let ps_json = br#"{"tag_name":"v0.4.0","html_url":"https://example.com","assets":{"name":"OneRing.msi","browser_download_url":"https://example.com/a.msi","size":42}}"#;
        let releases = parse_releases_json(ps_json).unwrap();
        assert_eq!(releases.len(), 1);
        assert_eq!(releases[0].assets.len(), 1);
        assert_eq!(releases[0].assets[0].name, "OneRing.msi");
    }
}
