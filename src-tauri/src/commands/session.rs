use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::infrastructure::app_backend::RealAppBackend;
use crate::models::session::{LocalSessionConfig, SSHSessionConfig, SessionConfig, SessionInfo};
use crate::services::session_manager::SessionManager;

/// Hard ceiling on a single `write_session` payload. The frontend sends one
/// IPC call per paste (Perf 011 made that feasible by offloading the actual
/// `write_all` to a dedicated thread), so a healthy client never reaches
/// this — it's a defence-in-depth limit against a misbehaving caller. See
/// doc/maintenance/perf.md Perf 010.
const MAX_WRITE_PAYLOAD_BYTES: usize = 1024 * 1024;

/// Create a new local shell session.
#[tauri::command]
pub async fn create_local_session(
    config: LocalSessionConfig,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    tracing::info!("Creating local session");
    let backend = RealAppBackend::new(app);
    state.create_local(config, backend).inspect(|info| {
        tracing::info!("Local session created: id={}", info.id);
    })
}

/// Create a new SSH session.
#[tauri::command]
pub async fn create_ssh_session(
    config: SSHSessionConfig,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    tracing::info!(
        "Creating SSH session: {}@{}:{}",
        config.username,
        config.host,
        config.port
    );
    let backend = RealAppBackend::new(app);
    state.create_ssh(config, backend).inspect(|info| {
        tracing::info!("SSH session created: id={}", info.id);
    })
}

/// Create a new session from a generic [`SessionConfig`] discriminated union.
///
/// This is the unified entry point the frontend uses to create either a local
/// shell session or an SSH session through a single command. The legacy
/// `create_local_session` and `create_ssh_session` commands remain available
/// for backward compatibility.
#[tauri::command]
pub async fn create_session(
    config: SessionConfig,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    tracing::info!("Creating session via generic SessionConfig");
    let backend = RealAppBackend::new(app);
    match config {
        SessionConfig::Local(local) => state.create_local(local, backend),
        SessionConfig::Ssh(ssh) => state.create_ssh(ssh, backend),
    }
    .inspect(|info| {
        tracing::info!("Session created via generic command: id={}", info.id);
    })
}

/// Write input data to an existing session.
///
/// Hot path for terminal input — including the paste pipeline. With Perf 004
/// (DashMap-backed registry) this no longer takes any global lock: the
/// payload size guard runs first, then `state.write` looks up the session
/// by id via `DashMap::get` and dispatches to the backend's
/// `write(&self, data)`.
#[tauri::command]
pub async fn write_session(
    session_id: u32,
    data: Vec<u8>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    if data.len() > MAX_WRITE_PAYLOAD_BYTES {
        return Err(format!(
            "write payload too large: {} bytes (max {})",
            data.len(),
            MAX_WRITE_PAYLOAD_BYTES
        ));
    }
    state.write(session_id, &data)
}

/// Resize the PTY of an existing session.
#[tauri::command]
pub async fn resize_session(
    session_id: u32,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    state.resize(session_id, rows, cols)
}

/// Close an existing session.
#[tauri::command]
pub async fn close_session(
    session_id: u32,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    tracing::info!("Closing session: id={}", session_id);
    state.close(session_id)
}

/// List metadata for all active sessions.
#[tauri::command]
pub fn list_sessions(state: State<'_, Arc<SessionManager>>) -> Result<Vec<SessionInfo>, String> {
    Ok(state.list())
}

/// Upload an image file to the SSH server for the given session and return the
/// remote path where it was stored.
#[tauri::command]
pub fn upload_image_to_ssh_session(
    session_id: u32,
    filename: String,
    data: Vec<u8>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<String, String> {
    state.upload_image(session_id, &filename, data)
}