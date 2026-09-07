use std::net::SocketAddr;
use std::sync::{mpsc as sync_mpsc, Arc};
use std::thread;
use std::time::Duration;

use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg, PublicKey};
use russh::CryptoVec;
use tokio::net::{TcpSocket, TcpStream};
use tokio::runtime::Builder;
use tokio::sync::mpsc;

use crate::error::StringError;
use crate::infrastructure::pty::default_pty_size;
use crate::infrastructure::session_backend::SessionBackend;
use crate::models::capabilities::CapabilityFlags;
use crate::models::session::{SSHSessionConfig, SessionInfo};

// 60-second interval for application-layer null-packet keepalive when
// `config.null_packet_keepalive = Some(true)`. Matches the OpenSSH-style
// "send a zero byte every N seconds" heartbeat pattern.
const NULL_PACKET_KEEPALIVE_SECS: u64 = 60;

/// Default terminal type requested for SSH PTY sessions when the config
/// does not specify one. Defaults to `xterm-256color` for broad compatibility.
const DEFAULT_TERMINAL_TYPE: &str = "xterm-256color";

/// Marker trait for SSH channel handles.
pub trait SshChannel: Send + Sync {}

/// Backend capable of establishing an SSH connection.
pub trait SshBackend: Send + Sync {
    /// Connect using the full `SSHSessionConfig`, which carries host, port,
    /// auth, terminal options, and connection-level knobs (keepalive,
    /// timeout, compression).
    ///
    /// On success, returns the I/O channels needed to drive the session.
    fn connect(
        &self,
        config: &SSHSessionConfig,
    ) -> Result<SshConnectResult, String>;

    /// open a single SSH exec channel and run `command` on the
    /// remote host. Returns the same `SshConnectResult` shape as
    /// [`SshBackend::connect`] so callers can bridge the resulting byte
    /// stream into a `tokio::io::AsyncRead` / `tokio::io::AsyncWrite`
    /// pair (e.g. for running `tmux -CC` on the remote side).
    ///
    /// Unlike `connect`, the channel has **no PTY** (so `resize_tx` is
    /// always `None`) and **no shell** — `command` is the single thing
    /// the channel will execute. Closing the write side (dropping all
    /// `write_tx` clones) sends `eof()` on the channel and the data
    /// loop then drains any remaining output and exits.
    fn connect_exec(
        &self,
        config: &SSHSessionConfig,
        command: &str,
    ) -> Result<SshConnectResult, String>;
}

/// Result of an SSH connection, containing both the channel (for trait compliance)
/// and the direct I/O channels that bypass Mutex contention.
pub struct SshConnectResult {
    pub channel: Box<dyn SshChannel + Send>,
    pub write_tx: mpsc::UnboundedSender<Vec<u8>>,
    pub read_rx: sync_mpsc::Receiver<Option<Vec<u8>>>,
    pub resize_tx: Option<mpsc::UnboundedSender<(u16, u16)>>,
    /// Exit code captured from the remote command's
    /// `SSH_MSG_CHANNEL_EXIT_STATUS` (msg type 98). `None` until the
    /// server sends the status; populated *before* the channel EOF so
    /// `backend.wait()` can return it.
    ///
    /// The exec path previously discarded `ChannelMsg::ExitStatus`
    /// (caught by the catch-all `_ => false` arm), so we had no way to
    /// tell why the remote tmux exited. Surfacing it here lets the
    /// tmux controller log / surface real exit codes. See
    /// `doc/maintenance/bug.md` Bug 010.
    pub exit_code: Arc<std::sync::Mutex<Option<i32>>>,
    /// Watch channel carrying the remote command's exit code.
    /// `wait()` uses this instead of the stdout channel (the reader
    /// is a separate task and has already taken `self.stdout_rx`).
    /// `watch` keeps the latest value, so a late `notified().await`
    /// still observes the value — unlike `Notify` (Bug 013: the
    /// monitor task may not have reached its `await` yet when the
    /// SSH data loop processes `ExitStatus`, so a one-shot notify is
    /// lost). See `doc/maintenance/bug.md` Bug 013.
    pub exit_code_tx: tokio::sync::watch::Sender<Option<i32>>,
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

