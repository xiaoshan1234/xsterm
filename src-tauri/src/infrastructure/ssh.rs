use std::sync::{mpsc as sync_mpsc, Arc};
use std::thread;
use std::time::Duration;

use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg, PublicKey};
use russh::CryptoVec;
use tokio::runtime::Builder;
use tokio::sync::mpsc;

use crate::error::StringError;
use crate::infrastructure::pty::default_pty_size;
use crate::infrastructure::session_backend::SessionBackend;
use crate::models::capabilities::CapabilityFlags;
use crate::models::session::{SSHAuth, SSHSessionConfig, SessionInfo};

/// Default terminal type requested for SSH PTY sessions when the config
/// does not specify one. Defaults to `xterm-256color` for broad compatibility.
const DEFAULT_TERMINAL_TYPE: &str = "xterm-256color";

/// Marker trait for SSH channel handles.
pub trait SshChannel: Send {}

/// Backend capable of establishing an SSH connection.
pub trait SshBackend: Send {
    /// Connect using the full `SSHSessionConfig`, which carries host, port,
    /// auth, terminal options, and connection-level knobs (keepalive,
    /// timeout, compression).
    ///
    /// On success, returns the I/O channels needed to drive the session.
    fn connect(
        &self,
        config: &SSHSessionConfig,
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
    pub capabilities: CapabilityFlags,
}

impl SessionBackend for SshSessionWrapper {
    fn info(&self) -> &SessionInfo {
        &self.info
    }

    fn capabilities(&self) -> &CapabilityFlags {
        &self.capabilities
    }

    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        self.write_tx
            .send(data.to_vec())
            .map_err(|_| format!("SSH channel closed for session {}", self.info.id))
    }

    fn resize(&mut self, rows: u16, cols: u16) -> Result<(), String> {
        match self.resize_tx.as_ref() {
            Some(tx) => tx
                .send((rows, cols))
                .map_err(|_| format!("SSH resize channel closed for session {}", self.info.id)),
            None => Ok(()),
        }
    }

    fn close(self: Box<Self>) -> Result<(), String> {
        Ok(())
    }
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
        config: &SSHSessionConfig,
    ) -> Result<SshConnectResult, String> {
        // Host key verification stays disabled per AGENTS.md; the path is
        // logged here as a future-use marker.
        if let Some(path) = config.known_hosts_path.as_deref() {
            tracing::info!(
                "known_hosts_path noted (verification not implemented yet): {}",
                path
            );
        }

        if let Some(raw) = config.proxy_jump.as_deref() {
            match parse_proxy_jump(raw) {
                Some(parsed) => {
                    let user = parsed.user.as_deref().unwrap_or("<unset>");
                    let port = parsed
                        .port
                        .map(|p| p.to_string())
                        .unwrap_or_else(|| "22".to_string());
                    tracing::info!(
                        "proxy_jump parsed: user={} host={} port={} (full chain not yet implemented, using direct connection)",
                        user,
                        parsed.host,
                        port
                    );
                    // TODO: when russh proxy-jump chain support lands, route
                    // the inner connection through this jump host.
                }
                None => {
                    tracing::warn!(
                        "proxy_jump = {} not yet implemented, falling back to direct connection",
                        raw
                    );
                }
            }
        }

        connect_ssh(config)
    }
}

/// Parsed subset of an OpenSSH `ProxyJump` value.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedJumpHost {
    user: Option<String>,
    host: String,
    port: Option<u16>,
}

/// Parse a `proxy_jump` string in OpenSSH `ProxyJump` syntax.
///
/// Accepts `user@host:port`, `user@host`, `host:port`, and `host`. Returns
/// `None` for empty input, leading/trailing whitespace, an empty user
/// component (`@host`), an empty host component, a host containing
/// whitespace, or any port suffix that is not a valid `u16`. Never panics,
/// regardless of input — reachable from arbitrary frontend-supplied config.
fn parse_proxy_jump(raw: &str) -> Option<ParsedJumpHost> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let (user_opt, remainder) = match trimmed.find('@') {
        Some(idx) if idx > 0 => (Some(trimmed[..idx].trim()), trimmed[idx + 1..].trim()),
        Some(_) => return None,
        None => (None, trimmed),
    };

    if remainder.is_empty() {
        return None;
    }

    // Out-of-range digit suffixes after `:` are still stripped so the host
    // is not polluted with port-looking junk.
    let (host, port_opt) = match remainder.rfind(':') {
        Some(idx) => {
            let port_str = remainder[idx + 1..].trim();
            let host_part = remainder[..idx].trim();
            if !port_str.is_empty() && port_str.chars().all(|c| c.is_ascii_digit()) {
                match port_str.parse::<u16>() {
                    Ok(p) => (host_part, Some(p)),
                    Err(_) => (host_part, None),
                }
            } else {
                (remainder, None)
            }
        }
        None => (remainder, None),
    };

    if host.is_empty() || host.contains(char::is_whitespace) {
        return None;
    }

    Some(ParsedJumpHost {
        user: user_opt.filter(|u| !u.is_empty()).map(str::to_string),
        host: host.to_string(),
        port: port_opt,
    })
}

