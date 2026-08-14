use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::models::capabilities::CapabilityFlags;

/// Supported session types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: u32,
    pub name: String,
    pub session_type: SessionType,
    pub is_connected: bool,
    pub capabilities: CapabilityFlags,
}

/// Configuration for creating a local shell session.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
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
    #[serde(default)]
    pub shell_template: Option<String>,
    #[serde(default)]
    pub term_type: Option<String>,
    #[serde(default)]
    pub charset: Option<String>,
    #[serde(default)]
    pub startup_command: Option<String>,
    #[serde(default)]
    pub startup_delay_ms: Option<u64>,
}

/// Configuration for creating an SSH session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    pub tcp_nodelay: Option<bool>,
    #[serde(default)]
    pub so_keepalive: Option<bool>,
    #[serde(default)]
    pub null_packet_keepalive: Option<bool>,
    #[serde(default)]
    pub charset: Option<String>,
    #[serde(default)]
    pub enable_compression: Option<bool>,
    /// Path to known_hosts file for host key verification (currently unused — see AGENTS.md note).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub known_hosts_path: Option<String>,
    /// SSH proxy jump host (user@host or host:port) for cascading connections.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy_jump: Option<String>,
}

impl Default for SSHSessionConfig {
    fn default() -> Self {
        Self {
            name: None,
            host: String::new(),
            port: 22,
            username: String::new(),
            auth: SSHAuth::Password { password: String::new() },
            term_type: None,
            initial_rows: None,
            initial_cols: None,
            keepalive_interval: None,
            connection_timeout: None,
            tcp_nodelay: None,
            so_keepalive: None,
            null_packet_keepalive: None,
            charset: None,
            enable_compression: None,
            known_hosts_path: None,
            proxy_jump: None,
        }
    }
}

/// Authentication method for an SSH session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "authType", rename_all = "camelCase")]
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
#[serde(tag = "type", content = "config", rename_all = "camelCase")]
pub enum SessionConfig {
    /// Configuration for a local shell session.
    #[serde(rename = "local")]
    Local(LocalSessionConfig),
    /// Configuration for an SSH session.
    #[serde(rename = "ssh")]
    Ssh(SSHSessionConfig),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct SessionLoggingConfig {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub append: Option<bool>,
    #[serde(default)]
    pub file_name_template: Option<String>,
    #[serde(default)]
    pub max_size_mb: Option<u64>,
    #[serde(default)]
    pub line_format: Option<String>,
}

/// Display configuration for terminal appearance.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct DisplayConfig {
    pub font_size: Option<u32>,
    pub font_family: Option<String>,
    pub cursor_style: Option<String>,
    pub cursor_blink: Option<bool>,
    pub scrollback: Option<u32>,
    pub line_height: Option<f64>,
    pub letter_spacing: Option<f64>,
    pub cursor_width: Option<u32>,
    #[serde(default)]
    pub line_timestamp: Option<bool>,
    #[serde(default)]
    pub time_format: Option<String>,
    #[serde(default)]
    pub date_time_format: Option<String>,
    #[serde(default)]
    pub auto_wrap: Option<bool>,
    #[serde(default)]
    pub reverse_video: Option<bool>,
    #[serde(default)]
    pub mouse_wheel_scroll_lines: Option<u32>,
    #[serde(default)]
    pub fit_on_resize: Option<bool>,
    #[serde(default)]
    pub sync_remote_title: Option<bool>,
    #[serde(default)]
    pub backspace_sends: Option<String>,
    #[serde(default)]
    pub delete_sends: Option<String>,
    #[serde(default)]
    pub line_feed_mode: Option<bool>,
    #[serde(default)]
    pub cursor_key_mode: Option<String>,
    #[serde(default)]
    pub keypad_mode: Option<String>,
    #[serde(default)]
    pub modify_other_keys_format: Option<String>,
    #[serde(default)]
    pub alt_sends_escape: Option<bool>,
    #[serde(default)]
    pub word_separator_chars: Option<String>,
    #[serde(default)]
    pub alt_screen_word_separator_chars: Option<String>,
    #[serde(default)]
    pub clipboard_read: Option<String>,
    #[serde(default)]
    pub clipboard_write: Option<String>,
    #[serde(default)]
    pub logging: Option<SessionLoggingConfig>,
}

