use std::io::{Read, Write};
use std::sync::{Arc, mpsc as sync_mpsc};
use std::thread;

use russh::keys::{PublicKey, PrivateKeyWithHashAlg, decode_secret_key};
use russh::CryptoVec;
use tokio::runtime::Builder;
use tokio::sync::mpsc;

use crate::session::{AppBackend, SSHAuth, SSHSessionConfig, SessionInfo, SessionType};

pub trait StreamIO: Read + Write + Send + Sync {}
impl<T: Read + Write + Send + Sync> StreamIO for T {}

pub trait SshChannel: Read + Write + Send {
    fn request_pty(&mut self, term: &str, cols: u16, rows: u16) -> Result<(), String>;
    fn shell(&mut self) -> Result<(), String>;
    fn tcp_stream(&self) -> Box<dyn StreamIO>;
}

/// Result of an SSH connection, containing both the channel (for trait compliance)
/// and the direct I/O channels that bypass Mutex contention.
pub struct SshConnectResult {
    pub channel: Box<dyn SshChannel + Send>,
    pub write_tx: mpsc::UnboundedSender<Vec<u8>>,
    pub read_rx: sync_mpsc::Receiver<Option<Vec<u8>>>,
}

pub trait SshBackend: Send {
    fn connect(
        &self,
        host: &str,
        port: u16,
        auth: &SSHAuth,
        username: &str,
    ) -> Result<SshConnectResult, String>;
}

struct ClientHandler;

impl russh::client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

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
    ) -> Result<SshConnectResult, String> {
        // std::sync::mpsc for result - safe to recv() inside any runtime
        let (result_tx, result_rx) = sync_mpsc::channel::<Result<(), String>>();
        // std::sync::mpsc for read - async loop sends, blocking recv in read thread
        let (read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
        // tokio::sync::mpsc for write - sync send from Tauri, async recv in I/O loop
        let (write_tx, mut write_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        let host = host.to_string();
        let username = username.to_string();
        let auth_clone = auth.clone();

        // Spawn a thread with its own runtime that stays alive for the session lifetime
        thread::spawn(move || {
            let rt = Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("Failed to create runtime");

            rt.block_on(async move {
                let config = russh::client::Config {
                    ..Default::default()
                };
                let config = Arc::new(config);

                let mut handle = match russh::client::connect(config, (host.as_str(), port), ClientHandler).await {
                    Ok(h) => h,
                    Err(e) => {
                        let _ = result_tx.send(Err(format!("SSH connection failed: {}", e)));
                        return;
                    }
                };

                let auth_ok = match &auth_clone {
                    SSHAuth::Password { password } => {
                        handle.authenticate_password(&username, password).await
                            .map(|r| r.success())
                            .map_err(|e| format!("SSH auth error: {}", e))
                    }
                    SSHAuth::KeyFile { key_file, passphrase } => {
                        let key_data = match std::fs::read_to_string(key_file) {
                            Ok(d) => d,
                            Err(e) => {
                                let _ = result_tx.send(Err(format!("Failed to read key file: {}", e)));
                                return;
                            }
                        };
                        let key = match decode_secret_key(&key_data, passphrase.as_deref()) {
                            Ok(k) => k,
                            Err(e) => {
                                let _ = result_tx.send(Err(format!("Failed to decode key: {}", e)));
                                return;
                            }
                        };
                        let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), None);
                        handle.authenticate_publickey(&username, key_with_hash).await
                            .map(|r| r.success())
                            .map_err(|e| format!("SSH auth error: {}", e))
                    }
                };

                match auth_ok {
                    Ok(true) => {}
                    Ok(false) => {
                        let _ = result_tx.send(Err("SSH authentication failed".to_string()));
                        return;
                    }
                    Err(e) => {
                        let _ = result_tx.send(Err(e));
                        return;
                    }
                }

                let mut channel = match handle.channel_open_session().await {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = result_tx.send(Err(format!("Failed to open channel: {}", e)));
                        return;
                    }
                };

                if let Err(e) = channel.request_pty(false, "xterm", 80, 24, 0, 0, &[]).await {
                    let _ = result_tx.send(Err(format!("PTY request failed: {}", e)));
                    return;
                }

                if let Err(e) = channel.request_shell(false).await {
                    let _ = result_tx.send(Err(format!("Shell start failed: {}", e)));
                    return;
                }

                // Signal connection success - thread keeps running after this
                let _ = result_tx.send(Ok(()));

                // I/O loop - keeps runtime alive for the entire session
                let channel_id = channel.id();
                loop {
                    tokio::select! {
                        msg = channel.wait() => {
                            match msg {
                                Some(russh::ChannelMsg::Data { data }) => {
                                    let _ = read_tx.send(Some(data.as_ref().to_vec()));
                                }
                                Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                                    let _ = read_tx.send(Some(data.as_ref().to_vec()));
                                }
                                Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => {
                                    let _ = read_tx.send(None);
                                    break;
                                }
                                _ => {}
                            }
                        }
                        data = write_rx.recv() => {
                            match data {
                                Some(d) => {
                                    if handle.data(channel_id, CryptoVec::from_slice(&d)).await.is_err() {
                                        break;
                                    }
                                }
                                None => break,
                            }
                        }
                    }
                }
            });
        });

        // Wait for connection result (blocks briefly, then returns)
        result_rx.recv().map_err(|_| "SSH thread panicked")??;

        // BridgedChannel is kept for SshChannel trait compliance during initial setup,
        // but runtime I/O uses write_tx/read_rx directly (no Mutex contention)
        let bridged = BridgedChannel {
            write_tx: write_tx.clone(),
        };

        Ok(SshConnectResult {
            channel: Box::new(bridged),
            write_tx,
            read_rx,
        })
    }
}

