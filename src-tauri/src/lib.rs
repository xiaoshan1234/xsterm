mod session;

use session::{LocalSessionConfig, SessionInfo, SessionManager, SSHSessionConfig};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

#[tauri::command]
async fn create_local_session(
    config: LocalSessionConfig,
    state: State<'_, Arc<Mutex<SessionManager>>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    manager.create_local(config, app)
}

#[tauri::command]
async fn create_ssh_session(
    config: SSHSessionConfig,
    state: State<'_, Arc<Mutex<SessionManager>>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    manager.create_ssh(config, app)
}

#[tauri::command]
async fn write_session(
    session_id: u32,
    data: Vec<u8>,
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    manager.write(session_id, &data)
}

#[tauri::command]
async fn resize_session(
    session_id: u32,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    manager.resize(session_id, rows, cols)
}

#[tauri::command]
async fn close_session(
    session_id: u32,
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    manager.close(session_id)
}

#[tauri::command]
fn list_sessions(
    state: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<Vec<SessionInfo>, String> {
    let manager = state.lock().map_err(|e| e.to_string())?;
    Ok(manager.list())
}

#[tauri::command]
async fn save_sessions(
    sessions: Vec<SessionInfo>,
    app: AppHandle,
) -> Result<(), String> {
    let store = app.store("sessions.json").map_err(|e| e.to_string())?;
    store.set("sessions", serde_json::to_value(sessions).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn load_sessions(app: AppHandle) -> Result<Vec<SessionInfo>, String> {
    let store = app.store("sessions.json").map_err(|e| e.to_string())?;
    match store.get("sessions") {
        Some(value) => Ok(serde_json::from_value(value.clone()).map_err(|e| e.to_string())?),
        None => Ok(vec![]),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(Arc::new(Mutex::new(SessionManager::new())))
        .invoke_handler(tauri::generate_handler![
            create_local_session,
            create_ssh_session,
            write_session,
            resize_session,
            close_session,
            list_sessions,
            save_sessions,
            load_sessions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
