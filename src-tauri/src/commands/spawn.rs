use portable_pty::PtySize;
use tauri::State;

use crate::core::session::SessionId;
use crate::core::shell::ShellKind;
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn spawn_terminal(
    rows: u16,
    cols: u16,
    shell: ShellKind,
    state: State<'_, AppState>,
) -> Result<SessionId, AppError> {
    let mut manager = state.manager.lock().map_err(|_| AppError::LockPoisoned)?;
    manager
        .spawn(
            shell,
            PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            },
        )
        .map_err(AppError::Session)
}
