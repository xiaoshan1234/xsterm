//! Map tmux control-mode notification names to frontend-facing events.
//!
//! This layer understands the tmux `-CC` notification vocabulary (`%window-add`,
//! `%pane-mode-changed`, `%session-changed`, etc.) and converts each
//! notification into a [`TmuxControlEvent`]. It also triggers state-sync
//! requests when structural changes occur (new window/pane/session) because
//! tmux does not send the full state in a single notification.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::infrastructure::app_backend::AppBackend;
use crate::tmux::commands::list_windows;
use crate::tmux::state::TmuxControlEvent;
use crate::tmux::state_tracker::StateTracker;

/// Convert a tmux notification into a control event.
///
/// May mutate `tracker` (pause / copy-mode state) and `exited`, and may emit
/// a `tmux-request-sync` event through `backend`.
pub fn map_notification<B: AppBackend>(
    backend: &B,
    session_id: u32,
    name: &str,
    args: &[String],
    raw: &str,
    tracker: &StateTracker,
    exited: &Arc<AtomicBool>,
) -> TmuxControlEvent {
    match name {
        // -----------------------------------------------------------------
        // Flow control
        // -----------------------------------------------------------------
        "pause" if !args.is_empty() => {
            let pane_id = args[0].clone();
            tracker.mark_paused(&pane_id);
            TmuxControlEvent::PanePaused { pane_id }
        }
        "continue" if !args.is_empty() => {
            let pane_id = args[0].clone();
            tracker.mark_continued(&pane_id);
            TmuxControlEvent::PaneContinued { pane_id }
        }

        // -----------------------------------------------------------------
        // Session lifecycle
        // -----------------------------------------------------------------
        "session-changed" if args.len() >= 2 => {
            request_state_sync(backend, session_id, "");
            TmuxControlEvent::SessionChanged {
                session_id: args[0].clone(),
                name: args[1].clone(),
            }
        }
        "session-renamed" if !args.is_empty() => TmuxControlEvent::SessionRenamed {
            name: args[0].clone(),
        },

        // -----------------------------------------------------------------
        // Window lifecycle
        // -----------------------------------------------------------------
        "window-add" if !args.is_empty() => {
            request_state_sync(backend, session_id, "");
            TmuxControlEvent::Unknown {
                raw: raw.to_string(),
            }
        }
        "unlinked-window-add" if !args.is_empty() => TmuxControlEvent::Unknown {
            raw: raw.to_string(),
        },
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

        // -----------------------------------------------------------------
        // Pane lifecycle
        // -----------------------------------------------------------------
        "pane-add" if !args.is_empty() => {
            request_state_sync(backend, session_id, "");
            TmuxControlEvent::Unknown {
                raw: raw.to_string(),
            }
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
            let in_copy_mode = tracker.toggle_copy_mode(&pane_id);
            TmuxControlEvent::PaneModeChanged {
                pane_id,
                in_copy_mode,
            }
        }

        // -----------------------------------------------------------------
        // Control-mode exit
        // -----------------------------------------------------------------
        "exit" => {
            exited.store(true, Ordering::Relaxed);
            TmuxControlEvent::Exit {
                reason: args.first().cloned(),
            }
        }

        // -----------------------------------------------------------------
        // Unrecognized notifications
        // -----------------------------------------------------------------
        _ => TmuxControlEvent::Unknown {
            raw: raw.to_string(),
        },
    }
}

/// Ask the frontend to issue a `list-windows` command so state stays in sync.
fn request_state_sync<B: AppBackend>(backend: &B, session_id: u32, tmux_session_id: &str) {
    let command = list_windows(tmux_session_id);
    tracing::debug!(
        "tmux session {} requesting state sync: {}",
        session_id,
        command.trim()
    );
    let payload = (session_id, command);
    if let Err(e) = backend.emit("tmux-request-sync", &serde_json::to_vec(&payload).unwrap()) {
        tracing::error!("Failed to emit tmux sync request: {}", e);
    }
}
