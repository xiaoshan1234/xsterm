//! L1 — Tauri managed state。

use std::sync::Mutex;

use crate::core::session::SessionManager;

/// Tauri 管理的全局状态。命令 handler 通过 `tauri::State<'_, AppState>` 拿。
///
/// Reader 消息通道的 sender 由 [`SessionManager`] 内部持有;
/// `lib::run` 直接把 receiver 移交给 dispatch 线程,不经由本 state。
pub struct AppState {
    pub manager: Mutex<SessionManager>,
}
