use tauri::State;

use crate::core::session::SessionId;
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn write_terminal(id: u64, data: Vec<u8>, state: State<'_, AppState>) -> Result<(), AppError> {
    let mut manager = state.manager.lock().map_err(|_| AppError::LockPoisoned)?;
    manager
        .write(SessionId(id), &data)
        .map_err(AppError::Session)
}
