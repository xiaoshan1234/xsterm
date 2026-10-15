//! L1 — `#[tauri::command]` 集合。
//! 每个 command 第一行 `state.manager.lock()`,主体委托 [`crate::core::session::SessionManager`]。

pub mod resize;
pub mod session;
pub mod spawn;
pub mod write;
