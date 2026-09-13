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
    Ssh {
        host: String,
        port: u16,
        user: String,
    },

    /// A pane owned by a local `tmux -CC` controller.
    #[serde(rename = "tmux-cc")]
    TmuxCc {
        controller_id: u32,
        pane_id: String,
        session_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        socket_name: Option<String>,
    },
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tmux_pane_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tmux_controller_id: Option<u32>,
    /// tmux window id (e.g. `@1`) the pane belongs to. The frontend
    /// uses this to map a `Session` back to its containing `xsterm Window`.
    /// `None` for non-tmux sessions (local PTY / SSH).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tmux_window_id: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_hidden: bool,
}

#[inline]
fn is_false(b: &bool) -> bool {
    !*b
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
    /// Initial PTY rows. Defaults to 24 when `None`.
    #[serde(default)]
    pub initial_rows: Option<u16>,
    /// Initial PTY columns. Defaults to 80 when `None`.
    #[serde(default)]
    pub initial_cols: Option<u16>,
}

/// Configuration for creating an SSH session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SSHSessionConfig {
    /// Optional display name for the session. Falls back to
    /// `format!("{}@{}", username, host)` when `None` or empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,

    // SSH auth — flat fields matching spec (doc/requirements/prd-0.1/create-session-config.md:112-117)
    // and frontend (src/types/session.ts:90). `rename = "auth_type"` and
    // `rename = "key_file"` override `rename_all = "camelCase"` to keep the
    // snake_case JSON keys the spec requires.
    #[serde(rename = "auth_type")]
    pub auth_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(rename = "key_file", default, skip_serializing_if = "Option::is_none")]
    pub key_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passphrase: Option<String>,
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
            auth_type: "password".to_string(),
            password: None,
            key_file: None,
            passphrase: None,
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

/// Direction for a tmux pane split.
///
/// Mirrors the TypeScript `SplitDirection = "horizontal" | "vertical"`
/// (see `src/types/session.ts`). `Horizontal` corresponds to tmux's
/// `split-window -h` (right of the parent pane), `Vertical` corresponds
/// to `split-window -v` (below the parent pane).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SplitDirection {
    /// Split right of the parent pane (`-h`).
    Horizontal,
    /// Split below the parent pane (`-v`).
    Vertical,
}

impl SplitDirection {
    /// Parse from a frontend-supplied string. Returns `None` for anything
    /// other than `"horizontal"` / `"vertical"` so the Tauri command layer
    /// can surface a clear validation error instead of silently defaulting.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "horizontal" => Some(Self::Horizontal),
            "vertical" => Some(Self::Vertical),
            _ => None,
        }
    }

    /// Convert to the corresponding tmux `-h` / `-v` flag.
    pub fn flag(self) -> &'static str {
        match self {
            Self::Horizontal => "-h",
            Self::Vertical => "-v",
        }
    }
}

/// Result of a successful tmux attach (Wave 4 `attachedTmuxServers`).
///
/// Mirrors the TypeScript `AttachedTmuxServer` interface exactly. The frontend
/// reads this list on app startup to know which tmux servers to auto-attach
/// to; the backend rewrites it on every successful `create_tmux` /
/// `attach_tmux` and whenever the last pane on a controller is closed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachedTmuxServer {
    /// tmux session name (the `-s <name>` arg). Required to re-attach.
    pub session_name: String,
    /// tmux socket name (the `-L <socket>` arg). When `None`, callers fall
    /// back to tmux's default socket.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub socket_name: Option<String>,
    /// ms epoch when the user last attached (or created) this server. Used
    /// to order re-attach: most-recent first.
    pub attached_at: u64,
}