/// Environment variables configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(tag = "type", content = "config", rename_all = "camelCase")]
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
            tcp_nodelay: None,
            so_keepalive: None,
            null_packet_keepalive: None,
            charset: None,
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
            tcp_nodelay: None,
            so_keepalive: None,
            null_packet_keepalive: None,
            charset: None,
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
            tcp_nodelay: None,
            so_keepalive: None,
            null_packet_keepalive: None,
            charset: None,
            enable_compression: None,
            known_hosts_path: Some("/custom/known_hosts".to_string()),
            proxy_jump: None,
        };

        let json = serde_json::to_string(&config).expect("serialize SSH config");
        assert!(json.contains("knownHostsPath"));
        assert!(!json.contains("proxyJump"));

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
            tcp_nodelay: None,
            so_keepalive: None,
            null_packet_keepalive: None,
            charset: None,
            enable_compression: None,
            known_hosts_path: None,
            proxy_jump: Some("bastion@jump.example.com:22".to_string()),
        };

        let json = serde_json::to_string(&config).expect("serialize SSH config");
        assert!(json.contains("proxyJump"));
        assert!(!json.contains("knownHostsPath"));

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
            tcp_nodelay: None,
            so_keepalive: None,
            null_packet_keepalive: None,
            charset: None,
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
            tcp_nodelay: None,
            so_keepalive: None,
            null_packet_keepalive: None,
            charset: None,
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
            ..Default::default()
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
            ..Default::default()
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
        let json_without_name = r#"{"host":"h","port":22,"username":"u","authType":"password","password":"p"}"#;
        let config: SSHSessionConfig = serde_json::from_str(json_without_name).expect("deserialize");
        assert!(config.name.is_none());
        assert_eq!(config.host, "h");
    }

    #[test]
    fn local_session_config_json_roundtrip_with_all_new_fields() {
        let config = LocalSessionConfig {
            name: Some("my-shell".to_string()),
            shell: Some("/bin/zsh".to_string()),
            cwd: Some("/home/me".to_string()),
            args: Some(vec!["-l".to_string()]),
            env_config: None,
            shell_template: Some("template {{name}}".to_string()),
            term_type: Some("xterm-256color".to_string()),
            charset: Some("utf-8".to_string()),
            startup_command: Some("echo ready".to_string()),
            startup_delay_ms: Some(500),
        };

        let json = serde_json::to_string(&config).expect("serialize LocalSessionConfig");

        assert!(json.contains("\"shellTemplate\""));
        assert!(json.contains("\"termType\""));
        assert!(json.contains("\"charset\""));
        assert!(json.contains("\"startupCommand\""));
        assert!(json.contains("\"startupDelayMs\""));

        let roundtrip: LocalSessionConfig =
            serde_json::from_str(&json).expect("deserialize LocalSessionConfig");

        assert_eq!(roundtrip.shell_template.as_deref(), Some("template {{name}}"));
        assert_eq!(roundtrip.term_type.as_deref(), Some("xterm-256color"));
        assert_eq!(roundtrip.charset.as_deref(), Some("utf-8"));
        assert_eq!(roundtrip.startup_command.as_deref(), Some("echo ready"));
        assert_eq!(roundtrip.startup_delay_ms, Some(500));
        assert_eq!(roundtrip.name.as_deref(), Some("my-shell"));
        assert_eq!(roundtrip.shell.as_deref(), Some("/bin/zsh"));

        let json_with_snake = r#"{"shell_template": "x", "startup_delay_ms": 999}"#;
        let from_snake: LocalSessionConfig =
            serde_json::from_str(json_with_snake).expect("deserialize snake_case JSON");
        assert!(from_snake.shell_template.is_none());
        assert!(from_snake.startup_delay_ms.is_none());
    }

    #[test]
    fn ssh_session_config_json_roundtrip_with_all_new_fields() {
        let config = SSHSessionConfig {
            name: Some("ssh-server".to_string()),
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
            tcp_nodelay: Some(true),
            so_keepalive: Some(true),
            null_packet_keepalive: Some(true),
            charset: Some("gbk".to_string()),
            enable_compression: Some(false),
            known_hosts_path: Some("/home/user/.ssh/known_hosts".to_string()),
            proxy_jump: Some("bastion.example.com".to_string()),
        };

        let json = serde_json::to_string(&config).expect("serialize SSHSessionConfig");

        assert!(json.contains("\"tcpNodelay\""));
        assert!(json.contains("\"soKeepalive\""));
        assert!(json.contains("\"nullPacketKeepalive\""));
        assert!(json.contains("\"charset\""));

        let roundtrip: SSHSessionConfig =
            serde_json::from_str(&json).expect("deserialize SSHSessionConfig");

        assert_eq!(roundtrip.tcp_nodelay, Some(true));
        assert_eq!(roundtrip.so_keepalive, Some(true));
        assert_eq!(roundtrip.null_packet_keepalive, Some(true));
        assert_eq!(roundtrip.charset.as_deref(), Some("gbk"));
        assert_eq!(roundtrip.host, "example.com");
        assert_eq!(roundtrip.port, 2222);

        let json_with_snake = r#"{"host":"h","port":22,"username":"u","authType":"password","password":"p","tcpNodelay":true,"charset":"latin1"}"#;
        let from_snake: SSHSessionConfig =
            serde_json::from_str(json_with_snake).expect("deserialize snake_case JSON");
        assert_eq!(from_snake.tcp_nodelay, Some(true));
        assert_eq!(from_snake.charset.as_deref(), Some("latin1"));
    }

    #[test]
    fn display_config_json_roundtrip_with_all_new_fields() {
        let config = DisplayConfig {
            font_size: Some(14),
            font_family: Some("Cascadia Code".to_string()),
            cursor_style: Some("block".to_string()),
            cursor_blink: Some(true),
            scrollback: Some(10000),
            line_height: Some(1.2),
            letter_spacing: Some(0.5),
            cursor_width: Some(8),
            line_timestamp: Some(true),
            time_format: Some("%H:%M:%S".to_string()),
            date_time_format: Some("%Y-%m-%d %H:%M:%S".to_string()),
            auto_wrap: Some(true),
            reverse_video: Some(false),
            mouse_wheel_scroll_lines: Some(3),
            fit_on_resize: Some(true),
            sync_remote_title: Some(false),
            backspace_sends: Some("backspace".to_string()),
            delete_sends: Some("delete".to_string()),
            line_feed_mode: Some(false),
            cursor_key_mode: Some("application".to_string()),
            keypad_mode: Some("application".to_string()),
            modify_other_keys_format: Some("1;3".to_string()),
            alt_sends_escape: Some(true),
            word_separator_chars: Some(" ".to_string()),
            alt_screen_word_separator_chars: Some("/".to_string()),
            clipboard_read: Some("auto".to_string()),
            clipboard_write: Some("auto".to_string()),
            logging: None,
        };

        let json = serde_json::to_string(&config).expect("serialize DisplayConfig");

        assert!(json.contains("\"lineTimestamp\""));
        assert!(json.contains("\"timeFormat\""));
        assert!(json.contains("\"dateTimeFormat\""));
        assert!(json.contains("\"autoWrap\""));
        assert!(json.contains("\"reverseVideo\""));
        assert!(json.contains("\"mouseWheelScrollLines\""));
        assert!(json.contains("\"fitOnResize\""));
        assert!(json.contains("\"syncRemoteTitle\""));
        assert!(json.contains("\"backspaceSends\""));
        assert!(json.contains("\"deleteSends\""));
        assert!(json.contains("\"lineFeedMode\""));
        assert!(json.contains("\"cursorKeyMode\""));
        assert!(json.contains("\"keypadMode\""));
        assert!(json.contains("\"modifyOtherKeysFormat\""));
        assert!(json.contains("\"altSendsEscape\""));
        assert!(json.contains("\"wordSeparatorChars\""));
        assert!(json.contains("\"altScreenWordSeparatorChars\""));
        assert!(json.contains("\"clipboardRead\""));
        assert!(json.contains("\"clipboardWrite\""));
        assert!(json.contains("\"logging\""));

        let roundtrip: DisplayConfig =
            serde_json::from_str(&json).expect("deserialize DisplayConfig");

        assert_eq!(roundtrip.line_timestamp, Some(true));
        assert_eq!(roundtrip.time_format.as_deref(), Some("%H:%M:%S"));
        assert_eq!(roundtrip.date_time_format.as_deref(), Some("%Y-%m-%d %H:%M:%S"));
        assert_eq!(roundtrip.auto_wrap, Some(true));
        assert_eq!(roundtrip.reverse_video, Some(false));
        assert_eq!(roundtrip.mouse_wheel_scroll_lines, Some(3));
        assert_eq!(roundtrip.fit_on_resize, Some(true));
        assert_eq!(roundtrip.sync_remote_title, Some(false));
        assert_eq!(roundtrip.backspace_sends.as_deref(), Some("backspace"));
        assert_eq!(roundtrip.delete_sends.as_deref(), Some("delete"));
        assert_eq!(roundtrip.line_feed_mode, Some(false));
        assert_eq!(roundtrip.cursor_key_mode.as_deref(), Some("application"));
        assert_eq!(roundtrip.keypad_mode.as_deref(), Some("application"));
        assert_eq!(roundtrip.modify_other_keys_format.as_deref(), Some("1;3"));
        assert_eq!(roundtrip.alt_sends_escape, Some(true));
        assert_eq!(roundtrip.word_separator_chars.as_deref(), Some(" "));
        assert_eq!(
            roundtrip.alt_screen_word_separator_chars.as_deref(),
            Some("/")
        );
        assert_eq!(roundtrip.clipboard_read.as_deref(), Some("auto"));
        assert_eq!(roundtrip.clipboard_write.as_deref(), Some("auto"));
        assert!(roundtrip.logging.is_none());

        assert_eq!(roundtrip.font_size, Some(14));
        assert_eq!(roundtrip.font_family.as_deref(), Some("Cascadia Code"));
        assert_eq!(roundtrip.scrollback, Some(10000));

        let json_with_snake = r#"{"line_timestamp": true, "auto_wrap": false}"#;
        let from_snake: DisplayConfig =
            serde_json::from_str(json_with_snake).expect("deserialize snake_case JSON");
        assert!(from_snake.line_timestamp.is_none());
        assert!(from_snake.auto_wrap.is_none());
    }

    #[test]
    fn session_logging_config_json_roundtrip() {
        let config = SessionLoggingConfig {
            enabled: Some(true),
            append: Some(false),
            file_name_template: Some("/tmp/session-{{id}}.log".to_string()),
            max_size_mb: Some(10),
            line_format: Some("[{{ts}}] {{line}}".to_string()),
        };

        let json = serde_json::to_string(&config).expect("serialize SessionLoggingConfig");

        assert!(json.contains("\"enabled\""));
        assert!(json.contains("\"append\""));
        assert!(json.contains("\"fileNameTemplate\""));
        assert!(json.contains("\"maxSizeMb\""));
        assert!(json.contains("\"lineFormat\""));

        let roundtrip: SessionLoggingConfig =
            serde_json::from_str(&json).expect("deserialize SessionLoggingConfig");

        assert_eq!(roundtrip.enabled, Some(true));
        assert_eq!(roundtrip.append, Some(false));
        assert_eq!(
            roundtrip.file_name_template.as_deref(),
            Some("/tmp/session-{{id}}.log")
        );
        assert_eq!(roundtrip.max_size_mb, Some(10));
        assert_eq!(roundtrip.line_format.as_deref(), Some("[{{ts}}] {{line}}"));

        let json_with_snake = r#"{"file_name_template": "x", "max_size_mb": 5}"#;
        let from_snake: SessionLoggingConfig =
            serde_json::from_str(json_with_snake).expect("deserialize snake_case JSON");
        assert!(from_snake.file_name_template.is_none());
        assert!(from_snake.max_size_mb.is_none());
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
