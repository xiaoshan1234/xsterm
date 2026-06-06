use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use russh::keys::{PublicKey, PrivateKeyWithHashAlg, decode_secret_key};
use tokio::io::{AsyncWriteExt};
use tokio::runtime::Builder;
use tokio::sync::mpsc;

use crate::session::{AppBackend, SSHAuth, SSHSessionConfig, SessionInfo, SessionType};

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

// ============================================================================
// Russh client handler
// ============================================================================

struct ClientHandler;

impl russh::client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        // Trust all server keys for now
        Ok(true)
    }
}

// ============================================================================
// RusshBackend - SshBackend implementation using russh
// ============================================================================

pub struct RusshBackend {
    _phantom: std::marker::PhantomData<()>,
}

impl RusshBackend {
    pub fn new() -> Self {
        Self {
            _phantom: std::marker::PhantomData,
        }
    }
}

impl SshBackend for RusshBackend {
    fn connect(
        &self,
        host: &str,
        port: u16,
        auth: &SSHAuth,
        username: &str,
    ) -> Result<Box<dyn SshChannel + Send>, String> {
        // Use std::sync::mpsc for result channel - safe to recv() inside any runtime
        let (result_tx, result_rx) = std::sync::mpsc::channel::<Result<(russh::client::Handle<ClientHandler>, russh::Channel<russh::client::Msg>), String>>();

        // Create tokio channels for the SSH data bridge
        let (write_tx, write_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        // Clone data needed for the thread
        let host = host.to_string();
        let username = username.to_string();
        let auth_clone = auth.clone();

        // Spawn a thread with its own runtime - avoids runtime-in-runtime panic
        thread::spawn(move || {
            let rt = Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("Failed to create runtime");

            let result = rt.block_on(async move {
                let config = russh::client::Config {
                    ..Default::default()
                };
                let config = Arc::new(config);

                let mut handle = match russh::client::connect(config, (host.as_str(), port), ClientHandler).await {
                    Ok(h) => h,
                    Err(e) => {
                        return Err(format!("SSH connection failed: {}", e));
                    }
                };

                // Authenticate
                let auth_result = match &auth_clone {
                    SSHAuth::Password { password } => {
                        handle.authenticate_password(&username, password).await
                    }
                    SSHAuth::KeyFile { key_file, passphrase } => {
                        let key_data = match std::fs::read_to_string(key_file) {
                            Ok(d) => d,
                            Err(e) => {
                                return Err(format!("Failed to read key file: {}", e));
                            }
                        };
                        let key = match decode_secret_key(&key_data, passphrase.as_deref()) {
                            Ok(k) => k,
                            Err(e) => {
                                return Err(format!("Failed to decode key: {}", e));
                            }
                        };
                        let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), None);
                        handle.authenticate_publickey(&username, key_with_hash).await
                    }
                };

                if !auth_result.map_err(|e| format!("SSH auth error: {}", e)).map(|r| r.success()).unwrap_or(false) {
                    return Err("SSH authentication failed".to_string());
                }

                // Open channel
                let channel = match handle.channel_open_session().await {
                    Ok(c) => c,
                    Err(e) => {
                        return Err(format!("Failed to open channel: {}", e));
                    }
                };

                // Request PTY and shell
                if let Err(e) = channel.request_pty(false, "xterm", 80, 24, 0, 0, &[]).await {
                    return Err(format!("PTY request failed: {}", e));
                }

                if let Err(e) = channel.request_shell(false).await {
                    return Err(format!("Shell start failed: {}", e));
                }

                Ok((handle, channel))
            });

            let _ = result_tx.send(result);
        });

        // Use std::sync::mpsc::recv() - safe to call from within an async runtime
        let (handle, channel) = result_rx
            .recv()
            .map_err(|_| "SSH connection thread panicked")??;

        // Create bridged channel with the channel and handle
        let bridged = BridgedChannel::new(handle, channel, write_tx, write_rx);

        Ok(Box::new(bridged))
    }
}

// ============================================================================
// BridgedChannel - bridges async russh channel to sync Read/Write
// ============================================================================

struct BridgedChannel {
    read_rx: Arc<Mutex<mpsc::UnboundedReceiver<Vec<u8>>>>,
    read_tx: Arc<Mutex<mpsc::UnboundedSender<Vec<u8>>>>,
    write_tx: Arc<Mutex<mpsc::UnboundedSender<Vec<u8>>>>,
    shutdown: Arc<tokio::sync::Mutex<bool>>,
}

