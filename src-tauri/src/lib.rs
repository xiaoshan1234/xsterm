mod groups;
mod local_session;
mod session;
mod ssh_session;

use groups::SessionGroup;
use session::{LocalSessionConfig, RealAppBackend, SessionInfo, SessionManager, SSHSessionConfig};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State, Manager};
use tauri_plugin_store::StoreExt;
use std::path::{PathBuf, Path};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, reload};
use tracing_appender::rolling::{RollingFileAppender, Rotation};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogConfig {
    pub max_file_size: u64,
    pub max_log_files: usize,
    pub log_level: String,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            max_file_size: 10,
            max_log_files: 5,
            log_level: "info".to_string(),
        }
    }
}

#[tauri::command]
async fn create_local_session(
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
async fn create_ssh_session(
    config: SSHSessionConfig,
    state: State<'_, Arc<Mutex<SessionManager>>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    tracing::info!("Creating SSH session: {}@{}:{}", config.username, config.host, config.port);
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

// --- Group API Commands ---

#[tauri::command]
async fn save_groups(
    store_data: groups::GroupStore,
    app: AppHandle,
) -> Result<(), String> {
    tracing::debug!("Saving {} groups, next_id={}", store_data.groups.len(), store_data.next_group_id);
    let store = app.store("groups.json").map_err(|e| e.to_string())?;
    store.set("groups", serde_json::to_value(&store_data).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn load_groups(app: AppHandle) -> Result<groups::GroupStore, String> {
    let store = app.store("groups.json").map_err(|e| e.to_string())?;
    match store.get("groups") {
        Some(value) => {
            let data: groups::GroupStore = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
            tracing::debug!("Loaded {} groups, next_id={}", data.groups.len(), data.next_group_id);
            Ok(data)
        }
        None => Ok(groups::GroupStore {
            groups: vec![],
            next_group_id: 1,
        }),
    }
}

// --- Logging ---

fn cleanup_old_logs(log_dir: &Path, max_total_size_mb: u64) {
    let Ok(entries) = std::fs::read_dir(log_dir) else {
        return;
    };

    let mut log_files: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "log"))
        .filter_map(|e| {
            let metadata = e.metadata().ok()?;
            let size = metadata.len();
            let modified = metadata.modified().ok()?;
            Some((e.path(), size, modified))
        })
        .collect();

    log_files.sort_by_key(|(_, _, modified)| *modified);

    let max_size_bytes = max_total_size_mb * 1024 * 1024;
    let mut total_size: u64 = log_files.iter().map(|(_, size, _)| size).sum();

    for (path, size, _) in log_files {
        if total_size <= max_size_bytes {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total_size = total_size.saturating_sub(size);
        }
    }
}

fn init_logging(log_dir: &Path, config: &LogConfig) -> tracing_subscriber::reload::Handle<EnvFilter, tracing_subscriber::Registry> {
    std::fs::create_dir_all(log_dir).ok();

    let file_appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("xsterm")
        .filename_suffix("log")
        .max_log_files(config.max_log_files)
        .build(log_dir)
        .expect("Failed to create rolling file appender");

    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    let env_filter = EnvFilter::new(&config.log_level);
    let (reload_layer, reload_handle) = tracing_subscriber::reload::Layer::new(env_filter);

    tracing_subscriber::registry()
        .with(reload_layer)
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

    std::mem::forget(_guard);
    reload_handle
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

#[tauri::command]
async fn get_log_config(app: AppHandle) -> Result<LogConfig, String> {
    let store = app.store("log_config.json").map_err(|e| e.to_string())?;
    match store.get("config") {
        Some(value) => {
            let config: LogConfig = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
            Ok(config)
        }
        None => Ok(LogConfig::default()),
    }
}

#[tauri::command]
async fn set_log_config(
    config: LogConfig,
    app: AppHandle,
    state: State<'_, Arc<Mutex<reload::Handle<EnvFilter, tracing_subscriber::Registry>>>>,
) -> Result<(), String> {
    let store = app.store("log_config.json").map_err(|e| e.to_string())?;
    store.set("config", serde_json::to_value(&config).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())?;

    let new_filter = EnvFilter::new(&config.log_level);
    let handle = state.lock().map_err(|e| e.to_string())?;
    handle.reload(new_filter).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn get_log_dir(app: AppHandle) -> Result<String, String> {
    let log_dir = app.app_handle().path().app_log_dir().unwrap_or_else(|_| PathBuf::from("."));
    log_dir.to_str().map(|s| s.to_string()).ok_or_else(|| "Invalid log dir path".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|panic_info| {
        eprintln!("PANIC: {}", panic_info);
        tracing::error!("PANIC: {}", panic_info);
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let log_dir = app.handle().path().app_log_dir().unwrap_or_else(|_| PathBuf::from("."));
            let config = get_log_config_impl(app.handle())?;
            cleanup_old_logs(&log_dir, config.max_file_size * config.max_log_files as u64);
            let reload_handle = init_logging(&log_dir, &config);
            app.manage(Arc::new(Mutex::new(reload_handle)));
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
            save_groups,
            load_groups,
            log_message,
            get_log_config,
            set_log_config,
            get_log_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn get_log_config_impl(app: &AppHandle) -> Result<LogConfig, String> {
    let store = app.store("log_config.json").map_err(|e| e.to_string())?;
    match store.get("config") {
        Some(value) => {
            let config: LogConfig = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
            Ok(config)
        }
        None => Ok(LogConfig::default()),
    }
}
