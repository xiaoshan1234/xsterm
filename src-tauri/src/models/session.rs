use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::models::capabilities::CapabilityFlags;

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
    pub capabilities: CapabilityFlags,
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

/// Discriminated union for the configuration required to create a session.
///
/// Used by the generic `create_session` Tauri command so the frontend can pass
/// either a local or SSH config via a single call. The shape is intentionally
/// `{type, config}` so it mirrors the TS `SessionType` discriminated union.
///
/// Note: this is distinct from [`SessionType`], which is a *runtime* type tag
/// attached to an already-created `SessionInfo`. `SessionConfig` is the input
/// payload used at session creation time.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "config")]
pub enum SessionConfig {
    /// Configuration for a local shell session.
    #[serde(rename = "local")]
    Local(LocalSessionConfig),
    /// Configuration for an SSH session.
    #[serde(rename = "ssh")]
    Ssh(SSHSessionConfig),
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

/// Returns the default schema version for [`SavedSessionConfigV1`].
///
/// Current schema is version `1`. Bump this constant (and migrate older payloads
/// in `src/services/sessionStorage.ts`) whenever the on-disk shape changes.
#[allow(dead_code)]
fn default_version() -> u32 {
    1
}

/// Top-level persisted session configuration (schema v1).
///
/// Shape (matches the TS `SavedSessionConfig`):
/// ```json
/// {
///   "id": "...",
///   "name": "...",
///   "version": 1,
///   "type": "local" | "ssh",
///   "config": { ...LocalSessionConfig | SSHSessionConfig },
///   "displayConfig": { ...DisplayConfig }  // optional
/// }
/// ```
///
/// The `type` / `config` pair is produced by flattening [`SavedSessionConfigKind`]
/// (an adjacently-tagged enum: `tag = "type"`, `content = "config"`), so the
/// serialized form is a flat object — identical to what the TS side emits.
///
/// Migration responsibility: the frontend persistence layer
/// (`src/services/sessionStorage.ts`) reads the legacy v0 shape
/// (`{ id, name, type, localConfig?, sshConfig? }`) and upgrades it to this v1
/// shape before writing back. The Rust backend treats this struct as the
/// authoritative representation for any v1+ payloads it is asked to deserialize.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedSessionConfigV1 {
    pub id: String,
    pub name: String,
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(flatten)]
    pub config: SavedSessionConfigKind,
    #[serde(default)]
    pub display_config: Option<DisplayConfig>,
}

/// Discriminated union carried inside [`SavedSessionConfigV1`].
///
/// Serialized as `{ "type": "...", "config": { ... } }`. The variants mirror
/// the create-time [`SessionConfig`] enum but reuse the existing
/// [`LocalSessionConfig`] / [`SSHSessionConfig`] payload structs.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "config")]
pub enum SavedSessionConfigKind {
    #[serde(rename = "local")]
    Local(LocalSessionConfig),
    #[serde(rename = "ssh")]
    Ssh(SSHSessionConfig),
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