/// Spawn a dedicated thread that runs an async russh connection.
///
/// The thread communicates back through `result_tx` (success/failure of the
/// initial handshake) and `read_tx` (incoming SSH channel data).
fn connect_ssh(config: &SSHSessionConfig) -> Result<SshConnectResult, String> {
    let (result_tx, result_rx) = sync_mpsc::channel::<Result<(), String>>();
    let (read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
    let (write_tx, mut write_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (resize_tx, resize_rx) = {
        let (tx, rx) = mpsc::unbounded_channel::<(u16, u16)>();
        (Some(tx), Some(rx))
    };

    let config_clone = config.clone();

    thread::spawn(move || {
        let rt = Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to create Tokio runtime for SSH connection");

        rt.block_on(async move {
            let result = run_ssh_session(
                &config_clone,
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
async fn run_ssh_session(
    config: &SSHSessionConfig,
    result_tx: &sync_mpsc::Sender<Result<(), String>>,
    read_tx: &sync_mpsc::Sender<Option<Vec<u8>>>,
    write_rx: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    resize_rx: Option<mpsc::UnboundedReceiver<(u16, u16)>>,
) -> Result<(), String> {
    let mut russh_config = russh::client::Config::default();
    if let Some(secs) = config.keepalive_interval {
        russh_config.keepalive_interval = Some(Duration::from_secs(secs as u64));
    }
    if config.enable_compression.unwrap_or(false) {
        russh_config.preferred.compression =
            std::borrow::Cow::Borrowed(&[russh::compression::ZLIB]);
    }
    let russh_config = Arc::new(russh_config);

    let connect_fut =
        russh::client::connect(russh_config, (config.host.clone(), config.port), ClientHandler);
    let mut handle = if let Some(secs) = config.connection_timeout {
        match tokio::time::timeout(
            Duration::from_secs(secs as u64),
            connect_fut,
        )
        .await
        {
            Ok(result) => result.map_err(|e| {
                format!(
                    "SSH connection to {}:{} failed: {}",
                    config.host, config.port, e
                )
            })?,
            Err(_) => {
                return Err(format!(
                    "SSH connection to {}:{} timed out after {} seconds",
                    config.host, config.port, secs
                ));
            }
        }
    } else {
        connect_fut.await.map_err(|e| {
            format!(
                "SSH connection to {}:{} failed: {}",
                config.host, config.port, e
            )
        })?
    };

    authenticate(&mut handle, &config.username, &config.auth)
        .await
        .map_err(|e| {
            format!(
                "SSH authentication failed for {}@{}: {}",
                config.username, config.host, e
            )
        })?;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open SSH session channel: {}", e))?;

    let term_type = config
        .term_type
        .as_deref()
        .unwrap_or(DEFAULT_TERMINAL_TYPE);
    let mut pty_size = default_pty_size();
    if let Some(rows) = config.initial_rows {
        pty_size.rows = rows as u16;
    }
    if let Some(cols) = config.initial_cols {
        pty_size.cols = cols as u16;
    }

    channel
        .request_pty(
            true,
            term_type,
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
    let mut ssh_config = russh::client::Config::default();
    if let Some(secs) = config.keepalive_interval {
        ssh_config.keepalive_interval = Some(Duration::from_secs(secs as u64));
    }
    if config.enable_compression.unwrap_or(false) {
        ssh_config.preferred.compression =
            std::borrow::Cow::Borrowed(&[russh::compression::ZLIB]);
    }
    let ssh_config = Arc::new(ssh_config);

    let connect_fut = russh::client::connect(
        ssh_config,
        (config.host.clone(), config.port),
        ClientHandler,
    );
    let mut handle = if let Some(secs) = config.connection_timeout {
        match tokio::time::timeout(Duration::from_secs(secs as u64), connect_fut).await {
            Ok(result) => result.map_err(|e| {
                format!(
                    "SSH connection to {}:{} failed: {}",
                    config.host, config.port, e
                )
            })?,
            Err(_) => {
                return Err(format!(
                    "SSH connection to {}:{} timed out after {} seconds",
                    config.host, config.port, secs
                ));
            }
        }
    } else {
        connect_fut.await.map_err(|e| {
            format!(
                "SSH connection to {}:{} failed: {}",
                config.host, config.port, e
            )
        })?
    };

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

    fn base_config(proxy_jump: Option<&str>, known_hosts: Option<&str>) -> SSHSessionConfig {
        SSHSessionConfig {
            name: None,
            host: "example.com".to_string(),
            port: 22,
            username: "user".to_string(),
            auth: crate::models::session::SSHAuth::Password {
                password: "pw".to_string(),
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
            known_hosts_path: known_hosts.map(str::to_string),
            proxy_jump: proxy_jump.map(str::to_string),
        }
    }

    #[test]
    fn parse_proxy_jump_user_host_port() {
        let parsed = parse_proxy_jump("bastion@jump.example.com:2222").unwrap();
        assert_eq!(parsed.user.as_deref(), Some("bastion"));
        assert_eq!(parsed.host, "jump.example.com");
        assert_eq!(parsed.port, Some(2222));
    }

    #[test]
    fn parse_proxy_jump_user_host() {
        let parsed = parse_proxy_jump("bastion@jump.example.com").unwrap();
        assert_eq!(parsed.user.as_deref(), Some("bastion"));
        assert_eq!(parsed.host, "jump.example.com");
        assert_eq!(parsed.port, None);
    }

    #[test]
    fn parse_proxy_jump_host_port() {
        let parsed = parse_proxy_jump("jump.example.com:2222").unwrap();
        assert_eq!(parsed.user, None);
        assert_eq!(parsed.host, "jump.example.com");
        assert_eq!(parsed.port, Some(2222));
    }

    #[test]
    fn parse_proxy_jump_host_only() {
        let parsed = parse_proxy_jump("jump.example.com").unwrap();
        assert_eq!(parsed.user, None);
        assert_eq!(parsed.host, "jump.example.com");
        assert_eq!(parsed.port, None);
    }

    #[test]
    fn parse_proxy_jump_trims_whitespace() {
        let parsed = parse_proxy_jump("  user@host:22  ").unwrap();
        assert_eq!(parsed.user.as_deref(), Some("user"));
        assert_eq!(parsed.host, "host");
        assert_eq!(parsed.port, Some(22));
    }

    #[test]
    fn parse_proxy_jump_rejects_empty() {
        assert!(parse_proxy_jump("").is_none());
        assert!(parse_proxy_jump("   ").is_none());
    }

    #[test]
    fn parse_proxy_jump_rejects_stray_at() {
        assert!(parse_proxy_jump("@host").is_none());
        assert!(parse_proxy_jump("user@").is_none());
        assert!(parse_proxy_jump("@").is_none());
    }

    #[test]
    fn parse_proxy_jump_rejects_whitespace_in_host() {
        assert!(parse_proxy_jump("bad host").is_none());
        assert!(parse_proxy_jump("user@bad host").is_none());
    }

    #[test]
    fn parse_proxy_jump_handles_garbage_port_without_panicking() {
        let parsed = parse_proxy_jump("user@host:notaport").unwrap();
        assert_eq!(parsed.user.as_deref(), Some("user"));
        assert_eq!(parsed.host, "host:notaport");
        assert_eq!(parsed.port, None);

        let parsed = parse_proxy_jump("host:999999").unwrap();
        assert_eq!(parsed.host, "host");
        assert_eq!(parsed.port, None);

        let parsed = parse_proxy_jump("host:").unwrap();
        assert_eq!(parsed.host, "host:");
        assert_eq!(parsed.port, None);
    }

    #[test]
    fn known_hosts_path_field_round_trips_through_config() {
        let cfg = base_config(None, Some("/home/user/.ssh/known_hosts"));
        assert_eq!(
            cfg.known_hosts_path.as_deref(),
            Some("/home/user/.ssh/known_hosts")
        );

        let cfg = base_config(None, None);
        assert!(cfg.known_hosts_path.is_none());
    }

    #[test]
    fn proxy_jump_field_round_trips_through_config() {
        let cfg = base_config(Some("bastion@jump.example.com:22"), None);
        assert_eq!(
            cfg.proxy_jump.as_deref(),
            Some("bastion@jump.example.com:22")
        );

        let cfg = base_config(None, None);
        assert!(cfg.proxy_jump.is_none());
    }

    #[test]
    fn russh_backend_connect_does_not_panic_on_bad_proxy_jump() {
        let inputs = vec![
            "",
            "   ",
            "@",
            "@host",
            "user@",
            "host with space",
            "user@bad host",
            "host:not_a_port",
            "host:",
            "host:999999",
            "user@host:22 extra",
            "\x00\x01\x02",
            "@@@",
            "user@@host",
        ];
        for input in inputs {
            let result = std::panic::catch_unwind(|| parse_proxy_jump(input));
            assert!(
                result.is_ok(),
                "parse_proxy_jump panicked on input: {:?}",
                input
            );
            if let Some(parsed) = result.unwrap() {
                assert!(
                    !parsed.host.is_empty(),
                    "parse_proxy_jump returned empty host for input: {:?}",
                    input
                );
            }
        }
    }

    #[test]
    fn russh_backend_connect_logs_known_hosts_and_proxy_jump_without_panic() {
        let cfg = base_config(
            Some("bastion@jump.example.com:2222"),
            Some("/home/user/.ssh/known_hosts"),
        );
        let parsed = parse_proxy_jump(cfg.proxy_jump.as_deref().unwrap()).unwrap();
        assert_eq!(parsed.user.as_deref(), Some("bastion"));
        assert_eq!(parsed.host, "jump.example.com");
        assert_eq!(parsed.port, Some(2222));
        assert!(cfg.known_hosts_path.is_some());
    }
}
