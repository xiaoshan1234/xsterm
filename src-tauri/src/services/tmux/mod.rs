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

pub use session::local::create_tmux_session;
pub use session::ssh::create_ssh_tmux_session;
pub use session::TmuxSession;
