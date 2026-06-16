use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{fmt, layer::SubscriberExt, reload, util::SubscriberInitExt, EnvFilter};

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

pub fn cleanup_old_logs(log_dir: &Path, max_total_size_mb: u64) {
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

pub fn init_logging(
    log_dir: &Path,
    config: &LogConfig,
) -> reload::Handle<EnvFilter, tracing_subscriber::Registry> {
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

pub fn get_log_config_impl(app: &AppHandle) -> Result<LogConfig, String> {
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
