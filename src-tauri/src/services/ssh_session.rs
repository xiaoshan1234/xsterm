use std::sync::Arc;
use std::thread;

use tokio::sync::mpsc;
use std::sync::mpsc as sync_mpsc;

use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::ssh::{SshBackend, SshChannel, SshConnectResult, SshSessionWrapper};
use crate::models::session::{SessionInfo, SessionType, SSHSessionConfig};

/// Create an SSH session and start a thread that forwards channel output to the
/// frontend.
pub fn create_ssh_session(
    ssh_backend: &dyn SshBackend,
    config: SSHSessionConfig,
    backend: impl AppBackend + 'static,
    session_id: u32,
) -> Result<SshSessionWrapper, String> {
    let SshConnectResult { channel: _channel, write_tx, read_rx, resize_tx } =
        ssh_backend.connect(&config.host, config.port, &config.auth, &config.username)?;

    // Keep the channel alive for the lifetime of the session. It is never used
    // directly because reads/writes go through the dedicated channels above.
    let _channel = Arc::new(std::sync::Mutex::new(_channel));

    let host = config.host.clone();
    let port = config.port;
    let username = config.username.clone();

    let info = SessionInfo {
        id: session_id,
        name: format!("{}@{}", username, host),
        session_type: SessionType::Ssh {
            host,
            port,
            user: username,
        },
        is_connected: true,
    };

    let wrapper = SshSessionWrapper { info, write_tx, resize_tx, config };

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

/// Holds the I/O channels for an SSH session used as a tmux underlay.
pub struct SshUnderlaySession {
    pub info: SessionInfo,
    pub write_tx: mpsc::UnboundedSender<Vec<u8>>,
    pub read_rx: sync_mpsc::Receiver<Option<Vec<u8>>>,
    pub _channel: Arc<std::sync::Mutex<Box<dyn SshChannel + Send>>>,
}

/// Create an SSH session for use as a tmux underlay.
///
/// Unlike [`create_ssh_session`], this does not start an output forwarder;
/// the caller is responsible for reading from the returned receiver.
pub fn create_ssh_underlay_session(
    ssh_backend: &dyn SshBackend,
    config: SSHSessionConfig,
    session_id: u32,
) -> Result<SshUnderlaySession, String> {
    let SshConnectResult { channel, write_tx, read_rx, resize_tx: _ } =
        ssh_backend.connect(&config.host, config.port, &config.auth, &config.username)?;

    let _channel = Arc::new(std::sync::Mutex::new(channel));

    let host = config.host.clone();
    let port = config.port;
    let username = config.username.clone();

    let info = SessionInfo {
        id: session_id,
        name: format!("{}@{}", username, host),
        session_type: SessionType::Ssh {
            host,
            port,
            user: username,
        },
        is_connected: true,
    };

    Ok(SshUnderlaySession {
        info,
        write_tx,
        read_rx,
        _channel,
    })
}
