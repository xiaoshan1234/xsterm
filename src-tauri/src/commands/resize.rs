use portable_pty::PtySize;
use tauri::State;

use crate::core::session::SessionId;
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn resize_terminal(
    id: u64,
    rows: u16,
    cols: u16,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let mut manager = state.manager.lock().map_err(|_| AppError::LockPoisoned)?;
    manager
        .resize(
            SessionId(id),
            PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            },
        )
        .map_err(AppError::Session)
}
