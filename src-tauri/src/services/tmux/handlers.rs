//! Dispatch parsed tmux control-mode messages to frontend events.
//!
//! This module sits between the protocol parser and the event emission layer.
//! It routes pane output (respecting flow-control pause state), command
//! responses, list results, captured pane text, and notifications to the
//! appropriate frontend events.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use crate::infrastructure::app_backend::AppBackend;
use crate::services::tmux::events::{
    emit_captured_pane_output, emit_command_error, emit_control_event, emit_pane_list,
    emit_pane_output, emit_window_list,
};
use crate::services::tmux::notification::map_notification;
use crate::services::tmux::parser::TmuxMessage;
use crate::services::tmux::state_tracker::StateTracker;

/// Backwards-compatible alias for the state tracker used by the forwarder.
pub type DispatchState = StateTracker;

/// Dispatch one parsed tmux message to the appropriate frontend event.
pub fn handle_message<B: AppBackend>(
    backend: &B,
    session_id: u32,
    message: TmuxMessage,
    state: &StateTracker,
    exited: &Arc<AtomicBool>,
) {
    tracing::trace!("tmux session {} handle message {:?}", session_id, message);
    match message {
        TmuxMessage::Output { pane_id, data }
        | TmuxMessage::ExtendedOutput { pane_id, data, .. } => {
            if !state.is_paused(&pane_id) {
                emit_pane_output(backend, session_id, pane_id, data);
            }
        }
        TmuxMessage::Notification { name, args, raw } => {
            let event = map_notification(backend, session_id, &name, &args, &raw, state, exited);
            emit_control_event(backend, session_id, event);
        }
        TmuxMessage::WindowList(windows) => {
            emit_window_list(backend, session_id, windows);
        }
        TmuxMessage::PaneList(panes) => {
            emit_pane_list(backend, session_id, panes);
        }
        TmuxMessage::CapturedPaneOutput { pane_id, lines } => {
            emit_captured_pane_output(backend, session_id, pane_id, lines);
        }
        TmuxMessage::CommandResponse { success, lines, .. } => {
            if !success {
                emit_command_error(backend, session_id, lines);
            }
        }
        TmuxMessage::Unknown { raw } => {
            tracing::trace!("tmux session {} unknown line: {}", session_id, raw);
        }
    }
}
