use std::sync::{mpsc as sync_mpsc, Arc};
use std::thread;

use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg, PublicKey};
use russh::CryptoVec;
use tokio::runtime::Builder;
use tokio::sync::mpsc;

use crate::error::StringError;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::default_pty_size;
use crate::models::session::{SSHAuth, SSHSessionConfig, SessionInfo, SessionType};

/// Default terminal type requested for SSH PTY sessions.
const DEFAULT_TERMINAL_TYPE: &str = "xterm";

/// Marker trait for SSH channel handles.
pub trait SshChannel: Send {}

/// Backend capable of establishing an SSH connection.
pub trait SshBackend: Send {
    /// Connect to `host:port` as `username` using the provided `auth` method.
    ///
    /// On success, returns the I/O channels needed to drive the session.
    fn connect(
        &self,
        host: &str,
        port: u16,
        auth: &SSHAuth,
        username: &str,
    ) -> Result<SshConnectResult, String>;

    fn connect_exec(
        &self,
        host: &str,
        port: u16,
        auth: &SSHAuth,
        username: &str,
        command: &str,
    ) -> Result<SshConnectResult, String>;
}

/// Result of an SSH connection, containing both the channel (for trait compliance)
/// and the direct I/O channels that bypass Mutex contention.
pub struct SshConnectResult {
    pub channel: Box<dyn SshChannel + Send>,
    pub write_tx: mpsc::UnboundedSender<Vec<u8>>,
    pub read_rx: sync_mpsc::Receiver<Option<Vec<u8>>>,
}

/// Holds the metadata and write channel for an established SSH session.
pub struct SshSessionWrapper {
    pub info: SessionInfo,
    pub write_tx: mpsc::UnboundedSender<Vec<u8>>,
}

/// russh client handler that accepts any server host key.
///
/// WARNING: This disables host key verification and should be replaced with
/// proper host key checking before production use.
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

/// SSH backend implemented on top of the `russh` crate.
pub struct RusshBackend;

impl RusshBackend {
    /// Create a new russh-based SSH backend.
    pub fn new() -> Self {
        Self
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
        connect_ssh(host, port, auth, username, None)
    }

    fn connect_exec(
        &self,
        host: &str,
        port: u16,
        auth: &SSHAuth,
        username: &str,
        command: &str,
    ) -> Result<SshConnectResult, String> {
        connect_ssh(host, port, auth, username, Some(command))
    }
}

/// Spawn a dedicated thread that runs an async russh connection.
///
/// The thread communicates back through `result_tx` (success/failure of the
/// initial handshake) and `read_tx` (incoming SSH channel data).
fn connect_ssh(
    host: &str,
    port: u16,
    auth: &SSHAuth,
    username: &str,
    command: Option<&str>,
) -> Result<SshConnectResult, String> {
    let (result_tx, result_rx) = sync_mpsc::channel::<Result<(), String>>();
    let (read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
    let (write_tx, mut write_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    let host = host.to_string();
    let username = username.to_string();
    let auth_clone = auth.clone();
    let command = command.map(|c| c.to_string());

    thread::spawn(move || {
        let rt = Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to create Tokio runtime for SSH connection");

        rt.block_on(async move {
            let result = run_ssh_session(
                &host,
                port,
                &username,
                &auth_clone,
                command.as_deref(),
                &result_tx,
                &read_tx,
                &mut write_rx,
            )
            .await;

            let _ = result;
        });
    });

    result_rx
        .recv()
        .map_err(|_| "SSH connection thread panicked before handshake".to_string())??;

    Ok(SshConnectResult {
        channel: Box::new(BridgedChannel),
        write_tx,
        read_rx,
    })
}

/// Run the full SSH session lifecycle: connect, authenticate, request PTY/shell,
/// then forward data until the channel closes.
#[allow(clippy::too_many_arguments)]
async fn run_ssh_session(
    host: &str,
    port: u16,
    username: &str,
    auth: &SSHAuth,
    command: Option<&str>,
    result_tx: &sync_mpsc::Sender<Result<(), String>>,
    read_tx: &sync_mpsc::Sender<Option<Vec<u8>>>,
    write_rx: &mut mpsc::UnboundedReceiver<Vec<u8>>,
) -> Result<(), String> {
    let config = Arc::new(russh::client::Config {
        ..Default::default()
    });

    let mut handle = russh::client::connect(config, (host, port), ClientHandler)
        .await
        .map_err(|e| format!("SSH connection to {}:{} failed: {}", host, port, e))?;

    authenticate(&mut handle, username, auth)
        .await
        .map_err(|e| format!("SSH authentication failed for {}@{}: {}", username, host, e))?;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open SSH session channel: {}", e))?;

    let pty_size = default_pty_size();
    channel
        .request_pty(
            false,
            DEFAULT_TERMINAL_TYPE,
            u32::from(pty_size.cols),
            u32::from(pty_size.rows),
            u32::from(pty_size.pixel_width),
            u32::from(pty_size.pixel_height),
            &[],
        )
        .await
        .map_err(|e| format!("SSH PTY request failed: {}", e))?;

    if let Some(command) = command {
        channel
            .exec(false, command)
            .await
            .map_err(|e| format!("SSH exec failed: {}", e))?;
    } else {
        channel
            .request_shell(false)
            .await
            .map_err(|e| format!("SSH shell request failed: {}", e))?;
    }

    result_tx.send(Ok(())).ok();

    run_data_loop(&mut handle, &mut channel, read_tx, write_rx).await;
    Ok(())
}

/// Authenticate the SSH session using either a password or a private key.
async fn authenticate(
    handle: &mut russh::client::Handle<ClientHandler>,
    username: &str,
    auth: &SSHAuth,
) -> Result<(), String> {
    match auth {
        SSHAuth::Password { password } => {
            let ok = handle
                .authenticate_password(username, password)
                .await
                .map_err_string()?
                .success();
            if !ok {
                return Err("password authentication rejected".to_string());
            }
        }
        SSHAuth::KeyFile { key_file, passphrase } => {
            let key_data = std::fs::read_to_string(key_file)
                .map_err(|e| format!("failed to read key file '{}': {}", key_file, e))?;
            let key = decode_secret_key(&key_data, passphrase.as_deref())
                .map_err(|e| format!("failed to decode key '{}': {}", key_file, e))?;
            let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), None);
            let ok = handle
                .authenticate_publickey(username, key_with_hash)
                .await
                .map_err_string()?
                .success();
            if !ok {
                return Err("public key authentication rejected".to_string());
            }
        }
    }
    Ok(())
}

