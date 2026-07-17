use std::sync::{mpsc as sync_mpsc, Arc};
use std::thread;

use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg, PublicKey};
use russh::CryptoVec;
use tokio::runtime::Builder;
use tokio::sync::mpsc;

use crate::error::StringError;
use crate::infrastructure::pty::default_pty_size;
use crate::models::session::{SSHAuth, SSHSessionConfig, SessionInfo, SystemConfig};

/// Default terminal type requested for SSH PTY sessions.
const DEFAULT_TERMINAL_TYPE: &str = "xterm";

/// Resolve the terminal type to request for a PTY from the system configuration.
pub(crate) fn pty_terminal_type(system: &SystemConfig) -> &str {
    if system.terminal_type.is_empty() {
        DEFAULT_TERMINAL_TYPE
    } else {
        &system.terminal_type
    }
}

/// Marker trait for SSH channel handles.
pub trait SshChannel: Send {}

/// Backend capable of establishing an SSH connection.
pub trait SshBackend: Send {
    /// Connect to `host:port` as `username` using the provided `auth` method and
    /// `system` configuration.
    ///
    /// On success, returns the I/O channels needed to drive the session.
    fn connect(
        &self,
        host: &str,
        port: u16,
        auth: &SSHAuth,
        username: &str,
        system: &SystemConfig,
    ) -> Result<SshConnectResult, String>;
}

/// Result of an SSH connection, containing both the channel (for trait compliance)
/// and the direct I/O channels that bypass Mutex contention.
pub struct SshConnectResult {
    pub channel: Box<dyn SshChannel + Send>,
    pub write_tx: mpsc::UnboundedSender<Vec<u8>>,
    pub read_rx: sync_mpsc::Receiver<Option<Vec<u8>>>,
    pub resize_tx: Option<mpsc::UnboundedSender<(u16, u16)>>,
}

/// Holds the metadata and write channel for an established SSH session.
pub struct SshSessionWrapper {
    pub info: SessionInfo,
    pub write_tx: mpsc::UnboundedSender<Vec<u8>>,
    pub resize_tx: Option<mpsc::UnboundedSender<(u16, u16)>>,
    pub config: SSHSessionConfig,
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
        system: &SystemConfig,
    ) -> Result<SshConnectResult, String> {
        connect_ssh(host, port, auth, username, system)
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
    system: &SystemConfig,
) -> Result<SshConnectResult, String> {
    let (result_tx, result_rx) = sync_mpsc::channel::<Result<(), String>>();
    let (read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
    let (write_tx, mut write_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (resize_tx, resize_rx) = {
        let (tx, rx) = mpsc::unbounded_channel::<(u16, u16)>();
        (Some(tx), Some(rx))
    };

    let host = host.to_string();
    let username = username.to_string();
    let auth_clone = auth.clone();
    let system_clone = system.clone();

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
                &system_clone,
                &result_tx,
                &read_tx,
                &mut write_rx,
                resize_rx,
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
        resize_tx,
    })
}

/// Run the full SSH session lifecycle: connect, authenticate, request PTY/shell,
/// then forward data until the channel closes.
///
/// SSH-level system-config limitations:
/// - `terminal_type` is applied through the SSH PTY request (`TERM`).
/// - `charset` cannot be enforced by the SSH layer; encoding is handled by the terminal renderer.
/// - `newline` cannot be enforced by the SSH layer; it depends on the remote shell/termios line discipline.
/// - `backspace` and `delete` cannot be enforced by the SSH layer; they are termios or terminal-renderer key mappings.
/// - `mouse_scroll` cannot be enforced by the SSH layer; it is an xterm/terminal-renderer mouse mode.
/// - `signal_key` cannot be enforced by the SSH layer; it is a terminal-renderer key binding (e.g., Ctrl+C).
#[allow(clippy::too_many_arguments)]
async fn run_ssh_session(
    host: &str,
    port: u16,
    username: &str,
    auth: &SSHAuth,
    system: &SystemConfig,
    result_tx: &sync_mpsc::Sender<Result<(), String>>,
    read_tx: &sync_mpsc::Sender<Option<Vec<u8>>>,
    write_rx: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    resize_rx: Option<mpsc::UnboundedReceiver<(u16, u16)>>,
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

    let terminal_type = pty_terminal_type(system);
    let pty_size = default_pty_size();
    channel
        .request_pty(
            true,
            terminal_type,
            u32::from(pty_size.cols),
            u32::from(pty_size.rows),
            u32::from(pty_size.pixel_width),
            u32::from(pty_size.pixel_height),
            &[],
        )
        .await
        .map_err(|e| format!("SSH PTY request failed: {}", e))?;

    channel
        .request_shell(true)
        .await
        .map_err(|e| format!("SSH shell request failed: {}", e))?;

    result_tx.send(Ok(())).ok();
    tracing::info!("SSH session established, entering data loop");

    run_data_loop(&mut handle, &mut channel, read_tx, write_rx, resize_rx).await;
    tracing::info!("SSH data loop ended");
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

/// Process a message received from the SSH channel. Returns `true` when the
/// data loop should terminate.
async fn handle_channel_msg(
    msg: Option<russh::ChannelMsg>,
    read_tx: &sync_mpsc::Sender<Option<Vec<u8>>>,
) -> bool {
    match msg {
        Some(russh::ChannelMsg::Data { data }) => {
            read_tx.send(Some(data.as_ref().to_vec())).ok();
            false
        }
        Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
            read_tx.send(Some(data.as_ref().to_vec())).ok();
            false
        }
        Some(russh::ChannelMsg::Eof) => {
            tracing::info!("SSH channel received EOF");
            read_tx.send(None).ok();
            true
        }
        Some(russh::ChannelMsg::Close) => {
            tracing::info!("SSH channel received Close");
            read_tx.send(None).ok();
            true
        }
        None => {
            tracing::info!("SSH channel wait returned None");
            read_tx.send(None).ok();
            true
        }
        _ => false,
    }
}