/// Configuration for creating a tmux `-CC` controller session.
///
/// Spawns a `tmux -CC` child process which then creates and owns one or
/// more panes (each of which xsterm maps to a leaf [`SessionInfo`]). See
/// `doc/requirements/prd-0.1/req-006-tmux.md` §2 (D1) for the
/// one-controller-N-panes design rationale.
///
/// ## SSH + tmux -CC
///
/// When [`TmuxCcConfig::ssh`] is `Some(_)`, the controller is run on the
/// remote host via an SSH exec channel — the SSH session opens
/// `tmux -CC` on the remote side and its byte stream is bridged into the
/// controller's I/O task the same way a local child process would be.
/// When `ssh` is `None`, the controller spawns a local
/// `tokio::process::Command` child.
///
/// The frontend mirrors this shape with `TmuxCcConfig.ssh?: SSHSessionConfig`
/// in `src/types/session.ts`; the Create Session dialog exposes a
/// dedicated "Tmux (SSH)" top tab that fills both halves of the payload.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TmuxCcConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tmux_session_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub socket_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_config: Option<EnvConfig>,
    #[serde(default)]
    pub initial_rows: Option<u16>,
    #[serde(default)]
    pub initial_cols: Option<u16>,
    /// SSH connection config. When `Some(_)`, the controller runs
    /// `tmux -CC` on the remote host via an SSH exec channel. When
    /// `None` (the default), the controller spawns a local `tmux -CC`
    /// child process. Mirrors `doc/requirements/prd-0.1/req-006-tmux.md`
    /// §4.4 D5 + §4.7 (the `ssh` field on `TmuxCcConfig`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh: Option<SSHSessionConfig>,
    /// Frontend-only: id of the saved SSH or Local shell config this
    /// tmux session rides on. `CreateSessionDialog.handleCreate`
    /// looks the base config up and copies the SSH sub-config into
    /// `ssh` above before the request reaches the backend. The
    /// backend only uses `baseConfigId` for logging — the actual
    // transport is determined by whether `ssh` is set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_config_id: Option<String>,
}

