use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_store::StoreExt;
use tracing_subscriber::{EnvFilter, Registry, reload};

use crate::error::StringError;
use crate::logging_setup::LogConfig;

/// Log a message from the frontend at the requested level.
#[tauri::command]
pub async fn log_message(
    level: String,
    source: String,
    message: String,
    data: Option<String>,
) -> Result<(), String> {
    let msg = format!("[{}] {} - {}", source, message, data.as_deref().unwrap_or(""));
    match level.as_str() {
        "DEBUG" => tracing::debug!(target: "frontend", "{}", msg),
        "WARN" => tracing::warn!(target: "frontend", "{}", msg),
        "ERROR" => tracing::error!(target: "frontend", "{}", msg),
        _ => tracing::info!(target: "frontend", "{}", msg),
    }
    Ok(())
}

/// Load the current log configuration from disk.
#[tauri::command]
pub async fn get_log_config(app: AppHandle) -> Result<LogConfig, String> {
    crate::logging_setup::get_log_config_impl(&app)
}

/// Save the log configuration and apply the new filter level immediately.
#[tauri::command]
pub async fn set_log_config(
    config: LogConfig,
    app: AppHandle,
    state: State<'_, Arc<Mutex<reload::Handle<EnvFilter, Registry>>>>,
) -> Result<(), String> {
    let store = app.store("log_config.json").map_err_string()?;
    store.set("config", serde_json::to_value(&config).map_err_string()?);
    store.save().map_err_string()?;

    let new_filter = EnvFilter::new(&config.log_level);
    let handle = state.lock().map_err(|e| e.to_string())?;
    handle.reload(new_filter).map_err_string()?;

    Ok(())
}

/// Return the application's log directory path.
#[tauri::command]
pub async fn get_log_dir(app: AppHandle) -> Result<String, String> {
    let log_dir = app.path().app_log_dir().unwrap_or_else(|_| PathBuf::from("."));
    log_dir
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid log dir path".to_string())
}
