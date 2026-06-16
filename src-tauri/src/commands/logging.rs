use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_store::StoreExt;
use tracing_subscriber::{reload, EnvFilter, Registry};

use crate::logging_setup::LogConfig;

#[tauri::command]
pub async fn log_message(
    level: String,
    source: String,
    message: String,
    data: Option<String>,
) -> Result<(), String> {
    let msg = format!(
        "[{}] {} - {}",
        source,
        message,
        data.as_deref().unwrap_or("")
    );
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
pub async fn get_log_config(app: AppHandle) -> Result<LogConfig, String> {
    let store = app.store("log_config.json").map_err(|e| e.to_string())?;
    match store.get("config") {
        Some(value) => {
            let config: LogConfig =
                serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
            Ok(config)
        }
        None => Ok(LogConfig::default()),
    }
}

#[tauri::command]
pub async fn set_log_config(
    config: LogConfig,
    app: AppHandle,
    state: State<'_, Arc<Mutex<reload::Handle<EnvFilter, Registry>>>>,
) -> Result<(), String> {
    let store = app.store("log_config.json").map_err(|e| e.to_string())?;
    store.set(
        "config",
        serde_json::to_value(&config).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())?;

    let new_filter = EnvFilter::new(&config.log_level);
    let handle = state.lock().map_err(|e| e.to_string())?;
    handle.reload(new_filter).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_log_dir(app: AppHandle) -> Result<String, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    log_dir
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid log dir path".to_string())
}
