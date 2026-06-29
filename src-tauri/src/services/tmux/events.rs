//! Event emission helpers for tmux control mode.
//!
//! This thin layer serializes tmux-related Rust types into JSON payloads and
//! emits them through the [`AppBackend`] so the frontend can react to pane
//! output, control notifications, list results, and session closure.

use crate::infrastructure::app_backend::AppBackend;
use crate::services::tmux::parser::{PaneListEntry, WindowListEntry};
use crate::services::tmux::state::{TmuxControlEvent, TmuxPaneOutput};

/// Serialize and emit an event to the frontend.
fn emit_event<B: AppBackend, T: serde::Serialize>(
    backend: &B,
    event_name: &str,
    session_id: u32,
    payload: &T,
) {
    let wrapped = (session_id, payload);
    if let Err(e) = backend.emit(event_name, &serde_json::to_vec(&wrapped).unwrap()) {
        tracing::error!("Failed to emit {}: {}", event_name, e);
    }
}

pub fn emit_pane_output<B: AppBackend>(
    backend: &B,
    session_id: u32,
    pane_id: String,
    data: Vec<u8>,
) {
    let output = TmuxPaneOutput { pane_id, data };
    emit_event(backend, "tmux-pane-output", session_id, &output);
}

pub fn emit_control_event<B: AppBackend>(backend: &B, session_id: u32, event: TmuxControlEvent) {
    emit_event(backend, "tmux-control-event", session_id, &event);
}

pub fn emit_closed<B: AppBackend>(backend: &B, session_id: u32) {
    emit_event(backend, "session-closed", session_id, &session_id);
}

/// Emit captured pane text as a normal pane output event.
pub fn emit_captured_pane_output<B: AppBackend>(
    backend: &B,
    session_id: u32,
    pane_id: String,
    lines: Vec<String>,
) {
    if lines.is_empty() {
        return;
    }
    let text = lines.join("\r\n") + "\r\n";
    emit_pane_output(backend, session_id, pane_id, text.into_bytes());
}

/// Emit a `CommandError` control event for a failed command response.
pub fn emit_command_error<B: AppBackend>(backend: &B, session_id: u32, lines: Vec<String>) {
    let message = lines.join("\n");
    emit_control_event(
        backend,
        session_id,
        TmuxControlEvent::CommandError {
            cmd_num: 0,
            message,
        },
    );
}

/// Convert parsed list types into frontend-facing control events.
pub fn emit_window_list<B: AppBackend>(
    backend: &B,
    session_id: u32,
    windows: Vec<WindowListEntry>,
) {
    emit_control_event(
        backend,
        session_id,
        TmuxControlEvent::WindowList {
            windows: windows.into_iter().map(Into::into).collect(),
        },
    );
}

pub fn emit_pane_list<B: AppBackend>(backend: &B, session_id: u32, panes: Vec<PaneListEntry>) {
    emit_control_event(
        backend,
        session_id,
        TmuxControlEvent::PaneList {
            panes: panes.into_iter().map(Into::into).collect(),
        },
    );
}
