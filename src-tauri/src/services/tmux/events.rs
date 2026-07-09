use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::infrastructure::app_backend::AppBackend;
use crate::services::tmux::parser::{PaneListEntry, WindowListEntry};
use crate::services::tmux::state::{TmuxControlEvent, TmuxPaneOutput};
use crate::services::tmux::state_tracker::StateTracker;

/// Snapshot of a tmux session entry delivered through `tmux-state-sync`.
///
/// This mirrors the contract used by the existing `tmux_underlay` layer so that
/// the current frontend can consume the event without changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxStateSyncSession {
    pub id: String,
    pub name: String,
}

/// Snapshot of a tmux window entry delivered through `tmux-state-sync`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxStateSyncWindow {
    pub id: String,
    pub session_id: String,
    pub name: String,
    pub active: bool,
    pub layout: String,
}

/// Snapshot of a tmux pane entry delivered through `tmux-state-sync`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxStateSyncPane {
    pub id: String,
    pub window_id: String,
    pub session_id: String,
    pub title: String,
    pub active: bool,
    pub width: u16,
    pub height: u16,
}

/// Complete tmux state snapshot delivered through `tmux-state-sync`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxStateSyncSnapshot {
    pub sessions: HashMap<String, TmuxStateSyncSession>,
    pub windows: HashMap<String, TmuxStateSyncWindow>,
    pub panes: HashMap<String, TmuxStateSyncPane>,
}

/// Emit an event to the frontend with a JSON payload.
///
/// The payload is wrapped in a `(session_id, payload)` tuple to match the
/// frontend contract used by the existing session layer.
fn emit_event<B: AppBackend, T: serde::Serialize>(
    backend: &B,
    event_name: &str,
    session_id: u32,
    payload: T,
) {
    let wrapped = (session_id, payload);
    match serde_json::to_vec(&wrapped) {
        Ok(bytes) => {
            if let Err(e) = backend.emit(event_name, &bytes) {
                tracing::error!("Failed to emit {}: {}", event_name, e);
            }
        }
        Err(e) => {
            tracing::error!("Failed to serialize {} payload: {}", event_name, e);
        }
    }
}

/// Emit a `tmux-pane-output` event carrying raw output for a single pane.
pub fn emit_pane_output<B: AppBackend>(
    backend: &B,
    session_id: u32,
    output: &TmuxPaneOutput,
) {
    emit_event(backend, "tmux-pane-output", session_id, output);
}

/// Emit a `tmux-pane-output` event for captured pane history.
///
/// Captured output is delivered through the same frontend channel as live
/// output so that `Terminal.tsx` can render it without a separate listener.
pub fn emit_captured_pane_output<B: AppBackend>(
    backend: &B,
    session_id: u32,
    output: &TmuxPaneOutput,
) {
    if output.data.is_empty() {
        return;
    }
    emit_event(backend, "tmux-pane-output", session_id, output);
}

/// Emit a `tmux-control-event` event carrying a parsed control-mode notification.
pub fn emit_control_event<B: AppBackend>(
    backend: &B,
    session_id: u32,
    event: TmuxControlEvent,
) {
    emit_event(backend, "tmux-control-event", session_id, event);
}

/// Emit a `tmux-control-event` carrying a command error message.
pub fn emit_command_error<B: AppBackend>(backend: &B, session_id: u32, message: &str) {
    emit_control_event(
        backend,
        session_id,
        TmuxControlEvent::CommandError {
            cmd_num: 0,
            lines: vec![message.to_string()],
        },
    );
}

/// Emit a `session-closed` event when the tmux control session ends.
pub fn emit_closed<B: AppBackend>(backend: &B, session_id: u32) -> Result<(), String> {
    let bytes = serde_json::to_vec(&session_id).map_err(|e| e.to_string())?;
    backend.emit("session-closed", &bytes)
}

/// Emit a `tmux-state-sync` snapshot carrying the provided sessions, windows, and panes.
pub fn emit_state_snapshot<B: AppBackend>(
    backend: &B,
    session_id: u32,
    sessions: HashMap<String, TmuxStateSyncSession>,
    windows: HashMap<String, TmuxStateSyncWindow>,
    panes: HashMap<String, TmuxStateSyncPane>,
) {
    let snapshot = TmuxStateSyncSnapshot {
        sessions,
        windows,
        panes,
    };
    emit_event(backend, "tmux-state-sync", session_id, snapshot);
}

/// Update the accumulated window list in `state` and emit a complete
/// `tmux-state-sync` snapshot if the pane list is also available.
pub fn emit_window_list<B: AppBackend>(
    backend: &B,
    session_id: u32,
    state: &StateTracker,
    entries: Vec<WindowListEntry>,
) {
    state.update_windows(entries);
    if let Some(snapshot) = state.build_snapshot() {
        emit_state_snapshot(
            backend,
            session_id,
            snapshot.sessions,
            snapshot.windows,
            snapshot.panes,
        );
    }
}

/// Update the accumulated pane list in `state` and emit a complete
/// `tmux-state-sync` snapshot if the window list is also available.
pub fn emit_pane_list<B: AppBackend>(
    backend: &B,
    session_id: u32,
    state: &StateTracker,
    entries: Vec<PaneListEntry>,
) {
    state.update_panes(entries);
    if let Some(snapshot) = state.build_snapshot() {
        emit_state_snapshot(
            backend,
            session_id,
            snapshot.sessions,
            snapshot.windows,
            snapshot.panes,
        );
    }
}
