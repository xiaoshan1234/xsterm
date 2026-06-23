use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

use crate::infrastructure::app_backend::RealAppBackend;
use crate::models::session::{LocalSessionConfig, SSHSessionConfig, SessionInfo, SshTmuxSessionConfig, TmuxSessionConfig};
use crate::services::session_manager::SessionManager;

/// Create a new local shell session.
#[tauri::command]
pub async fn create_local_session(
    config: LocalSessionConfig,
    state: State<'_, Arc<Mutex<SessionManager>>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    tracing::info!("Creating local session");
    let backend = RealAppBackend::new(app);
    with_manager(state, |manager| manager.create_local(config, backend))
        .inspect(|info| {
            tracing::info!("Local session created: id={}", info.id);
        })
        .map_err(|e| {
            tracing::error!("Failed to create local session: {}", e);
            e
        })
}

/// Create a new SSH session.
#[tauri::command]
pub async fn create_ssh_session(
    config: SSHSessionConfig,
    state: State<'_, Arc<Mutex<SessionManager>>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    tracing::info!(
        "Creating SSH session: {}@{}:{}",
        config.username,
        config.host,
        config.port
    );
    let backend = RealAppBackend::new(app);
    with_manager(state, |manager| manager.create_ssh(config, backend))
        .inspect(|info| {
            tracing::info!("SSH session created: id={}", info.id);
        })
        .map_err(|e| {
            tracing::error!("Failed to create SSH session: {}", e);
            e
        })
}

/// Write input data to an existing session.
#[tauri::command]
pub async fn write_session(
    session_id: u32,
    data: Vec<u8>,
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    with_manager(state, |manager| manager.write(session_id, &data))
}

/// Resize the PTY of an existing session.
#[tauri::command]
pub async fn resize_session(
    session_id: u32,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    with_manager(state, |manager| manager.resize(session_id, rows, cols))
}

/// Close an existing session.
#[tauri::command]
pub async fn close_session(
    session_id: u32,
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    tracing::info!("Closing session: id={}", session_id);
    with_manager(state, |manager| manager.close(session_id))
        .map(|()| {
            tracing::info!("Session closed: id={}", session_id);
        })
        .map_err(|e| {
            tracing::error!("Failed to close session {}: {}", session_id, e);
            e
        })
}

/// List metadata for all active sessions.
#[tauri::command]
pub fn list_sessions(
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<Vec<SessionInfo>, String> {
    with_manager(state, |manager| Ok(manager.list()))
}

/// Create a new tmux control mode session.
#[tauri::command]
pub async fn create_tmux_session(
    config: TmuxSessionConfig,
    state: State<'_, Arc<Mutex<SessionManager>>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    tracing::info!("Creating tmux control mode session");
    let backend = RealAppBackend::new(app);
    with_manager(state, |manager| manager.create_tmux(config, backend))
        .inspect(|info| {
            tracing::info!("Tmux session created: id={}", info.id);
        })
        .map_err(|e| {
            tracing::error!("Failed to create tmux session: {}", e);
            e
        })
}

#[tauri::command]
pub async fn create_ssh_tmux_session(
    config: SshTmuxSessionConfig,
    state: State<'_, Arc<Mutex<SessionManager>>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    tracing::info!(
        "Creating SSH tmux session: {}@{}:{}",
        config.ssh.username,
        config.ssh.host,
        config.ssh.port
    );
    let backend = RealAppBackend::new(app);
    with_manager(state, |manager| manager.create_ssh_tmux(config, backend))
        .inspect(|info| {
            tracing::info!("SSH tmux session created: id={}", info.id);
        })
        .map_err(|e| {
            tracing::error!("Failed to create SSH tmux session: {}", e);
            e
        })
}

/// Write a raw tmux control mode command to a tmux session.
#[tauri::command]
pub async fn write_tmux_command(
    session_id: u32,
    command: String,
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    with_manager(state, |manager| manager.write_tmux_command(session_id, &command))
}

/// Resize a tmux pane.
#[tauri::command]
pub async fn resize_tmux_pane(
    session_id: u32,
    pane_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    with_manager(state, |manager| manager.resize_tmux_pane(session_id, &pane_id, rows, cols))
}

/// Send keys to a tmux pane.
#[tauri::command]
pub async fn send_keys_to_tmux_pane(
    session_id: u32,
    pane_id: String,
    keys: String,
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    with_manager(state, |manager| manager.send_keys_to_tmux_pane(session_id, &pane_id, &keys))
}

#[tauri::command]
pub async fn capture_tmux_pane(
    session_id: u32,
    pane_id: String,
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    with_manager(state, |manager| manager.capture_tmux_pane(session_id, &pane_id))
}

/// Helper to lock the session manager and execute an operation.
fn with_manager<F, T>(
    state: State<'_, Arc<Mutex<SessionManager>>>,
    f: F,
) -> Result<T, String>
where
    F: FnOnce(&mut SessionManager) -> Result<T, String>,
{
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    f(&mut manager)
}