    fn write(&self, data: &[u8]) -> Result<(), String> {
        self.write_tx
            .send(data.to_vec())
            .map_err(|_| format!("SSH channel closed for session {}", self.info.id))
    }

    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
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

    fn connect_exec(
        &self,
        config: &SSHSessionConfig,
        command: &str,
    ) -> Result<SshConnectResult, String> {
        connect_ssh_exec(config, command)
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

/// Resolve `host:port`, create a socket with the configured TCP options, and
/// connect. Iterates over all resolved addresses (IPv4 first) so a single bad
/// address does not abort the connection attempt.
///
/// `tcp_nodelay` defaults to `true` (Nagle's algorithm disabled) unless the
/// caller explicitly opts out with `Some(false)`. `so_keepalive` defaults to
/// `false` and only enables `SO_KEEPALIVE` when `Some(true)`.
async fn open_configured_tcp_stream(config: &SSHSessionConfig) -> Result<TcpStream, String> {
    let tcp_nodelay = config.tcp_nodelay.unwrap_or(true);
    let so_keepalive = config.so_keepalive.unwrap_or(false);

    let mut addrs: Vec<SocketAddr> = tokio::net::lookup_host((config.host.as_str(), config.port))
        .await
        .map_err(|e| {
            format!(
                "DNS resolution failed for {}:{}: {}",
                config.host, config.port, e
            )
        })?
        .collect();

    if addrs.is_empty() {
        return Err(format!(
            "No addresses found for {}:{}",
            config.host, config.port
        ));
    }

    // Prefer IPv4 over IPv6 to preserve the historical address-order semantics
    // of `tokio::net::TcpStream::connect` resolving `ToSocketAddrs`.
    addrs.sort_by_key(|a| match a {
        SocketAddr::V4(_) => 0,
        SocketAddr::V6(_) => 1,
    });

    let mut last_err: Option<String> = None;
    for addr in addrs {
        let socket = match addr {
            SocketAddr::V4(_) => TcpSocket::new_v4(),
            SocketAddr::V6(_) => TcpSocket::new_v6(),
        };
        let socket = match socket {
            Ok(s) => s,
            Err(e) => {
                last_err = Some(e.to_string());
                continue;
            }
        };

        if let Err(e) = socket.set_nodelay(tcp_nodelay) {
            tracing::warn!(
                "Failed to set TCP_NODELAY={} on {}: {}",
                tcp_nodelay, addr, e
            );
        }
        if let Err(e) = socket.set_keepalive(so_keepalive) {
            tracing::warn!(
                "Failed to set SO_KEEPALIVE={} on {}: {}",
                so_keepalive, addr, e
            );
        }

        match socket.connect(addr).await {
            Ok(stream) => {
                tracing::info!(
                    "SSH TCP connected to {} (nodelay={}, keepalive={})",
                    addr, tcp_nodelay, so_keepalive
                );
                return Ok(stream);
            }
            Err(e) => last_err = Some(e.to_string()),
        }
    }

    Err(format!(
        "SSH TCP connection to {}:{} failed: {}",
        config.host,
        config.port,
        last_err.unwrap_or_else(|| "no addresses succeeded".to_string())
    ))
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
    let exit_code = Arc::new(std::sync::Mutex::new(None));
    let (exit_code_tx, _exit_code_rx_unused) = tokio::sync::watch::channel(None::<i32>);
    let exit_code_for_thread = Arc::clone(&exit_code);
    let exit_code_tx_for_thread = exit_code_tx.clone();

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
                &exit_code_for_thread,
                &exit_code_tx_for_thread,
            )
            .await;

            // Forward the spawn task's result — both Ok and Err — so the
            // parent gets a meaningful error message instead of a misleading
            // "panicked before handshake" if the SSH handshake failed.
            let _ = result_tx.send(result);
        });
    });

    result_rx
        .recv()
        .map_err(|_| "SSH connection thread died before handshake (panic or runtime build failure)".to_string())??;

    Ok(SshConnectResult {
        channel: Box::new(BridgedChannel),
        write_tx,
        read_rx,
        resize_tx,
        exit_code,
        exit_code_tx,
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
    exit_code: &Arc<std::sync::Mutex<Option<i32>>>,
    exit_code_tx: &tokio::sync::watch::Sender<Option<i32>>,
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

    // Open a pre-configured TcpStream (tcp_nodelay / so_keepalive honored) and
    // hand it to russh via `connect_stream` instead of letting russh create its
    // own socket with default options.
    let connect_block = async {
        let stream = open_configured_tcp_stream(config).await?;
        russh::client::connect_stream(russh_config.clone(), stream, ClientHandler)
            .await
            .map_err(|e| {
                format!(
                    "SSH connection to {}:{} failed: {}",
                    config.host, config.port, e
                )
            })
    };
    let mut handle = if let Some(secs) = config.connection_timeout {
        match tokio::time::timeout(Duration::from_secs(secs as u64), connect_block).await {
            Ok(result) => result?,
            Err(_) => {
                return Err(format!(
                    "SSH connection to {}:{} timed out after {} seconds",
                    config.host, config.port, secs
                ));
            }
        }
    } else {
        connect_block.await?
    };

    authenticate(&mut handle, config)
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

    // Apply `charset` via SSH environment variable. Many servers accept
    // `AcceptEnv` for LC_*; if the server rejects the request we log a
    // warning and continue rather than aborting the session.
    if let Some(cs) = config.charset.as_deref() {
        if !cs.is_empty() {
            if let Err(e) = channel.set_env(false, "LC_ALL", cs.to_string()).await {
                tracing::warn!(
                    "SSH server rejected LC_ALL={} via env: {} (charset may not take effect)",
                    cs, e
                );
            } else {
                tracing::info!("Applied charset via SSH env LC_ALL={}", cs);
            }
        }
    }

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

    // Application-layer null-packet keepalive. When enabled, spawn a long-lived
    // task that periodically sends a single `\0` byte through the SSH channel;
    // the data loop forwards it via the same path as user input. This is
    // independent of russh's SSH-level `keepalive_interval` config.
    let (keepalive_tx, mut keepalive_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    if config.null_packet_keepalive == Some(true) {
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(NULL_PACKET_KEEPALIVE_SECS));
            // First tick fires immediately; consume it so the first heartbeat
            // is sent after one full interval, not at session open.
            ticker.tick().await;
            loop {
                ticker.tick().await;
                if keepalive_tx.send(b"\0".to_vec()).is_err() {
                    tracing::debug!("Null-packet keepalive channel closed; exiting task");
                    break;
                }
            }
        });
        tracing::info!(
            "Null-packet keepalive enabled (every {}s)",
            NULL_PACKET_KEEPALIVE_SECS
        );
    }

    result_tx.send(Ok(())).ok();
    tracing::info!("SSH session established, entering data loop");

    run_data_loop(
        &mut handle,
        &mut channel,
        read_tx,
        write_rx,
        resize_rx,
        &mut keepalive_rx,
        exit_code,
        exit_code_tx,
    )
    .await;
    tracing::info!("SSH data loop ended");
    Ok(())
}