impl BridgedChannel {
    fn new(
        _handle: russh::client::Handle<ClientHandler>,
        channel: russh::Channel<russh::client::Msg>,
        write_tx: mpsc::UnboundedSender<Vec<u8>>,
        write_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    ) -> Self {
        let (read_tx, read_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let read_tx_clone = read_tx.clone();
        let shutdown = Arc::new(tokio::sync::Mutex::new(false));

        let shutdown_flag = shutdown.clone();
        tokio::spawn(async move {
            let mut channel = channel;
            let mut write_rx = write_rx;

            loop {
                if *shutdown_flag.lock().await {
                    break;
                }

                tokio::select! {
                    msg = channel.wait() => {
                        match msg {
                            Some(russh::ChannelMsg::Data { data }) => {
                                let data_vec = data.as_ref().to_vec();
                                if read_tx_clone.send(data_vec).is_err() {
                                    break;
                                }
                            }
                            Some(russh::ChannelMsg::ExtendedData { .. }) => {
                            }
                            Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => {
                                let _ = read_tx_clone.send(Vec::new());
                                break;
                            }
                            _ => {}
                        }
                    }
                    data = write_rx.recv() => {
                        match data {
                            Some(d) => {
                                if d.is_empty() {
                                    break;
                                }
                                let mut writer = channel.make_writer();
                                if writer.write_all(&d).await.is_err() {
                                    break;
                                }
                            }
                            None => break,
                        }
                    }
                }
            }
        });

        Self {
            read_rx: Arc::new(Mutex::new(read_rx)),
            read_tx: Arc::new(Mutex::new(read_tx)),
            write_tx: Arc::new(Mutex::new(write_tx)),
            shutdown,
        }
    }
}

impl SshChannel for BridgedChannel {
    fn request_pty(&mut self, _term: &str, _cols: u16, _rows: u16) -> Result<(), String> {
        // PTY is already requested during connect
        Ok(())
    }

    fn shell(&mut self) -> Result<(), String> {
        // Shell is already started during connect
        Ok(())
    }

    fn tcp_stream(&self) -> Box<dyn StreamIO> {
        // russh doesn't provide direct TCP stream access in the same way
        // Return a dummy implementation that satisfies the trait
        Box::new(DummyStream {})
    }
}

impl Read for BridgedChannel {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        // Try to get data from the read channel
        let mut rx = self.read_rx.lock().unwrap();

        // Use try_recv to avoid blocking - if no data available, return WouldBlock
        match rx.try_recv() {
            Ok(data) => {
                if data.is_empty() {
                    return Ok(0);
                }
                let len = data.len().min(buf.len());
                buf[..len].copy_from_slice(&data[..len]);
                Ok(len)
            }
            Err(mpsc::error::TryRecvError::Empty) => {
                // No data available yet - this is non-blocking read
                // For compatibility, return WouldBlock
                std::io::Result::Err(std::io::Error::new(
                    std::io::ErrorKind::WouldBlock,
                    "no data available",
                ))
            }
            Err(mpsc::error::TryRecvError::Disconnected) => Ok(0),
        }
    }
}

impl Write for BridgedChannel {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let tx = self.write_tx.lock().unwrap();
        if tx.send(buf.to_vec()).is_err() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "Channel closed",
            ));
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        // russh writes are immediate, no flush needed
        Ok(())
    }
}

// Dummy stream for tcp_stream() - russh doesn't provide direct TCP
struct DummyStream;

impl Read for DummyStream {
    fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
        Ok(0)
    }
}

impl Write for DummyStream {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// SSH session wrapper
pub struct SshSessionWrapper {
    pub info: SessionInfo,
    pub channel: Arc<Mutex<Box<dyn SshChannel + Send>>>,
}

pub struct SshSessionHandles;

pub fn create_ssh_session(
    ssh_backend: &dyn SshBackend,
    config: SSHSessionConfig,
    backend: impl AppBackend + 'static,
    session_id: u32,
) -> Result<SshSessionWrapper, String> {
    let channel = ssh_backend.connect(
        &config.host,
        config.port,
        &config.auth,
        &config.username,
    )?;

    let name = format!("SSH {}@{}", config.username, config.host);
    let host_for_info = config.host.clone();
    let user_for_info = config.username.clone();

    let info = SessionInfo {
        id: session_id,
        name,
        session_type: SessionType::Ssh {
            host: host_for_info,
            port: config.port,
            user: user_for_info,
        },
        is_connected: true,
    };

    let channel_arc = Arc::new(Mutex::new(channel));
    let wrapper = SshSessionWrapper {
        info,
        channel: channel_arc.clone(),
    };

    let backend_clone = backend.clone();
    let channel_for_thread = channel_arc.clone();

    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match channel_for_thread.lock().unwrap().read(&mut buf) {
                Ok(0) => {
                    let payload = serde_json::to_vec(&session_id).unwrap();
                    let _ = backend_clone.emit("session-closed", &payload);
                    break;
                }
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    let payload = serde_json::to_vec(&(&session_id, &data[..])).unwrap();
                    if let Err(_e) = backend_clone.emit("session-output", &payload) {
                        break;
                    }
                }
                Err(e) => {
                    // WouldBlock is not an error
                    if e.kind() == std::io::ErrorKind::WouldBlock {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                        continue;
                    }
                    break;
                }
            }
        }
    });

    Ok(wrapper)
}

// Re-export for backwards compatibility
pub use RusshBackend as SshBackendImpl;

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
