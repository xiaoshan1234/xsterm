//! Tauri 2 入口。
//! 架构约束:见 [`../../doc/arch/ARCHITECTURE.md` §4](https://example.invalid/doc/arch/ARCHITECTURE.md)。

mod commands;
mod core;
mod error;
mod events;
mod state;

use tauri::Emitter;

use crate::core::session::{reader_channel, ReaderMessage, SessionManager};
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (reader_tx, reader_rx) = reader_channel();
    let state = AppState {
        manager: std::sync::Mutex::new(SessionManager::new(reader_tx)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .setup(move |app| {
            start_dispatch(app.handle().clone(), reader_rx);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::spawn::spawn_terminal,
            commands::write::write_terminal,
            commands::resize::resize_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Reader 线程 → 前端的唯一桥。
/// 在 setup 中启动,进程退出时 `reader_tx` 被 drop,本线程在 `recv` 时收到 `Err` 后退出。
fn start_dispatch(app: tauri::AppHandle, rx: std::sync::mpsc::Receiver<ReaderMessage>) {
    std::thread::spawn(move || {
        while let Ok(msg) = rx.recv() {
            match msg {
                ReaderMessage::Data { chunk, .. } => {
                    if let Err(e) = app.emit(events::TERMINAL_DATA, chunk) {
                        eprintln!("failed to emit terminal-data: {e}");
                    }
                }
                ReaderMessage::Exit { .. } => {
                    // M1 单会话,不向前端发 exit。M2 多会话时 dispatch 这里 emit terminal-exit。
                }
            }
        }
    });
}