/// Forward data from the local write channel to the SSH channel. Returns `true`
/// when the data loop should terminate.
async fn forward_write_data(
    handle: &mut russh::client::Handle<ClientHandler>,
    channel_id: russh::ChannelId,
    data: Option<Vec<u8>>,
) -> bool {
    match data {
        Some(d) => {
            if handle.data(channel_id, CryptoVec::from_slice(&d)).await.is_err() {
                tracing::error!("SSH channel data send failed");
                true
            } else {
                false
            }
        }
        None => {
            tracing::info!("SSH write channel closed");
            true
        }
    }
}

/// Forward data between the SSH channel and the local I/O channels until the
/// session ends.
async fn run_data_loop(
    handle: &mut russh::client::Handle<ClientHandler>,
    channel: &mut russh::Channel<russh::client::Msg>,
    read_tx: &sync_mpsc::Sender<Option<Vec<u8>>>,
    write_rx: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    mut resize_rx: Option<mpsc::UnboundedReceiver<(u16, u16)>>,
) {
    let channel_id = channel.id();
    loop {
        tokio::select! {
            msg = channel.wait() => {
                if handle_channel_msg(msg, read_tx).await {
                    break;
                }
            }
            data = write_rx.recv() => {
                if forward_write_data(handle, channel_id, data).await {
                    break;
                }
            }
            resize = resize_rx.as_mut().unwrap().recv(), if resize_rx.is_some() => {
                match resize {
                    Some((cols, rows)) => {
                        if channel.window_change(u32::from(cols), u32::from(rows), 0, 0).await.is_ok() {
                            tracing::info!("SSH PTY resized to {}x{}", cols, rows);
                        }
                    }
                    None => {
                        tracing::info!("SSH resize channel closed");
                        resize_rx = None;
                    }
                }
            }
        }
    }
}

/// Empty channel implementation used to satisfy the [`SshChannel`] trait.
struct BridgedChannel;

impl SshChannel for BridgedChannel {}

/// Execute an SSH command that receives `stdin_data` and waits for its exit status.
///
/// Establishes a fresh SSH connection, authenticates, opens a session channel,
/// runs `command`, sends `stdin_data` to stdin, signals EOF, and returns when the
/// remote process exits. Returns `Ok(())` only if `exit_status == 0`.
async fn exec_ssh_command(
    config: &SSHSessionConfig,
    command: &str,
    stdin_data: Vec<u8>,
) -> Result<(), String> {
    let ssh_config = Arc::new(russh::client::Config {
        ..Default::default()
    });

    let mut handle = russh::client::connect(
        ssh_config,
        (config.host.clone(), config.port),
        ClientHandler,
    )
    .await
    .map_err(|e| format!("SSH connection to {}:{} failed: {}", config.host, config.port, e))?;

    authenticate(&mut handle, &config.username, &config.auth).await?;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open SSH session channel: {}", e))?;

    channel
        .exec(true, command)
        .await
        .map_err(|e| format!("SSH exec failed: {}", e))?;

    if !stdin_data.is_empty() {
        channel
            .data(&stdin_data[..])
            .await
            .map_err(|e| format!("Failed to send stdin data: {}", e))?;
    }

    channel
        .eof()
        .await
        .map_err(|e| format!("Failed to close stdin: {}", e))?;

    loop {
        match channel.wait().await {
            Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                if exit_status != 0 {
                    return Err(format!(
                        "Remote command exited with status {}",
                        exit_status
                    ));
                }
                break;
            }
            Some(russh::ChannelMsg::Close)
            | Some(russh::ChannelMsg::Eof)
            | None => break,
            _ => {}
        }
    }

    let _ = channel.close().await;
    Ok(())
}

/// Upload `data` to `remote_path` on the server identified by `config` using a
/// fresh SSH exec channel (`cat > remote_path`).
pub async fn upload_file_via_ssh(
    config: &SSHSessionConfig,
    remote_path: &str,
    data: Vec<u8>,
) -> Result<(), String> {
    let command = format!("cat > {}", remote_path);
    exec_ssh_command(config, &command, data).await
}

pub use RusshBackend as SshBackendImpl;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pty_terminal_type_uses_configured_value() {
        let system = SystemConfig {
            terminal_type: "xterm-256color".to_string(),
            ..Default::default()
        };
        assert_eq!(pty_terminal_type(&system), "xterm-256color");
    }

    #[test]
    fn pty_terminal_type_falls_back_to_default() {
        let system = SystemConfig {
            terminal_type: String::new(),
            ..Default::default()
        };
        assert_eq!(pty_terminal_type(&system), "xterm");
    }
}
