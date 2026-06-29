//! Tmux control mode integration.
//!
//! This module is a service/session type: it exposes the tmux session
//! lifecycle and protocol handling needed by [`SessionManager`], while keeping
//! the parser, commands, and state types as implementation details.

pub(crate) mod channel_io;
pub(crate) mod commands;
pub(crate) mod events;
pub(crate) mod forwarder;
pub(crate) mod handlers;
pub(crate) mod notification;
pub(crate) mod parser;
pub(crate) mod session;
pub(crate) mod state;
pub(crate) mod state_tracker;

pub use session::{create_ssh_tmux_session, create_tmux_session, TmuxSession, TmuxSessionHandles};
pub use commands::{resize_window_for_pane, send_keys};
