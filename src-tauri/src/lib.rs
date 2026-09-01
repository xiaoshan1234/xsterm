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
use std::sync::Arc;
use tauri::{Emitter, Manager};

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
        .plugin(tauri_plugin_clipboard_manager::init())
        // Perf 004: SessionManager uses DashMap + AtomicU32 internally, so no
        // outer Mutex is needed — concurrent IPC handlers touch different
        // shards in parallel without serialising on each other.
        .manage(Arc::new(SessionManager::new()))
        // Tauri 2's `Builder::setup` is a single `Option<Box<F>>` slot — the
        // *last* `.setup(...)` call wins, all earlier ones are silently
        // discarded. Earlier drafts split this into two `.setup()` blocks
        // (logging first, RealAppBackend second) and lost the logging
        // initialisation; consolidate everything into one block so both
        // `tracing` and the binary output channel get initialized.
        //
        // Perf 001: emit the binary `session-output` Channel to the frontend
        // so it can listen for raw bytes instead of going through
        // JSON `[id, [byte, byte, ...]]`. The emit fires before the frontend
        // is loaded (no listener yet), so it's effectively a no-op — the
        // frontend pulls the channel via the `get_session_output_channel`
        // command after the WebView is up. See `binary_frame.rs` for the
        // wire format.
        .setup(|app| {
            // --- logging (was first setup block) ---
            let log_dir = app
                .handle()
                .path()
                .app_log_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let config = get_log_config_impl(app.handle())?;
            cleanup_old_logs(&log_dir, config.max_file_size * config.max_log_files as u64);
            let reload_handle = init_logging(&log_dir, &config);
            app.manage(Arc::new(reload_handle));
            tracing::info!("Application starting, log dir: {:?}", log_dir);

            // --- binary output channel (was second setup block) ---
            use infrastructure::app_backend::RealAppBackend;
            let backend = RealAppBackend::new(app.handle().clone());
            let channel = backend.session_output_channel.clone();
            app.manage(Arc::new(backend));
            if let Err(e) = app.emit("session-output-channel", channel) {
                tracing::error!("Failed to emit session-output channel: {e}");
            }

            Ok(())
        })
        .invoke_handler(commands::all_handlers())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}