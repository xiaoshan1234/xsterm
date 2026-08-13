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
    /// Optional display name for the session. Falls back to the shell basename
    /// when `None` or empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
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
    /// Optional display name for the session. Falls back to
    /// `format!("{}@{}", username, host)` when `None` or empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
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
    /// Path to known_hosts file for host key verification (currently unused — see AGENTS.md note).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub known_hosts_path: Option<String>,
    /// SSH proxy jump host (user@host or host:port) for cascading connections.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy_jump: Option<String>,
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
#[serde(default)]
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
#[serde(default)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_session_config_json_roundtrip_with_all_fields() {
        let config = SSHSessionConfig {
            name: Some("my-server".to_string()),
            host: "example.com".to_string(),
            port: 2222,
            username: "user".to_string(),
            auth: SSHAuth::KeyFile {
                key_file: "/home/user/.ssh/id_rsa".to_string(),
                passphrase: Some("secret".to_string()),
            },
            term_type: Some("xterm-256color".to_string()),
            initial_rows: Some(24),
            initial_cols: Some(80),
            keepalive_interval: Some(60),
            connection_timeout: Some(30),
            enable_compression: Some(true),
            known_hosts_path: Some("/home/user/.ssh/known_hosts".to_string()),
            proxy_jump: Some("jump.example.com".to_string()),
        };

        let json = serde_json::to_string(&config).expect("serialize SSH config");
        let roundtrip: SSHSessionConfig =
            serde_json::from_str(&json).expect("deserialize SSH config");

        assert_eq!(roundtrip.name.as_deref(), Some("my-server"));
        assert_eq!(roundtrip.host, "example.com");
        assert_eq!(roundtrip.port, 2222);
        assert_eq!(roundtrip.username, "user");
        assert_eq!(roundtrip.term_type.as_deref(), Some("xterm-256color"));
        assert_eq!(roundtrip.initial_rows, Some(24));
        assert_eq!(roundtrip.initial_cols, Some(80));
        assert_eq!(roundtrip.keepalive_interval, Some(60));
        assert_eq!(roundtrip.connection_timeout, Some(30));
        assert_eq!(roundtrip.enable_compression, Some(true));
        assert_eq!(
            roundtrip.known_hosts_path.as_deref(),
            Some("/home/user/.ssh/known_hosts")
        );
        assert_eq!(roundtrip.proxy_jump.as_deref(), Some("jump.example.com"));
    }

    #[test]
    fn ssh_session_config_json_roundtrip_with_new_fields_absent() {
        let config = SSHSessionConfig {
            name: None,
            host: "localhost".to_string(),
            port: 22,
            username: "admin".to_string(),
            auth: SSHAuth::Password {
                password: "pass".to_string(),
            },
            term_type: None,
            initial_rows: None,
            initial_cols: None,
            keepalive_interval: None,
            connection_timeout: None,
            enable_compression: None,
            known_hosts_path: None,
            proxy_jump: None,
        };

        let json = serde_json::to_string(&config).expect("serialize SSH config");
        let roundtrip: SSHSessionConfig =
            serde_json::from_str(&json).expect("deserialize SSH config");

        assert_eq!(roundtrip.host, "localhost");
        assert_eq!(roundtrip.port, 22);
        assert!(roundtrip.name.is_none());
        assert!(roundtrip.known_hosts_path.is_none());
        assert!(roundtrip.proxy_jump.is_none());
    }

    #[test]
    fn ssh_session_config_json_known_hosts_path_only() {
        let config = SSHSessionConfig {
            name: None,
            host: "remote.example.com".to_string(),
            port: 22,
            username: "user".to_string(),
            auth: SSHAuth::KeyFile {
                key_file: "/path/to/key".to_string(),
                passphrase: None,
            },
            term_type: None,
            initial_rows: None,
            initial_cols: None,
            keepalive_interval: None,
            connection_timeout: None,
            enable_compression: None,
            known_hosts_path: Some("/custom/known_hosts".to_string()),
            proxy_jump: None,
        };

        let json = serde_json::to_string(&config).expect("serialize SSH config");
        assert!(json.contains("known_hosts_path"));
        assert!(!json.contains("proxy_jump"));

        let roundtrip: SSHSessionConfig =
            serde_json::from_str(&json).expect("deserialize SSH config");
        assert_eq!(
            roundtrip.known_hosts_path.as_deref(),
            Some("/custom/known_hosts")
        );
        assert!(roundtrip.proxy_jump.is_none());
    }

    #[test]
    fn ssh_session_config_json_proxy_jump_only() {
        let config = SSHSessionConfig {
            name: None,
            host: "internal.example.com".to_string(),
            port: 22,
            username: "user".to_string(),
            auth: SSHAuth::Password {
                password: "pass".to_string(),
            },
            term_type: None,
            initial_rows: None,
            initial_cols: None,
            keepalive_interval: None,
            connection_timeout: None,
            enable_compression: None,
            known_hosts_path: None,
            proxy_jump: Some("bastion@jump.example.com:22".to_string()),
        };

        let json = serde_json::to_string(&config).expect("serialize SSH config");
        assert!(json.contains("proxy_jump"));
        assert!(!json.contains("known_hosts_path"));

        let roundtrip: SSHSessionConfig =
            serde_json::from_str(&json).expect("deserialize SSH config");
        assert!(roundtrip.known_hosts_path.is_none());
        assert_eq!(
            roundtrip.proxy_jump.as_deref(),
            Some("bastion@jump.example.com:22")
        );
    }

    #[test]
    fn ssh_session_config_json_roundtrip_preserves_name_field() {
        let original = SSHSessionConfig {
            name: Some("production-web".to_string()),
            host: "prod.example.com".to_string(),
            port: 22,
            username: "deploy".to_string(),
            auth: SSHAuth::Password {
                password: "secret".to_string(),
            },
            term_type: None,
            initial_rows: None,
            initial_cols: None,
            keepalive_interval: None,
            connection_timeout: None,
            enable_compression: None,
            known_hosts_path: None,
            proxy_jump: None,
        };

        let json = serde_json::to_string(&original).expect("serialize");
        assert!(json.contains("\"name\":\"production-web\""));

        let roundtrip: SSHSessionConfig = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(roundtrip.name.as_deref(), Some("production-web"));
        assert_eq!(roundtrip.host, "prod.example.com");
        assert_eq!(roundtrip.username, "deploy");
    }

    #[test]
    fn ssh_session_config_json_omits_name_when_none() {
        let config = SSHSessionConfig {
            name: None,
            host: "h.example.com".to_string(),
            port: 22,
            username: "u".to_string(),
            auth: SSHAuth::Password { password: "p".to_string() },
            term_type: None,
            initial_rows: None,
            initial_cols: None,
            keepalive_interval: None,
            connection_timeout: None,
            enable_compression: None,
            known_hosts_path: None,
            proxy_jump: None,
        };

        let json = serde_json::to_string(&config).expect("serialize");
        assert!(!json.contains("\"name\""));

        let roundtrip: SSHSessionConfig = serde_json::from_str(&json).expect("deserialize");
        assert!(roundtrip.name.is_none());
    }

    #[test]
    fn local_session_config_json_roundtrip_preserves_name_field() {
        let original = LocalSessionConfig {
            name: Some("my-shell".to_string()),
            shell: Some("/bin/zsh".to_string()),
            cwd: Some("/home/me".to_string()),
            args: Some(vec!["-l".to_string()]),
            env_config: None,
        };

        let json = serde_json::to_string(&original).expect("serialize");
        assert!(json.contains("\"name\":\"my-shell\""));

        let roundtrip: LocalSessionConfig = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(roundtrip.name.as_deref(), Some("my-shell"));
        assert_eq!(roundtrip.shell.as_deref(), Some("/bin/zsh"));
        assert_eq!(roundtrip.cwd.as_deref(), Some("/home/me"));
        assert_eq!(roundtrip.args, Some(vec!["-l".to_string()]));
    }

    #[test]
    fn local_session_config_json_omits_name_when_none() {
        let config = LocalSessionConfig {
            name: None,
            shell: None,
            cwd: None,
            args: None,
            env_config: None,
        };

        let json = serde_json::to_string(&config).expect("serialize");
        assert!(!json.contains("\"name\""));

        let roundtrip: LocalSessionConfig = serde_json::from_str(&json).expect("deserialize");
        assert!(roundtrip.name.is_none());
    }

    #[test]
    fn local_session_config_json_missing_name_field_defaults_to_none() {
        let json_without_name = r#"{"shell":"/bin/bash"}"#;
        let config: LocalSessionConfig =
            serde_json::from_str(json_without_name).expect("deserialize");
        assert!(config.name.is_none());
        assert_eq!(config.shell.as_deref(), Some("/bin/bash"));
    }

    #[test]
    fn ssh_session_config_json_missing_name_field_defaults_to_none() {
        let json_without_name = r#"{"host":"h","port":22,"username":"u","auth_type":"password","password":"p"}"#;
        let config: SSHSessionConfig = serde_json::from_str(json_without_name).expect("deserialize");
        assert!(config.name.is_none());
        assert_eq!(config.host, "h");
    }
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
