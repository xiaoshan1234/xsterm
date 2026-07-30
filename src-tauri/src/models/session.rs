use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Supported session types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SessionType {
    /// A local shell session running on the host machine.
    #[serde(rename = "local")]
    Local { shell: String, cwd: String },

    /// A remote session connected over SSH.
    #[serde(rename = "ssh")]
    Ssh { host: String, port: u16, user: String },
}

/// Metadata describing a terminal session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: u32,
    pub name: String,
    pub session_type: SessionType,
    pub is_connected: bool,
}

/// Configuration for creating a local shell session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalSessionConfig {
    /// Optional shell executable path. Falls back to the user's default shell.
    pub shell: Option<String>,
    /// Optional working directory. Falls back to the user's home directory.
    pub cwd: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub env_config: Option<EnvConfig>,
}

/// Configuration for creating an SSH session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SSHSessionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(flatten)]
    pub auth: SSHAuth,
    #[serde(default)]
    pub term_type: Option<String>,
    #[serde(default)]
    pub initial_rows: Option<u32>,
    #[serde(default)]
    pub initial_cols: Option<u32>,
    #[serde(default)]
    pub keepalive_interval: Option<u32>,
    #[serde(default)]
    pub connection_timeout: Option<u32>,
    #[serde(default)]
    pub enable_compression: Option<bool>,
}

/// Authentication method for an SSH session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "auth_type")]
pub enum SSHAuth {
    /// Authenticate with a password.
    #[serde(rename = "password")]
    Password { password: String },
    /// Authenticate with a private key file and optional passphrase.
    #[serde(rename = "key")]
    KeyFile { key_file: String, passphrase: Option<String> },
}

/// Display configuration for terminal appearance.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DisplayConfig {
    pub font_size: Option<u32>,
    pub font_family: Option<String>,
    pub cursor_style: Option<String>,
    pub cursor_blink: Option<bool>,
    pub scrollback: Option<u32>,
    pub line_height: Option<f64>,
    pub letter_spacing: Option<f64>,
    pub cursor_width: Option<u32>,
}

/// Environment variables configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EnvConfig {
    pub env: Option<HashMap<String, String>>,
}

/// Persistent saved session configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SavedSessionConfig {
    pub display_config: Option<DisplayConfig>,
}

/// Build a remote path for an uploaded image file.
///
/// The path is `/tmp/paste_image_<timestamp>.<ext>` where `<ext>` is extracted
/// from `filename` (defaults to `png` if no extension is present).
pub fn build_remote_image_path(filename: &str) -> Result<String, String> {
    let extension = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    Ok(format!("/tmp/paste_image_{}.{}", timestamp, extension))
}