/// Build a [`SessionInfo`] for a tmux pane freshly registered with
/// `controller_id` and `tmux_pane_id`.
///
/// `display_name` is the user-visible name (falls back to the
/// `tmux_session_name` or `"tmux <controller_id>:<pane_id>"`).
///
/// `is_hidden` is a caller-driven flag. The MVP (`tmux -CC new`) always
/// passes `false` because the first pane IS the user's working shell. The
/// `true` is used for `tmux -CC attach`, where the
/// original pane becomes the tmux control connection and should be
/// suppressed in the UI. See D3 in
/// `doc/requirements/prd-0.1/req-006-tmux.md`.
///
/// `tmux_window_id` is the tmux window id (e.g. `@1`) the pane belongs to.
/// Wave 3 propagates this so the frontend can map a `Session` to its
/// containing `xsterm Window`. Pass `None` if the pane is not yet attached
/// to a tmux window (rare — only used by tests that construct a synthetic
/// pane without a window).
pub fn tmux_pane_info(
    xsterm_session_id: u32,
    controller_id: u32,
    tmux_pane_id: impl Into<String>,
    tmux_session_name: Option<&str>,
    display_name: Option<&str>,
    is_hidden: bool,
    tmux_window_id: Option<&str>,
) -> SessionInfo {
    let tmux_pane_id = tmux_pane_id.into();
    let session_name = tmux_session_name
        .map(str::to_string)
        .unwrap_or_else(|| format!("tmux-{controller_id}"));
    let default_display = format!("{session_name}:{tmux_pane_id}");
    let name = display_name
        .filter(|n| !n.trim().is_empty())
        .map(str::to_string)
        .unwrap_or(default_display);
    SessionInfo {
        id: xsterm_session_id,
        name,
        session_type: SessionType::TmuxCc {
            controller_id,
            pane_id: tmux_pane_id.clone(),
            session_name,
            socket_name: None,
        },
        is_connected: true,
        capabilities: CapabilityFlags::for_tmux(),
        tmux_pane_id: Some(tmux_pane_id),
        tmux_controller_id: Some(controller_id),
        tmux_window_id: tmux_window_id.map(str::to_string),
        is_hidden,
    }
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
    /// Configuration for a tmux `-CC` controller session.
    #[serde(rename = "tmuxCc")]
    TmuxCc(TmuxCcConfig),
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
///
/// Terminal sizing strategy.
///
/// `Auto` makes the terminal track its container size via the frontend
/// `ResizeObserver` (the default, backward-compatible behavior). `Fixed`
/// locks the terminal to a user-specified `cols` × `rows` and ignores
/// container resizes at runtime. The PTY startup size is still set from
/// `LocalSessionConfig::initial_rows` / `initial_cols` (or the SSH
/// equivalents) regardless of this flag — it only affects runtime
/// resizing behavior on the renderer side.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SizingMode {
    /// Terminal auto-fits its container (default).
    #[default]
    Auto,
    /// Terminal is locked to the user-specified cols × rows.
    Fixed,
}

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
    /// Terminal sizing strategy. Backward compatible: missing or unknown
    /// values deserialize as `Auto`. Old v1 payloads carrying the now-removed
    /// `fitOnResize` field are silently dropped — `Auto` was always the
    /// effective runtime behavior.
    #[serde(default)]
    pub sizing_mode: Option<SizingMode>,
    /// Locked columns when `sizing_mode == Fixed`. Unused in `Auto` mode.
    #[serde(default)]
    pub cols: Option<u32>,
    /// Locked rows when `sizing_mode == Fixed`. Unused in `Auto` mode.
    #[serde(default)]
    pub rows: Option<u32>,
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
            auth_type: "key".to_string(),
            password: None,
            key_file: Some("/home/user/.ssh/id_rsa".to_string()),
            passphrase: Some("secret".to_string()),
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
            auth_type: "password".to_string(),
            password: Some("pass".to_string()),
            key_file: None,
            passphrase: None,
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
            auth_type: "key".to_string(),
            password: None,
            key_file: Some("/path/to/key".to_string()),
            passphrase: None,
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
            auth_type: "password".to_string(),
            password: Some("pass".to_string()),
            key_file: None,
            passphrase: None,
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
            auth_type: "password".to_string(),
            password: Some("secret".to_string()),
            key_file: None,
            passphrase: None,
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
            auth_type: "password".to_string(),
            password: Some("p".to_string()),
            key_file: None,
            passphrase: None,
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
        let json_without_name =
            r#"{"host":"h","port":22,"username":"u","auth_type":"password","password":"p"}"#;
        let config: SSHSessionConfig =
            serde_json::from_str(json_without_name).expect("deserialize");
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
            initial_rows: Some(30),
            initial_cols: Some(120),
        };

        let json = serde_json::to_string(&config).expect("serialize LocalSessionConfig");

        assert!(json.contains("\"shellTemplate\""));
        assert!(json.contains("\"termType\""));
        assert!(json.contains("\"charset\""));
        assert!(json.contains("\"startupCommand\""));
        assert!(json.contains("\"startupDelayMs\""));

        let roundtrip: LocalSessionConfig =
            serde_json::from_str(&json).expect("deserialize LocalSessionConfig");

        assert_eq!(
            roundtrip.shell_template.as_deref(),
            Some("template {{name}}")
        );
        assert_eq!(roundtrip.term_type.as_deref(), Some("xterm-256color"));
        assert_eq!(roundtrip.charset.as_deref(), Some("utf-8"));
        assert_eq!(roundtrip.startup_command.as_deref(), Some("echo ready"));
        assert_eq!(roundtrip.startup_delay_ms, Some(500));
        assert_eq!(roundtrip.initial_rows, Some(30));
        assert_eq!(roundtrip.initial_cols, Some(120));
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
            auth_type: "key".to_string(),
            password: None,
            key_file: Some("/home/user/.ssh/id_rsa".to_string()),
            passphrase: Some("secret".to_string()),
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

        let json_with_snake = r#"{"host":"h","port":22,"username":"u","auth_type":"password","password":"p","tcpNodelay":true,"charset":"latin1"}"#;
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
            sizing_mode: Some(SizingMode::Fixed),
            cols: Some(120),
            rows: Some(40),
            logging: None,
        };

        let json = serde_json::to_string(&config).expect("serialize DisplayConfig");

        assert!(json.contains("\"lineTimestamp\""));
        assert!(json.contains("\"timeFormat\""));
        assert!(json.contains("\"dateTimeFormat\""));
        assert!(json.contains("\"autoWrap\""));
        assert!(json.contains("\"reverseVideo\""));
        assert!(json.contains("\"mouseWheelScrollLines\""));
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
        assert_eq!(
            roundtrip.date_time_format.as_deref(),
            Some("%Y-%m-%d %H:%M:%S")
        );
        assert_eq!(roundtrip.auto_wrap, Some(true));
        assert_eq!(roundtrip.reverse_video, Some(false));
        assert_eq!(roundtrip.mouse_wheel_scroll_lines, Some(3));
        assert_eq!(roundtrip.sizing_mode, Some(SizingMode::Fixed));
        assert_eq!(roundtrip.cols, Some(120));
        assert_eq!(roundtrip.rows, Some(40));
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

    #[test]
    fn ssh_session_config_deserializes_flat_auth_type_field() {
        // Frontend sends snake_case auth_type; SSHSessionConfig uses flat fields
        // with `#[serde(rename = "auth_type")]` to accept this payload.
        let json = r#"{
            "host": "example.com",
            "port": 22,
            "username": "user",
            "auth_type": "password",
            "password": "secret"
        }"#;
        let config: SSHSessionConfig =
            serde_json::from_str(json).expect("frontend payload must deserialize");
        assert_eq!(config.host, "example.com");
        assert_eq!(config.port, 22);
        assert_eq!(config.username, "user");
        assert_eq!(config.auth_type, "password");
        assert_eq!(config.password.as_deref(), Some("secret"));
    }

    #[test]
    fn ssh_session_config_deserializes_key_file_auth() {
        let json = r#"{
            "host": "example.com",
            "port": 2222,
            "username": "user",
            "auth_type": "key",
            "key_file": "/home/user/.ssh/id_rsa",
            "passphrase": "secret"
        }"#;
        let config: SSHSessionConfig =
            serde_json::from_str(json).expect("key auth payload must deserialize");
        assert_eq!(config.auth_type, "key");
        assert_eq!(config.key_file.as_deref(), Some("/home/user/.ssh/id_rsa"));
        assert_eq!(config.passphrase.as_deref(), Some("secret"));
    }

    #[test]
    fn ssh_session_config_rejects_legacy_authtype_field() {
        // Frontend BEFORE this fix sent { authType: "password", password: "..." }
        // (broken because SSHAuth was tagged with authType). After fix,
        // SSHSessionConfig uses auth_type (snake_case), and deny_unknown_fields
        // explicitly rejects any legacy authType field.
        let legacy_json = r#"{
            "host": "h",
            "port": 22,
            "username": "u",
            "authType": "password",
            "password": "p"
        }"#;
        let result: Result<SSHSessionConfig, _> = serde_json::from_str(legacy_json);
        assert!(
            result.is_err(),
            "deny_unknown_fields must reject legacy authType payload"
        );
    }

    /// Regression test: frontend's TerminalTab dispatches Term Type / Charset
    /// changes to LocalSessionConfig / SSHSessionConfig. Verify the camelCase
    /// JSON payload the frontend sends (via `sessionService.createLocal` /
    /// `sessionService.createSsh`) round-trips through `SessionConfig` (the
    /// create-session input enum) into the snake_case Rust fields that
    /// `local_session.rs:130` and `ssh.rs:427` consume. If this breaks, the
    /// user's Terminal Type setting will be silently dropped on the wire.
    #[test]
    fn tmux_cc_config_json_roundtrip_preserves_all_fields() {
        let config = TmuxCcConfig {
            name: Some("my tmux".to_string()),
            tmux_session_name: Some("work".to_string()),
            socket_name: Some("dev".to_string()),
            start_command: Some("clear\n".to_string()),
            env_config: Some(EnvConfig {
                env: Some(HashMap::from([("FOO".to_string(), "bar".to_string())])),
            }),
            initial_rows: Some(40),
            initial_cols: Some(132),
            ssh: None,
            base_config_id: None,
        };

        let json = serde_json::to_string(&config).expect("serialize TmuxCcConfig");
        assert!(json.contains("\"tmuxSessionName\":\"work\""));
        assert!(json.contains("\"socketName\":\"dev\""));
        assert!(json.contains("\"startCommand\":\"clear\\n\""));
        assert!(json.contains("\"initialRows\":40"));
        assert!(json.contains("\"initialCols\":132"));

        let roundtrip: TmuxCcConfig =
            serde_json::from_str(&json).expect("deserialize TmuxCcConfig");
        assert_eq!(roundtrip.name.as_deref(), Some("my tmux"));
        assert_eq!(roundtrip.tmux_session_name.as_deref(), Some("work"));
        assert_eq!(roundtrip.socket_name.as_deref(), Some("dev"));
        assert_eq!(roundtrip.start_command.as_deref(), Some("clear\n"));
        assert_eq!(roundtrip.initial_rows, Some(40));
        assert_eq!(roundtrip.initial_cols, Some(132));
    }

    #[test]
    fn tmux_cc_config_json_default_roundtrip_when_all_fields_missing() {
        let json = "{}";
        let config: TmuxCcConfig = serde_json::from_str(json).expect("empty JSON must deserialize");
        assert!(config.name.is_none());
        assert!(config.tmux_session_name.is_none());
        assert!(config.socket_name.is_none());
        assert!(config.start_command.is_none());
        assert!(config.env_config.is_none());
        assert!(config.initial_rows.is_none());
        assert!(config.initial_cols.is_none());
    }

    #[test]
    fn session_config_tmux_variant_roundtrip() {
        let json = r#"{"type":"tmuxCc","config":{"name":"work","tmuxSessionName":"main","socketName":"dev"}}"#;
        let parsed: SessionConfig = serde_json::from_str(json).expect("TmuxCc SessionConfig");
        match parsed {
            SessionConfig::TmuxCc(cfg) => {
                assert_eq!(cfg.name.as_deref(), Some("work"));
                assert_eq!(cfg.tmux_session_name.as_deref(), Some("main"));
                assert_eq!(cfg.socket_name.as_deref(), Some("dev"));
            }
            other => panic!("expected SessionConfig::TmuxCc, got {other:?}"),
        }
    }

    #[test]
    fn tmux_pane_info_populates_all_tmux_fields() {
        let info = tmux_pane_info(
            42,
            7,
            "%13",
            Some("main"),
            Some("editor pane"),
            false,
            Some("@3"),
        );
        assert_eq!(info.id, 42);
        assert_eq!(info.name, "editor pane");
        assert!(info.is_connected);
        assert!(info.capabilities.supports_multiplex);
        assert_eq!(info.tmux_pane_id.as_deref(), Some("%13"));
        assert_eq!(info.tmux_controller_id, Some(7));
        assert_eq!(info.tmux_window_id.as_deref(), Some("@3"));
        assert!(!info.is_hidden);
        match info.session_type {
            SessionType::TmuxCc {
                controller_id,
                pane_id,
                session_name,
                socket_name,
            } => {
                assert_eq!(controller_id, 7);
                assert_eq!(pane_id, "%13");
                assert_eq!(session_name, "main");
                assert!(socket_name.is_none());
            }
            other => panic!("expected SessionType::TmuxCc, got {other:?}"),
        }
    }

    #[test]
    fn tmux_pane_info_propagates_caller_supplied_is_hidden_flag() {
        // The function is a generic constructor — the hidden flag is a
        // caller decision, not something the helper computes. MVP callers
        // (`tmux -CC new`) pass `false`; attach callers pass
        // `true`. This test locks in both directions.
        let hidden = tmux_pane_info(1, 1, "%0", None, None, true, None);
        assert!(
            hidden.is_hidden,
            "caller passed true → is_hidden must be true"
        );
        let visible = tmux_pane_info(2, 1, "%5", None, None, false, None);
        assert!(
            !visible.is_hidden,
            "caller passed false → is_hidden must be false"
        );
        assert_eq!(
            visible.name, "tmux-1:%5",
            "missing display_name falls back to controller:pane",
        );
    }

    #[test]
    fn tmux_pane_info_serializes_is_hidden_only_when_true() {
        let hidden = tmux_pane_info(1, 1, "%0", None, None, true, None);
        let visible = tmux_pane_info(2, 1, "%5", None, None, false, None);
        let hidden_json = serde_json::to_string(&hidden).unwrap();
        let visible_json = serde_json::to_string(&visible).unwrap();
        assert!(hidden_json.contains("\"isHidden\":true"));
        assert!(!visible_json.contains("isHidden"));
    }

    #[test]
    fn tmux_pane_info_serializes_tmux_window_id_only_when_some() {
        let with_window = tmux_pane_info(1, 1, "%5", None, None, false, Some("@2"));
        let without_window = tmux_pane_info(2, 1, "%6", None, None, false, None);
        let with_json = serde_json::to_string(&with_window).unwrap();
        let without_json = serde_json::to_string(&without_window).unwrap();
        assert!(with_json.contains("\"tmuxWindowId\":\"@2\""));
        assert!(!without_json.contains("tmuxWindowId"));
    }

    #[test]
    fn session_config_payload_term_type_roundtrip() {
        // Mirrors what the frontend sends: discriminated union with the
        // local/ssh variant tagged by `type` and the payload under `config`,
        // plus camelCase `termType` / `charset` inside.
        let local_json = r#"{
            "type": "local",
            "config": {
                "name": "my-local",
                "shellTemplate": "bash",
                "termType": "xterm-256color",
                "charset": "utf-8",
                "initialCols": 100,
                "initialRows": 30
            }
        }"#;
        let parsed: SessionConfig =
            serde_json::from_str(local_json).expect("deserialize SessionConfig::Local");
        match parsed {
            SessionConfig::Local(local) => {
                assert_eq!(local.term_type.as_deref(), Some("xterm-256color"));
                assert_eq!(local.charset.as_deref(), Some("utf-8"));
                assert_eq!(local.initial_cols, Some(100));
                assert_eq!(local.initial_rows, Some(30));
            }
            SessionConfig::Ssh(_) => panic!("expected Local variant"),
            SessionConfig::TmuxCc(_) => panic!("expected Local variant"),
        }

        let ssh_json = r#"{
            "type": "ssh",
            "config": {
                "host": "example.com",
                "port": 22,
                "username": "u",
                "auth_type": "password",
                "password": "p",
                "termType": "screen",
                "charset": "gbk"
            }
        }"#;
        let parsed: SessionConfig =
            serde_json::from_str(ssh_json).expect("deserialize SessionConfig::Ssh");
        match parsed {
            SessionConfig::Ssh(ssh) => {
                assert_eq!(ssh.term_type.as_deref(), Some("screen"));
                assert_eq!(ssh.charset.as_deref(), Some("gbk"));
            }
            SessionConfig::Local(_) => panic!("expected Ssh variant"),
            SessionConfig::TmuxCc(_) => panic!("expected Ssh variant"),
        }
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

