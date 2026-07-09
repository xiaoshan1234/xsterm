//! Core tmux `-CC` control mode service.
//!
//! This module is the protocol and state foundation for the tmux control-mode
//! backend. It deliberately does not depend on `SessionManager` or Tauri
//! commands; that integration is performed by the higher-level session layer.

pub mod channel_io;
pub mod commands;
pub mod events;
pub mod forwarder;
pub mod handlers;
pub mod notification;
pub mod parser;
pub mod session;
pub mod state;
pub mod state_tracker;

pub use channel_io::CapturePaneQueue;
pub use commands::{
    build_tmux_argv, escape_tmux_keys, quote_tmux_arg, resize_window_for_pane, send_keys,
};
pub use events::{
    emit_captured_pane_output, emit_closed, emit_command_error, emit_control_event,
    emit_pane_list, emit_pane_output, emit_state_snapshot, emit_window_list,
};
pub use forwarder::spawn_control_forwarder;
pub use handlers::{handle_message, DispatchState};
pub use notification::map_notification;
pub use parser::{PaneListEntry, TmuxControlParser, TmuxMessage, WindowListEntry};
pub use session::local::create_tmux_session;
pub use session::ssh::create_ssh_tmux_session;
pub use session::{TmuxSession, TmuxSessionHandles};
pub use state::{
    TmuxControlEvent, TmuxPane, TmuxPaneOutput, TmuxStateSnapshot, TmuxWindow,
};
pub use state_tracker::StateTracker;
