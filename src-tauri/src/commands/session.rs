use tauri::State;

use crate::core::session::{SessionId, SessionInfo, SessionManager};
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn close_session(id: u64, state: State<'_, AppState>) -> Result<(), AppError> {
    let mut manager = state.manager.lock().map_err(|_| AppError::LockPoisoned)?;
    close_session_impl(SessionId(id), &mut manager).map_err(AppError::Session)
}

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>) -> Result<Vec<SessionInfo>, AppError> {
    let manager = state.manager.lock().map_err(|_| AppError::LockPoisoned)?;
    Ok(manager.list())
}

fn close_session_impl(
    id: SessionId,
    manager: &mut SessionManager,
) -> Result<(), crate::core::session::SessionError> {
    // NotFound 视作成功:reconnect 流程 close 旧 session 时可能因 race 已退。
    match manager.close(id) {
        Ok(()) => Ok(()),
        Err(crate::core::session::SessionError::NotFound(_)) => Ok(()),
        Err(e) => Err(e),
    }
}
