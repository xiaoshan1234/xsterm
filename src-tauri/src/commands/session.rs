use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

use crate::infrastructure::app_backend::RealAppBackend;
use crate::models::session::{LocalSessionConfig, SSHSessionConfig, SessionInfo};
use crate::services::session_manager::SessionManager;

#[tauri::command]
pub async fn create_local_session(
    config: LocalSessionConfig,
    state: State<'_, Arc<Mutex<SessionManager>>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    tracing::info!("Creating local session");
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    let backend = RealAppBackend::new(app);
    match manager.create_local(config, backend) {
        Ok(info) => {
            tracing::info!("Local session created: id={}", info.id);
            Ok(info)
        }
        Err(e) => {
            tracing::error!("Failed to create local session: {}", e);
            Err(e)
        }
    }
}

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
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    let backend = RealAppBackend::new(app);
    match manager.create_ssh(config, backend) {
        Ok(info) => {
            tracing::info!("SSH session created: id={}", info.id);
            Ok(info)
        }
        Err(e) => {
            tracing::error!("Failed to create SSH session: {}", e);
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn write_session(
    session_id: u32,
    data: Vec<u8>,
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    manager.write(session_id, &data)
}

#[tauri::command]
pub async fn resize_session(
    session_id: u32,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    manager.resize(session_id, rows, cols)
}

#[tauri::command]
pub async fn close_session(
    session_id: u32,
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    tracing::info!("Closing session: id={}", session_id);
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    match manager.close(session_id) {
        Ok(()) => {
            tracing::info!("Session closed: id={}", session_id);
            Ok(())
        }
        Err(e) => {
            tracing::error!("Failed to close session {}: {}", session_id, e);
            Err(e)
        }
    }
}

#[tauri::command]
pub fn list_sessions(
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<Vec<SessionInfo>, String> {
    let manager = state.lock().map_err(|e| e.to_string())?;
    Ok(manager.list())
}
