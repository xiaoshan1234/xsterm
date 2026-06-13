use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SessionType {
    #[serde(rename = "local")]
    Local { shell: String, cwd: String },
    #[serde(rename = "ssh")]
    Ssh { host: String, port: u16, user: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: u32,
    pub name: String,
    pub session_type: SessionType,
    pub is_connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalSessionConfig {
    pub shell: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SSHSessionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(flatten)]
    pub auth: SSHAuth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "auth_type")]
pub enum SSHAuth {
    #[serde(rename = "password")]
    Password { password: String },
    #[serde(rename = "key")]
    KeyFile { key_file: String, passphrase: Option<String> },
}

/// Result of an SSH connection, containing both the channel (for trait compliance)
/// and the direct I/O channels that bypass Mutex contention.
pub struct SshConnectResult {
    pub channel: Box<dyn crate::infrastructure::ssh::SshChannel + Send>,
    pub write_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    pub read_rx: std::sync::mpsc::Receiver<Option<Vec<u8>>>,
}

pub struct SshSessionWrapper {
    pub info: SessionInfo,
    pub write_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
}
