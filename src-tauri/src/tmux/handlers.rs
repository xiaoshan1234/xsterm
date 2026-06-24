use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::infrastructure::app_backend::AppBackend;
use crate::tmux::commands::list_windows;
use crate::tmux::events::{
    emit_captured_pane_output, emit_command_error, emit_control_event, emit_pane_list,
    emit_pane_output, emit_window_list,
};
use crate::tmux::parser::TmuxMessage;
use crate::tmux::state::TmuxControlEvent;

/// Per-session mutable state used while dispatching control messages.
pub struct DispatchState {
    pub paused_panes: Mutex<HashSet<String>>,
    pub copy_mode_panes: Mutex<HashSet<String>>,
}

impl Default for DispatchState {
    fn default() -> Self {
        Self {
            paused_panes: Mutex::new(HashSet::new()),
            copy_mode_panes: Mutex::new(HashSet::new()),
        }
    }
}

/// Dispatch one parsed tmux message to the appropriate frontend event.
pub fn handle_message<B: AppBackend>(
    backend: &B,
    session_id: u32,
    message: TmuxMessage,
    state: &DispatchState,
    exited: &Arc<AtomicBool>,
) {
    tracing::trace!("tmux session {} handle message {:?}", session_id, message);
    match message {
        TmuxMessage::Output { pane_id, data }
        | TmuxMessage::ExtendedOutput { pane_id, data, .. } => {
            let is_paused = state
                .paused_panes
                .lock()
                .map(|set| set.contains(&pane_id))
                .unwrap_or(false);
            if !is_paused {
                emit_pane_output(backend, session_id, pane_id, data);
            }
        }
        TmuxMessage::Notification { name, args, raw } => {
            handle_notification(backend, session_id, &name, args, &raw, state, exited);
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

/// Dispatch a tmux notification and emit the corresponding control event.
fn handle_notification<B: AppBackend>(
    backend: &B,
    session_id: u32,
    name: &str,
    args: Vec<String>,
    raw: &str,
    state: &DispatchState,
    exited: &Arc<AtomicBool>,
) {
    let event = match name {
        "pause" if !args.is_empty() => {
            let pane_id = args[0].clone();
            if let Ok(mut set) = state.paused_panes.lock() {
                set.insert(pane_id.clone());
            }
            TmuxControlEvent::PanePaused { pane_id }
        }
        "continue" if !args.is_empty() => {
            let pane_id = args[0].clone();
            if let Ok(mut set) = state.paused_panes.lock() {
                set.remove(&pane_id);
            }
            TmuxControlEvent::PaneContinued { pane_id }
        }
        "session-changed" if args.len() >= 2 => {
            request_state_sync(backend, session_id, "");
            TmuxControlEvent::SessionChanged {
                session_id: args[0].clone(),
                name: args[1].clone(),
            }
        }
        "window-add" if !args.is_empty() => {
            request_state_sync(backend, session_id, "");
            TmuxControlEvent::Unknown { raw: raw.to_string() }
        }
        "unlinked-window-add" if !args.is_empty() => {
            TmuxControlEvent::Unknown { raw: raw.to_string() }
        }
        "window-close" if !args.is_empty() => {
            request_state_sync(backend, session_id, "");
            TmuxControlEvent::WindowClosed {
                window_id: args[0].clone(),
            }
        }
        "unlinked-window-close" if !args.is_empty() => TmuxControlEvent::WindowClosed {
            window_id: args[0].clone(),
        },
        "window-renamed" if args.len() >= 2 => TmuxControlEvent::WindowRenamed {
            window_id: args[0].clone(),
            name: args[1].clone(),
        },
        "layout-changed" if args.len() >= 2 => TmuxControlEvent::LayoutChanged {
            window_id: args[0].clone(),
            layout: args[1].clone(),
        },
        "window-pane-changed" if args.len() >= 2 => TmuxControlEvent::WindowActivated {
            window_id: args[0].clone(),
        },
        "pane-add" if !args.is_empty() => {
            request_state_sync(backend, session_id, "");
            TmuxControlEvent::Unknown { raw: raw.to_string() }
        }
        "pane-close" if !args.is_empty() => TmuxControlEvent::PaneClosed {
            pane_id: args[0].clone(),
        },
        "pane-title-changed" if args.len() >= 2 => TmuxControlEvent::PaneTitleChanged {
            pane_id: args[0].clone(),
            title: args[1..].join(" "),
        },
        "pane-mode-changed" if !args.is_empty() => {
            let pane_id = args[0].clone();
            let in_copy_mode = if let Ok(mut set) = state.copy_mode_panes.lock() {
                if set.contains(&pane_id) {
                    set.remove(&pane_id);
                    false
                } else {
                    set.insert(pane_id.clone());
                    true
                }
            } else {
                false
            };
            TmuxControlEvent::PaneModeChanged {
                pane_id,
                in_copy_mode,
            }
        }
        "exit" => {
            exited.store(true, Ordering::Relaxed);
            TmuxControlEvent::Exit {
                reason: args.first().cloned(),
            }
        }
        _ => TmuxControlEvent::Unknown {
            raw: raw.to_string(),
        },
    };

    emit_control_event(backend, session_id, event);
}

/// Ask the frontend to issue a `list-windows` command so state stays in sync.
fn request_state_sync<B: AppBackend>(backend: &B, session_id: u32, tmux_session_id: &str) {
    let command = list_windows(tmux_session_id);
    tracing::debug!("tmux session {} requesting state sync: {}", session_id, command.trim());
    let payload = (session_id, command);
    if let Err(e) = backend.emit("tmux-request-sync", &serde_json::to_vec(&payload).unwrap()) {
        tracing::error!("Failed to emit tmux sync request: {}", e);
    }
}