struct BridgedChannel {
    write_tx: mpsc::UnboundedSender<Vec<u8>>,
}

impl SshChannel for BridgedChannel {
    fn request_pty(&mut self, _term: &str, _cols: u16, _rows: u16) -> Result<(), String> {
        Ok(())
    }

    fn shell(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn tcp_stream(&self) -> Box<dyn StreamIO> {
        Box::new(DummyStream {})
    }
}

impl Read for BridgedChannel {
    fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
        // Runtime reads use read_rx directly via blocking recv, not this trait method.
        Err(std::io::Error::new(std::io::ErrorKind::WouldBlock, "use direct recv"))
    }
}

impl Write for BridgedChannel {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        // Runtime writes use write_tx directly, not this trait method.
        // This impl is kept for trait compliance and fallback.
        if self.write_tx.send(buf.to_vec()).is_err() {
            return Err(std::io::Error::new(std::io::ErrorKind::BrokenPipe, "Channel closed"));
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

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

pub struct SshSessionWrapper {
    pub info: SessionInfo,
    pub channel: Arc<std::sync::Mutex<Box<dyn SshChannel + Send>>>,
    /// Direct write path — bypasses the Mutex entirely.
    /// UnboundedSender is thread-safe, no lock needed for keystroke writes.
    pub write_tx: mpsc::UnboundedSender<Vec<u8>>,
}

pub struct SshSessionHandles;

pub fn create_ssh_session(
    ssh_backend: &dyn SshBackend,
    config: SSHSessionConfig,
    backend: impl AppBackend + 'static,
    session_id: u32,
) -> Result<SshSessionWrapper, String> {
    let SshConnectResult { channel, write_tx, read_rx } = ssh_backend.connect(
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

    let channel_arc = Arc::new(std::sync::Mutex::new(channel));
    let wrapper = SshSessionWrapper {
        info,
        channel: channel_arc.clone(),
        write_tx,
    };

    let backend_clone = backend.clone();

    // Read thread uses blocking recv() on read_rx — no polling, no Mutex.
    // This eliminates the 10ms sleep overhead and Mutex contention entirely.
    thread::spawn(move || {
        loop {
            match read_rx.recv() {
                Ok(Some(data)) => {
                    let payload = serde_json::to_vec(&(&session_id, &data[..])).unwrap();
                    if let Err(_e) = backend_clone.emit("session-output", &payload) {
                        break;
                    }
                }
                Ok(None) => {
                    let payload = serde_json::to_vec(&session_id).unwrap();
                    let _ = backend_clone.emit("session-closed", &payload);
                    break;
                }
                Err(_) => {
                    // Channel disconnected — sender (async I/O loop) dropped
                    let payload = serde_json::to_vec(&session_id).unwrap();
                    let _ = backend_clone.emit("session-closed", &payload);
                    break;
                }
            }
        }
    });

    Ok(wrapper)
}

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