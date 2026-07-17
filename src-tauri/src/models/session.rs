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
}

/// Metadata describing a terminal session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: u32,
    pub name: String,
    pub session_type: SessionType,
    pub is_connected: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemConfig {
    pub newline: String,
    pub terminal_type: String,
    pub charset: String,
    pub backspace: String,
    pub delete: String,
    pub mouse_scroll: String,
    pub signal_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalConfig {
    pub scrollback_lines: u32,
    pub auto_log_path: String,
    pub highlight_keywords: String,
}

impl Default for TerminalConfig {
    fn default() -> Self {
        Self {
            scrollback_lines: 5000,
            auto_log_path: String::new(),
            highlight_keywords: String::new(),
        }
    }
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
    pub system: SystemConfig,
    #[serde(default)]
    pub terminal: TerminalConfig,
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
    pub system: SystemConfig,
    #[serde(default)]
    pub terminal: TerminalConfig,
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
