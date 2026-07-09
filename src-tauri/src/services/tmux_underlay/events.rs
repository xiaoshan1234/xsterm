use crate::infrastructure::app_backend::AppBackend;
use crate::services::tmux_underlay::state::{TmuxConnectionError, TmuxPaneOutput, TmuxStateSnapshot};

/// Emit a `tmux-state-sync` event with the current snapshot.
pub fn emit_state_sync<B: AppBackend>(
    backend: &B,
    session_id: u32,
    state: &TmuxStateSnapshot,
) -> Result<(), String> {
    let payload = (session_id, state);
    let bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    backend.emit("tmux-state-sync", &bytes)
}

/// Emit a `tmux-pane-output` event for a single pane.
pub fn emit_pane_output<B: AppBackend>(
    backend: &B,
    session_id: u32,
    output: &TmuxPaneOutput,
) -> Result<(), String> {
    let payload = (session_id, output);
    let bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    backend.emit("tmux-pane-output", &bytes)
}

/// Emit a `tmux-connection-error` event with a user-readable message.
pub fn emit_connection_error<B: AppBackend>(
    backend: &B,
    session_id: u32,
    message: &str,
) -> Result<(), String> {
    let error = TmuxConnectionError {
        message: message.to_string(),
    };
    let payload = (session_id, error);
    let bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    backend.emit("tmux-connection-error", &bytes)
}

/// Emit `session-closed` when the underlay session or its channel ends.
pub fn emit_closed<B: AppBackend>(backend: &B, session_id: u32) -> Result<(), String> {
    let bytes = serde_json::to_vec(&session_id).map_err(|e| e.to_string())?;
    backend.emit("session-closed", &bytes)
}