/// Forward data between the SSH channel and the local I/O channels until the
/// session ends.
async fn run_data_loop(
    handle: &mut russh::client::Handle<ClientHandler>,
    channel: &mut russh::Channel<russh::client::Msg>,
    read_tx: &sync_mpsc::Sender<Option<Vec<u8>>>,
    write_rx: &mut mpsc::UnboundedReceiver<Vec<u8>>,
) {
    let channel_id = channel.id();
    loop {
        tokio::select! {
            msg = channel.wait() => {
                match msg {
                    Some(russh::ChannelMsg::Data { data }) => {
                        read_tx.send(Some(data.as_ref().to_vec())).ok();
                    }
                    Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                        read_tx.send(Some(data.as_ref().to_vec())).ok();
                    }
                    Some(russh::ChannelMsg::Eof)
                    | Some(russh::ChannelMsg::Close)
                    | None => {
                        read_tx.send(None).ok();
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
}

/// Empty channel implementation used to satisfy the [`SshChannel`] trait.
struct BridgedChannel;

impl SshChannel for BridgedChannel {}

/// Create an SSH session and start a thread that forwards channel output to the
/// frontend.
pub fn create_ssh_session(
    ssh_backend: &dyn SshBackend,
    config: SSHSessionConfig,
    backend: impl AppBackend + 'static,
    session_id: u32,
) -> Result<SshSessionWrapper, String> {
    let SshConnectResult { channel: _channel, write_tx, read_rx } =
        ssh_backend.connect(&config.host, config.port, &config.auth, &config.username)?;

    // Keep the channel alive for the lifetime of the session. It is never used
    // directly because reads/writes go through the dedicated channels above.
    let _channel = Arc::new(std::sync::Mutex::new(_channel));

    let info = SessionInfo {
        id: session_id,
        name: format!("{}@{}", config.username, config.host),
        session_type: SessionType::Ssh {
            host: config.host,
            port: config.port,
            user: config.username,
        },
        is_connected: true,
    };

    let wrapper = SshSessionWrapper { info, write_tx };

    let backend_clone = backend.clone();
    thread::spawn(move || {
        loop {
            match read_rx.recv() {
                Ok(Some(data)) => {
                    let payload = serde_json::to_vec(&(session_id, &data[..])).unwrap();
                    if let Err(e) = backend_clone.emit("session-output", &payload) {
                        eprintln!("Failed to emit SSH output for session {}: {}", session_id, e);
                        break;
                    }
                }
                Ok(None) | Err(_) => {
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
