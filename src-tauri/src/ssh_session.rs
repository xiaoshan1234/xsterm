use ssh2::Session as SshSession;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};

use crate::session::{SSHAuth, SessionInfo};

// ============================================================================
// SSH Traits for mocking support
// ============================================================================

/// Combined Read + Write trait for SSH streams.
/// Note: Box<dyn Read + Write> is INVALID in Rust. Only auto traits (Send, Sync)
/// can be additional bounds in trait objects. This combined trait solves that.
pub trait StreamIO: Read + Write + Send + Sync {}
impl<T: Read + Write + Send + Sync> StreamIO for T {}

/// SshChannel trait - for PTY/shell operations on an SSH channel
pub trait SshChannel: Read + Write + Send {
    fn request_pty(&mut self, term: &str, cols: u16, rows: u16) -> Result<(), String>;
    fn shell(&mut self) -> Result<(), String>;
    fn tcp_stream(&self) -> Box<dyn StreamIO>;
}

/// SshBackend trait - creates SSH connections
pub trait SshBackend: Send {
    fn connect(
        &self,
        host: &str,
        port: u16,
        auth: &SSHAuth,
        username: &str,
    ) -> Result<Box<dyn SshChannel + Send>, String>;
}

/// Real implementation of SshBackend using ssh2 crate
pub struct SshBackendImpl {
    _phantom: std::marker::PhantomData<()>,
}

impl SshBackendImpl {
    pub fn new() -> Self {
        Self {
            _phantom: std::marker::PhantomData,
        }
    }
}

impl SshBackend for SshBackendImpl {
    fn connect(
        &self,
        host: &str,
        port: u16,
        auth: &SSHAuth,
        username: &str,
    ) -> Result<Box<dyn SshChannel + Send>, String> {
        let tcp = TcpStream::connect(format!("{}:{}", host, port))
            .map_err(|e| format!("Failed to connect: {}", e))?;

        let mut ssh_session = SshSession::new().map_err(|e| format!("SSH session error: {}", e))?;
        ssh_session
            .set_tcp_stream(tcp.try_clone().map_err(|e| e.to_string())?);
        ssh_session.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

        match auth {
            SSHAuth::Password { password } => {
                ssh_session
                    .userauth_password(username, password)
                    .map_err(|e| format!("SSH auth failed: {}", e))?;
            }
            SSHAuth::KeyFile { key_file, passphrase } => {
                ssh_session
                    .userauth_pubkey_file(
                        username,
                        None,
                        std::path::Path::new(key_file),
                        passphrase.as_deref(),
                    )
                    .map_err(|e| format!("SSH key auth failed: {}", e))?;
            }
        }

        if !ssh_session.authenticated() {
            return Err("SSH authentication failed".to_string());
        }

        let mut channel = ssh_session
            .channel_session()
            .map_err(|e| e.to_string())?;
        channel
            .request_pty("xterm", None, None)
            .map_err(|e| format!("PTY request failed: {}", e))?;
        channel.shell().map_err(|e| format!("Shell start failed: {}", e))?;

        Ok(Box::new(SshChannelImpl {
            channel,
            stream: tcp,
        }))
    }
}

/// Concrete SshChannel implementation wrapping ssh2::Channel and TcpStream
pub struct SshChannelImpl {
    channel: ssh2::Channel,
    stream: TcpStream,
}

impl SshChannel for SshChannelImpl {
    fn request_pty(&mut self, term: &str, _cols: u16, _rows: u16) -> Result<(), String> {
        self.channel
            .request_pty(term, None, None)
            .map_err(|e| e.to_string())
    }

    fn shell(&mut self) -> Result<(), String> {
        self.channel.shell().map_err(|e| e.to_string())
    }

    fn tcp_stream(&self) -> Box<dyn StreamIO> {
        Box::new(self.stream.try_clone().map_err(|e| e.to_string()).unwrap())
    }
}

impl Read for SshChannelImpl {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.channel.read(buf)
    }
}

impl Write for SshChannelImpl {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.channel.write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.channel.flush()
    }
}

/// SSH session wrapper
pub struct SshSessionWrapper {
    pub info: SessionInfo,
    pub channel: Arc<Mutex<Box<dyn SshChannel + Send>>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_auth_password_serialization() {
        let auth = SSHAuth::Password { password: "secret".to_string() };
        let json = serde_json::to_string(&auth).unwrap();
        assert!(json.contains("password"));
        assert!(json.contains("secret"));
    }

    #[test]
    fn ssh_auth_keyfile_serialization() {
        let auth = SSHAuth::KeyFile {
            key_file: "/path/to/key".to_string(),
            passphrase: Some("pass".to_string()),
        };
        let json = serde_json::to_string(&auth).unwrap();
        assert!(json.contains("key"));
        assert!(json.contains("/path/to/key"));
    }
}
