use serde::{Deserialize, Serialize};

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

    /// A tmux underlay session.
    #[serde(rename = "tmux")]
    Tmux {
        socket: Option<String>,
        command: String,
        target: String,
    },

    #[serde(rename = "ssh_tmux")]
    SshTmux {
        host: String,
        port: u16,
        user: String,
        socket: Option<String>,
        command: String,
        target: String,
    },
}

/// Configuration for creating a tmux underlay session over SSH.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTmuxSessionConfig {
    pub ssh: SSHSessionConfig,
    pub tmux: TmuxSessionConfig,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmuxSessionConfig {
    /// Optional human-readable name for the xsterm session tab.
    pub name: Option<String>,
    /// Optional tmux socket name (`-L` flag).
    pub socket: Option<String>,
    /// The tmux subcommand used to enter the target session, e.g. `new-session` or
    /// `attach-session`.
    pub command: String,
    /// Optional target argument for the subcommand, e.g. a session name.
    pub target: Option<String>,
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
}

/// Configuration for creating an SSH session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SSHSessionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(flatten)]
    pub auth: SSHAuth,
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
