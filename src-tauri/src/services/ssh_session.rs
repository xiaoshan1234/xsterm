use std::sync::Arc;
use std::thread;

use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::ssh::{SshBackend, SshConnectResult, SshSessionWrapper};
use crate::models::session::{SessionInfo, SessionType, SSHSessionConfig};
use crate::services::session_log::SessionLog;

/// Create an SSH session and start a thread that forwards channel output to the
/// frontend.
pub fn create_ssh_session(
    ssh_backend: &dyn SshBackend,
    config: SSHSessionConfig,
    backend: impl AppBackend + 'static,
    session_id: u32,
) -> Result<SshSessionWrapper, String> {
    let SshConnectResult { channel: _channel, write_tx, read_rx, resize_tx } =
        ssh_backend.connect(&config.host, config.port, &config.auth, &config.username, &config.system)?;

    // Keep the channel alive for the lifetime of the session. It is never used
    // directly because reads/writes go through the dedicated channels above.
    let _channel = Arc::new(std::sync::Mutex::new(_channel));

    let host = config.host.clone();
    let port = config.port;
    let username = config.username.clone();
    let auto_log_path = config.terminal.auto_log_path.clone();

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

    let mut log = SessionLog::new(&auto_log_path);
    let backend_clone = backend.clone();
    thread::spawn(move || {
        loop {
            match read_rx.recv() {
                Ok(Some(data)) => {
                    log.append(&data);
                    let payload = serde_json::to_vec(&(session_id, &data[..])).unwrap();
                    if let Err(e) = backend_clone.emit("session-output", &payload) {
                        eprintln!("Failed to emit SSH output for session {}: {}", session_id, e);
                        break;
                    }
                }
                Ok(None) | Err(_) => {
                    let payload = serde_json::to_vec(&session_id).unwrap();
                    let _ = backend_clone.emit("session-disconnected", &payload);
                    break;
                }
            }
        }
    });

    Ok(wrapper)
}
