//! xsterm Tauri backend.
//!
//! Layered as:
//! - `command`: Tauri command handlers invoked from the frontend.
//! - `connect`: connection / session layer built on xscore.
//! - `feature`: product features (logging).
//! - `shared`: cross-cutting data types and error helpers.

mod command;
mod connect;
mod feature;
mod shared;

use connect::registry::TerminalRegistry;
use feature::logging::{cleanup_old_logs, get_log_config_impl, init_logging};
use std::sync::Arc;
use tauri::Manager;

#[cfg(target_os = "windows")]
fn disable_webview2_browser_accelerators(app: &tauri::AppHandle) {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;

    let Some(window) = app.get_webview_window("main") else {
        tracing::warn!("main webview window not found; browser accelerator keys remain enabled");
        return;
    };

    if let Err(err) = window.with_webview(|webview| {
        let controller = webview.controller();
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else {
            tracing::warn!("failed to access WebView2 core");
            return;
        };
        let Ok(settings) = (unsafe { core.Settings() }) else {
            tracing::warn!("failed to access WebView2 settings");
            return;
        };
        let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() else {
            tracing::warn!("failed to access WebView2 settings (ICoreWebView2Settings3)");
            return;
        };
        if let Err(err) = unsafe { settings3.SetAreBrowserAcceleratorKeysEnabled(false) } {
            tracing::warn!("failed to disable WebView2 browser accelerator keys: {err}");
        }
    }) {
        tracing::warn!("failed to access WebView2 handle: {err}");
    }
}

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
        .setup(|app| {
            // --- logging ---
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

            // --- per-session logging + TerminalRegistry ---
            use feature::logging::terminal_log::TerminalLogRegistry;
            let terminal_log_dir = app
                .handle()
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| log_dir.clone())
                .join("session-logs");
            let terminal_logs = Arc::new(TerminalLogRegistry::new(terminal_log_dir));
            app.manage(Arc::new(TerminalRegistry::new(terminal_logs)));

            // --- raw output router + event emitter backend ---
            use connect::event_emitter::TauriEventEmitter;
            use connect::output::OutputRouter;
            app.manage(Arc::new(OutputRouter::default()));
            app.manage(Arc::new(TauriEventEmitter::new(app.handle().clone())));

            #[cfg(target_os = "windows")]
            disable_webview2_browser_accelerators(app.handle());

            Ok(())
        })
        .invoke_handler(command::all_handlers())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
