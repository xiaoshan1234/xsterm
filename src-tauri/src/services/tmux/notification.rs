use std::io::Write;

use crate::services::tmux::commands::list_windows;
use crate::services::tmux::state::TmuxControlEvent;
use crate::services::tmux::state_tracker::StateTracker;

/// Map a tmux control-mode notification name and its arguments to a frontend
/// control event.
///
/// Side effects on `tracker` are applied for flow-control and copy-mode
/// notifications. Structural changes may write a `list-windows` command to
/// `session_writer` to trigger a state re-sync.
pub fn map_notification(
    name: &str,
    args: &[String],
    tracker: &StateTracker,
    _session_id: u32,
    session_writer: &mut dyn Write,
) -> TmuxControlEvent {
    match name {
        "output" if !args.is_empty() => TmuxControlEvent::Unknown {
            raw: format!("output {}", args.join(" ")),
        },
        "pause" if !args.is_empty() => {
            tracker.mark_paused(&args[0]);
            TmuxControlEvent::PanePaused {
                pane_id: args[0].clone(),
            }
        }
        "continue" if !args.is_empty() => {
            tracker.mark_continued(&args[0]);
            TmuxControlEvent::PaneContinued {
                pane_id: args[0].clone(),
            }
        }
        "session-changed" if args.len() >= 2 => {
            request_state_sync(session_writer, "");
            TmuxControlEvent::SessionChanged {
                session_id: args[0].clone(),
                name: args[1].clone(),
            }
        }
        "session-renamed" if !args.is_empty() => {
            request_state_sync(session_writer, "");
            TmuxControlEvent::SessionRenamed {
                name: args[0].clone(),
            }
        }
        "window-add" if !args.is_empty() => {
            request_state_sync(session_writer, "");
            TmuxControlEvent::WindowAdded {
                window_id: args[0].clone(),
            }
        }
        "window-close" if !args.is_empty() => TmuxControlEvent::WindowClosed {
            window_id: args[0].clone(),
        },
        "window-renamed" if args.len() >= 2 => TmuxControlEvent::WindowRenamed {
            window_id: args[0].clone(),
            name: args[1].clone(),
        },
        "layout-change" if args.len() >= 2 => {
            request_state_sync(session_writer, "");
            TmuxControlEvent::LayoutChanged {
                window_id: args[0].clone(),
                layout: args[1].clone(),
            }
        }
        "pane-mode-changed" if !args.is_empty() => {
            tracker.toggle_copy_mode(&args[0]);
            TmuxControlEvent::PaneModeChanged {
                pane_id: args[0].clone(),
                mode: String::new(),
            }
        }
        "exit" => TmuxControlEvent::Exit {
            reason: args.first().cloned(),
        },
        _ => TmuxControlEvent::Unknown {
            raw: format!("{} {}", name, args.join(" ")),
        },
    }
}

/// Write a `list-windows` command to the session writer to request a full state
/// re-sync after a structural change.
fn request_state_sync(session_writer: &mut dyn Write, tmux_session_id: &str) {
    let command = list_windows(tmux_session_id);
    if let Err(e) = session_writer.write_all(command.as_bytes()) {
        tracing::error!("Failed to request state sync: {}", e);
    }
    if let Err(e) = session_writer.flush() {
        tracing::error!("Failed to flush state sync request: {}", e);
    }
}