#[cfg(test)]
mod split_direction_tests {
    use super::SplitDirection;

    #[test]
    fn parse_horizontal_returns_horizontal_variant() {
        assert_eq!(
            SplitDirection::parse("horizontal"),
            Some(SplitDirection::Horizontal)
        );
    }

    #[test]
    fn parse_vertical_returns_vertical_variant() {
        assert_eq!(
            SplitDirection::parse("vertical"),
            Some(SplitDirection::Vertical)
        );
    }

    #[test]
    fn parse_returns_none_for_unknown_string() {
        assert_eq!(SplitDirection::parse("diagonal"), None);
        assert_eq!(SplitDirection::parse(""), None);
        assert_eq!(
            SplitDirection::parse("Horizontal"),
            None,
            "must be lowercase exactly"
        );
    }

    #[test]
    fn flag_returns_correct_tmux_argument() {
        assert_eq!(SplitDirection::Horizontal.flag(), "-h");
        assert_eq!(SplitDirection::Vertical.flag(), "-v");
    }

    #[test]
    fn serializes_as_lowercase_string() {
        let json = serde_json::to_string(&SplitDirection::Horizontal).unwrap();
        assert_eq!(json, "\"horizontal\"");
        let json = serde_json::to_string(&SplitDirection::Vertical).unwrap();
        assert_eq!(json, "\"vertical\"");
    }

    #[test]
    fn deserializes_from_lowercase_string() {
        let horizontal: SplitDirection = serde_json::from_str("\"horizontal\"").unwrap();
        assert_eq!(horizontal, SplitDirection::Horizontal);
        let vertical: SplitDirection = serde_json::from_str("\"vertical\"").unwrap();
        assert_eq!(vertical, SplitDirection::Vertical);
    }
}
