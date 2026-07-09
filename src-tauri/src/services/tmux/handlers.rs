use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::infrastructure::app_backend::AppBackend;
use crate::services::tmux::commands::list_panes;
use crate::services::tmux::events::{
    emit_captured_pane_output, emit_closed, emit_command_error, emit_control_event,
    emit_pane_output, emit_pane_list, emit_window_list,
};
use crate::services::tmux::notification::map_notification;
use crate::services::tmux::parser::TmuxMessage;
use crate::services::tmux::state::TmuxPaneOutput;
use crate::services::tmux::state_tracker::StateTracker;

/// Alias for the per-session state used by the message dispatch pipeline.
pub type DispatchState = StateTracker;

/// Dispatch a parsed tmux message to the appropriate emission helper.
///
/// Returns `Ok(true)` when the message indicates the session should close
/// (e.g. `%exit`).
pub fn handle_message<B: AppBackend>(
    message: TmuxMessage,
    state: &DispatchState,
    backend: &B,
    session_id: u32,
    session_writer: &mut dyn Write,
    exited: &AtomicBool,
) -> Result<bool, String> {
    match message {
        TmuxMessage::Output { pane_id, data } => {
            if !state.is_paused(&pane_id) {
                emit_pane_output(
                    backend,
                    session_id,
                    &TmuxPaneOutput { pane_id, data },
                );
            }
            Ok(false)
        }
        TmuxMessage::ExtendedOutput { pane_id, age_ms: _, data } => {
            if !state.is_paused(&pane_id) {
                emit_pane_output(
                    backend,
                    session_id,
                    &TmuxPaneOutput { pane_id, data },
                );
            }
            Ok(false)
        }
        TmuxMessage::CapturedPaneOutput { pane_id, data } => {
            emit_captured_pane_output(
                backend,
                session_id,
                &TmuxPaneOutput { pane_id, data },
            );
            Ok(false)
        }
        TmuxMessage::WindowList(entries) => {
            emit_window_list(backend, session_id, state, entries);
            let command = list_panes("");
            if let Err(e) = session_writer.write_all(command.as_bytes()) {
                tracing::error!("Failed to request pane list after window list: {}", e);
            }
            if let Err(e) = session_writer.flush() {
                tracing::error!("Failed to flush pane list request: {}", e);
            }
            Ok(false)
        }
        TmuxMessage::PaneList(entries) => {
            emit_pane_list(backend, session_id, state, entries);
            Ok(false)
        }
        TmuxMessage::CommandResponse { .. } => Ok(false),
        TmuxMessage::CommandError { cmd_num: _, lines } => {
            emit_command_error(backend, session_id, &lines.join("\n"));
            Ok(false)
        }
        TmuxMessage::Exit { reason } => {
            exited.store(true, Ordering::Relaxed);
            emit_closed(backend, session_id)?;
            if let Some(reason) = reason {
                tracing::info!("tmux session {} exited: {}", session_id, reason);
            } else {
                tracing::info!("tmux session {} exited", session_id);
            }
            Ok(true)
        }
        TmuxMessage::Notification { name, args } => {
            let event = map_notification(
                &name,
                &args,
                state,
                session_id,
                session_writer,
            );
            emit_control_event(backend, session_id, event);
            Ok(false)
        }
        TmuxMessage::Unknown { raw } => {
            tracing::trace!("Unhandled tmux message: {}", raw);
            Ok(false)
        }
    }
}
