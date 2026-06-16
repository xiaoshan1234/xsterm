//! xsterm Tauri backend.
//!
//! The crate is organized into layers:
//! - `commands`: Tauri command handlers invoked from the frontend.
//! - `services`: Business logic and session lifecycle management.
//! - `infrastructure`: Low-level adapters for PTY, SSH, and the Tauri app handle.
//! - `models`: Plain data structures shared across layers.
//! - `logging_setup`: Application logging configuration and initialization.

mod commands;
mod error;
mod infrastructure;
mod logging_setup;
mod models;
mod services;

use logging_setup::{cleanup_old_logs, get_log_config_impl, init_logging};
use services::session_manager::SessionManager;
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Ensure panic messages are written both to stderr and the tracing log so
    // they are visible in the UI and preserved in log files.
    std::panic::set_hook(Box::new(|panic_info| {
        eprintln!("PANIC: {}", panic_info);
        tracing::error!("PANIC: {}", panic_info);
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let log_dir = app
                .handle()
                .path()
                .app_log_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let config = get_log_config_impl(app.handle())?;
            cleanup_old_logs(&log_dir, config.max_file_size * config.max_log_files as u64);
            let reload_handle = init_logging(&log_dir, &config);
            app.manage(Arc::new(Mutex::new(reload_handle)));
            tracing::info!("Application starting, log dir: {:?}", log_dir);
            Ok(())
        })
        .manage(Arc::new(Mutex::new(SessionManager::new())))
        .invoke_handler(commands::all_handlers())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