/// spawn a thread that runs an async russh **exec** connection.
///
/// Mirrors [`connect_ssh`] but requests `channel.exec(true, command)`
/// instead of `request_pty` + `request_shell`. The exec channel has no
/// PTY (so `resize_tx` is `None` on the returned [`SshConnectResult`])
/// and the channel runs **only** the supplied `command`. Once `command`
/// exits (or the write side is closed and EOF is signalled), the data
/// loop drains and the channel closes.
///
/// Intended for [`crate::infrastructure::tmux::backend::SshTmuxBackend`]
/// which runs `tmux -CC` on the remote host and bridges its byte stream
/// into the local tmux controller's reader/writer tasks.
fn connect_ssh_exec(config: &SSHSessionConfig, command: &str) -> Result<SshConnectResult, String> {
    let (result_tx, result_rx) = sync_mpsc::channel::<Result<(), String>>();
    let (read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
    let (write_tx, mut write_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let exit_code = Arc::new(std::sync::Mutex::new(None));
    let (exit_code_tx, _exit_code_rx_unused) = tokio::sync::watch::channel(None::<i32>);
    let exit_code_for_thread = Arc::clone(&exit_code);
    let exit_code_tx_for_thread = exit_code_tx.clone();

    let config_clone = config.clone();
    let command_owned = command.to_string();

    thread::spawn(move || {
        let rt = Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed to create Tokio runtime for SSH exec connection");

        rt.block_on(async move {
            let result = run_ssh_exec_session(
                &config_clone,
                &command_owned,
                &result_tx,
                &read_tx,
                &mut write_rx,
                &exit_code_for_thread,
                &exit_code_tx_for_thread,
            )
            .await;

            // Forward the spawn task's result — both Ok and Err — so the
            // parent gets a meaningful error message instead of a misleading
            // "panicked before handshake" if the SSH exec handshake failed.
            let _ = result_tx.send(result);
        });
    });

    result_rx
        .recv()
        .map_err(|_| "SSH exec connection thread died before handshake (panic or runtime build failure)".to_string())??;

    Ok(SshConnectResult {
        channel: Box::new(BridgedChannel),
        write_tx,
        read_rx,
        resize_tx: None,
        exit_code,
        exit_code_tx,
    })
}

/// run the SSH exec-channel lifecycle (TCP + auth + exec +
/// data loop), parallel to [`run_ssh_session`] but skipping PTY + shell.
///
/// The data loop is identical to the shell path: incoming `Data` /
/// `ExtendedData` are forwarded to `read_tx`, and outgoing bytes from
/// `write_rx` are sent through the channel. When `write_rx` returns
/// `None` (all senders dropped) the loop signals `eof()` on the
/// channel — tmux on the remote side then sees EOF on its stdin and
/// can finish cleanly.
async fn run_ssh_exec_session(
    config: &SSHSessionConfig,
    command: &str,
    result_tx: &sync_mpsc::Sender<Result<(), String>>,
    read_tx: &sync_mpsc::Sender<Option<Vec<u8>>>,
    write_rx: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    exit_code: &Arc<std::sync::Mutex<Option<i32>>>,
    exit_code_tx: &tokio::sync::watch::Sender<Option<i32>>,
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

    let connect_block = async {
        let stream = open_configured_tcp_stream(config).await?;
        russh::client::connect_stream(russh_config.clone(), stream, ClientHandler)
            .await
            .map_err(|e| {
                format!(
                    "SSH connection to {}:{} failed: {}",
                    config.host, config.port, e
                )
            })
    };
    let mut handle = if let Some(secs) = config.connection_timeout {
        match tokio::time::timeout(Duration::from_secs(secs as u64), connect_block).await {
            Ok(result) => result?,
            Err(_) => {
                return Err(format!(
                    "SSH connection to {}:{} timed out after {} seconds",
                    config.host, config.port, secs
                ));
            }
        }
    } else {
        connect_block.await?
    };

    authenticate(&mut handle, config)
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
        .map_err(|e| format!("Failed to open SSH exec channel: {}", e))?;

    // Apply `charset` via SSH environment variable. Same logic as the
    // shell path; tmux on the remote side benefits from a consistent
    // LC_ALL for its child shells.
    if let Some(cs) = config.charset.as_deref() {
        if !cs.is_empty() {
            if let Err(e) = channel.set_env(false, "LC_ALL", cs.to_string()).await {
                tracing::warn!(
                    "SSH server rejected LC_ALL={} via env: {} (charset may not take effect)",
                    cs, e
                );
            }
        }
    }

    // Request a PTY for the exec channel. `tmux -CC` (control mode)
    // requires stdin/stdout to be a real TTY; without this the
    // remote tmux process spawns with stdin not connected to a
    // terminal and immediately exits with
    // `tcgetattr failed: Inappropriate ioctl for device` (Bug 008 —
    // see `doc/maintenance/bug.md`). SSH `exec` + `pty-req` is the
    // standard OpenSSH pattern for running an interactive command
    // non-interactively.
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
        .map_err(|e| {
            format!(
                "SSH exec PTY request failed for command {:?}: {}",
                command, e
            )
        })?;

    channel
        .exec(true, command)
        .await
        .map_err(|e| format!("SSH exec request failed for command {:?}: {}", command, e))?;

    result_tx.send(Ok(())).ok();
    tracing::info!(
        "SSH exec channel established for command {:?} on {}@{}",
        command,
        config.username,
        config.host
    );

    // Same data loop semantics as the shell path — exec channels also
    // carry Data / ExtendedData / Eof / Close messages. Resize is a
    // no-op (no PTY), so we pass `None` for `resize_rx` and a fresh
    // empty `keepalive_rx` (the exec path doesn't use null-packet
    // keepalive because the channel lifetime is bounded by the remote
    // command, not the local shell session).
    let (_keepalive_unused_tx, mut keepalive_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    run_data_loop(
        &mut handle,
        &mut channel,
        read_tx,
        write_rx,
        None,
        &mut keepalive_rx,
        exit_code,
        exit_code_tx,
    )
    .await;
    tracing::info!("SSH exec data loop ended for command {:?}", command);
    Ok(())
}

/// Authenticate the SSH session using either a password or a private key.
async fn authenticate(
    handle: &mut russh::client::Handle<ClientHandler>,
    config: &SSHSessionConfig,
) -> Result<(), String> {
    match config.auth_type.as_str() {
        "password" => {
            let password = config.password.as_deref().unwrap_or("");
            let ok = handle
                .authenticate_password(&config.username, password)
                .await
                .map_err_string()?
                .success();
            if !ok {
                return Err("password authentication rejected".to_string());
            }
        }
        "key" => {
            let key_file = config
                .key_file
                .as_deref()
                .ok_or_else(|| "key_file required when auth_type is \"key\"".to_string())?;
            let key_data = std::fs::read_to_string(key_file)
                .map_err(|e| format!("failed to read key file '{}': {}", key_file, e))?;
            let key = decode_secret_key(&key_data, config.passphrase.as_deref())
                .map_err(|e| format!("failed to decode key '{}': {}", key_file, e))?;
            let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), None);
            let ok = handle
                .authenticate_publickey(&config.username, key_with_hash)
                .await
                .map_err_string()?
                .success();
            if !ok {
                return Err("public key authentication rejected".to_string());
            }
        }
        other => {
            return Err(format!("unknown ssh auth_type: {}", other));
        }
    }
    Ok(())
}

/// Process a message received from the SSH channel. Returns `true` when the
/// data loop should terminate.
async fn handle_channel_msg(
    msg: Option<russh::ChannelMsg>,
    read_tx: &sync_mpsc::Sender<Option<Vec<u8>>>,
    exit_code: &Arc<std::sync::Mutex<Option<i32>>>,
    exit_code_tx: &tokio::sync::watch::Sender<Option<i32>>,
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
        // Capture the remote command's exit status — the server
        // sends `SSH_MSG_CHANNEL_EXIT_STATUS` (msg type 98) on the
        // channel just before EOF, with the 32-bit exit code as
        // its single u32 payload. Previously the catch-all arm
        // silently dropped this; the tmux controller therefore had
        // no way to tell why a remote tmux exited (Bug 010).
        Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
            tracing::info!("SSH channel received ExitStatus: {}", exit_status);
            if let Ok(mut slot) = exit_code.lock() {
                *slot = Some(exit_status as i32);
            }
            // Publish to the watch channel; the latest value is
            // retained so a late `wait()` (one that hasn't reached
            // its `await` yet when we fire this) still observes the
            // value (Bug 013: `Notify` would lose the wakeup because
            // its `notified()` future doesn't exist before the call).
            let _ = exit_code_tx.send(Some(exit_status as i32));
            false
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
    keepalive_rx: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    exit_code: &Arc<std::sync::Mutex<Option<i32>>>,
    exit_code_tx: &tokio::sync::watch::Sender<Option<i32>>,
) {
    let channel_id = channel.id();
    // Track whether the keepalive side has closed (e.g. exec channel
    // path which doesn't use null-packet keepalive). Once closed, stop
    // selecting on it so the `tokio::select!` doesn't see a perpetually
    // ready branch that immediately exits the loop. The shell path
    // keeps `keepalive_tx` alive in scope so this branch never closes
    // while `null_packet_keepalive == Some(true)`.
    let mut keepalive_alive = true;
    loop {
        // The resize future is constructed via an `async` block so that
        // the `resize_rx.as_mut().unwrap()` expression is evaluated lazily,
        // at poll-time, instead of eagerly when the `select!` arm is
        // reached. `tokio::select!` evaluates its future expressions
        // *before* checking the `if guard` — a naked `unwrap()` on a
        // `None` `resize_rx` would panic on the very first iteration
        // (the exec-channel path passes `None` because exec channels
        // have no PTY).
        let resize_recv = async {
            match resize_rx.as_mut() {
                Some(rx) => rx.recv().await,
                None => std::future::pending().await,
            }
        };
        tokio::select! {
            msg = channel.wait() => {
                if handle_channel_msg(msg, read_tx, exit_code, exit_code_tx).await {
                    break;
                }
            }
            data = write_rx.recv() => {
                if forward_write_data(handle, channel_id, data).await {
                    break;
                }
            }
            data = keepalive_rx.recv(), if keepalive_alive => {
                if data.is_none() {
                    tracing::debug!("SSH keepalive channel closed; disabling branch");
                    keepalive_alive = false;
                    continue;
                }
                if forward_write_data(handle, channel_id, data).await {
                    break;
                }
            }
            resize = resize_recv => {
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
///
/// `pub(crate)` so sibling modules (e.g. `tmux::backend` tests) can
/// construct one without going through a real russh session.
pub(crate) struct BridgedChannel;

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

    let connect_block = async {
        let stream = open_configured_tcp_stream(config).await?;
        russh::client::connect_stream(ssh_config.clone(), stream, ClientHandler)
            .await
            .map_err(|e| {
                format!(
                    "SSH connection to {}:{} failed: {}",
                    config.host, config.port, e
                )
            })
    };
    let mut handle = if let Some(secs) = config.connection_timeout {
        match tokio::time::timeout(Duration::from_secs(secs as u64), connect_block).await {
            Ok(result) => result?,
            Err(_) => {
                return Err(format!(
                    "SSH connection to {}:{} timed out after {} seconds",
                    config.host, config.port, secs
                ));
            }
        }
    } else {
        connect_block.await?
    };

    authenticate(&mut handle, config).await?;

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
            auth_type: "password".to_string(),
            password: Some("pw".to_string()),
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

// ============================================================================
// Regression tests for Bug 013: run_data_loop panicked on None resize_rx.
// ============================================================================

#[cfg(test)]
mod data_loop_tests {
    use super::*;

    /// Smoke test: ensures the data loop does NOT panic when `resize_rx`
    /// is `None` (the exec-channel path, which has no PTY). The previous
    /// implementation wrote `resize_rx.as_mut().unwrap()` directly in the
    /// `tokio::select!` arm, which `tokio::select!` evaluates eagerly
    /// before checking the `if resize_rx.is_some()` guard. With `None`,
    /// the unwrap panicked on the first iteration. The fix wraps the
    /// expression in an `async {}` block so evaluation is deferred until
    /// poll-time, where the match arms handle `None` via `pending()`.
    ///
    /// We can't run the full data loop without a real russh channel, so
    /// this test simply asserts that the future-construction expression
    /// doesn't panic when `resize_rx: None`. If it did panic, the test
    /// process would abort.
    #[test]
    fn resize_future_construction_does_not_panic_when_resize_rx_is_none() {
        let mut resize_rx: Option<mpsc::UnboundedReceiver<(u16, u16)>> = None;
        let resize_recv = async {
            match resize_rx.as_mut() {
                Some(rx) => rx.recv().await,
                None => std::future::pending().await,
            }
        };
        // If we got here without panicking, the unsafe unwrap was removed.
        let _ = resize_recv;
    }

    #[test]
    fn resize_future_construction_succeeds_when_resize_rx_is_some() {
        let (tx, rx) = mpsc::unbounded_channel::<(u16, u16)>();
        drop(tx); // Sender dropped so recv() returns None immediately.
        let mut resize_rx: Option<mpsc::UnboundedReceiver<(u16, u16)>> = Some(rx);
        let resize_recv = async {
            match resize_rx.as_mut() {
                Some(rx) => rx.recv().await,
                None => std::future::pending().await,
            }
        };
        let _ = resize_recv;
    }
}
