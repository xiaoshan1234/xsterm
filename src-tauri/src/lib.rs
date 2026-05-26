mod session;

use session::{LocalSessionConfig, SessionInfo, SessionManager, SSHSessionConfig};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State, Manager};
use tauri_plugin_store::StoreExt;
use std::path::PathBuf;
use tracing::Level;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};
use tracing_appender::rolling::{RollingFileAppender, Rotation};

#[tauri::command]
async fn create_local_session(
    config: LocalSessionConfig,
    state: State<'_, Arc<Mutex<SessionManager>>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    tracing::info!("Creating local session");
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    match manager.create_local(config, app) {
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
async fn create_ssh_session(
    config: SSHSessionConfig,
    state: State<'_, Arc<Mutex<SessionManager>>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    tracing::info!("Creating SSH session: {}@{}:{}", config.username, config.host, config.port);
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    match manager.create_ssh(config, app) {
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
    tracing::debug!("Saving {} sessions", sessions.len());
    let store = app.store("sessions.json").map_err(|e| e.to_string())?;
    store.set("sessions", serde_json::to_value(sessions).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn load_sessions(app: AppHandle) -> Result<Vec<SessionInfo>, String> {
    let store = app.store("sessions.json").map_err(|e| e.to_string())?;
    match store.get("sessions") {
        Some(value) => {
            let sessions: Vec<SessionInfo> = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
            tracing::debug!("Loaded {} sessions", sessions.len());
            Ok(sessions)
        }
        None => Ok(vec![]),
    }
}

#[tauri::command]
async fn log_message(
    level: String,
    source: String,
    message: String,
    data: Option<String>,
) -> Result<(), String> {
    let msg = format!("[{}] {} - {}", source, message, data.as_deref().unwrap_or(""));
    match level.as_str() {
        "DEBUG" => tracing::debug!(target: "frontend", "{}", msg),
        "INFO" => tracing::info!(target: "frontend", "{}", msg),
        "WARN" => tracing::warn!(target: "frontend", "{}", msg),
        "ERROR" => tracing::error!(target: "frontend", "{}", msg),
        _ => tracing::info!(target: "frontend", "{}", msg),
    }
    Ok(())
}

fn init_logging(log_dir: &PathBuf) {
    std::fs::create_dir_all(log_dir).ok();

    let file_appender = RollingFileAppender::new(
        Rotation::DAILY,
        log_dir,
        "xsterm.log",
    );

    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(
            fmt::layer()
                .with_writer(non_blocking)
                .with_ansi(false)
                .with_target(true)
                .with_thread_ids(false)
                .with_file(true)
                .with_line_number(true),
        )
        .with(
            fmt::layer()
                .with_writer(std::io::stderr)
                .with_ansi(true)
                .with_target(false),
        )
        .init();

    // Keep guard alive for the lifetime of the program
    std::mem::forget(_guard);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Set up panic hook for logging
    std::panic::set_hook(Box::new(|panic_info| {
        eprintln!("PANIC: {}", panic_info);
        tracing::error!("PANIC: {}", panic_info);
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let log_dir = app.handle().path().app_log_dir().unwrap_or_else(|_| PathBuf::from("."));
            init_logging(&log_dir);
            tracing::info!("Application starting, log dir: {:?}", log_dir);
            Ok(())
        })
        .manage(Arc::new(Mutex::new(SessionManager::new())))
        .invoke_handler(tauri::generate_handler![
            create_local_session,
            create_ssh_session,
            write_session,
            resize_session,
            close_session,
            list_sessions,
            save_sessions,
            load_sessions,
            log_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
