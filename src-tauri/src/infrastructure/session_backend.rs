//! Abstractions for the transport layer of a terminal session.
//!
//! This trait unifies the public surface area of backend implementations (PTY
//! shell sessions, SSH sessions, and future tmux/serial/telnet sessions) so
//! that [`SessionManager`](crate::services::session_manager::SessionManager) can
//! interact with any session type through a uniform interface.

use crate::models::capabilities::CapabilityFlags;
use crate::models::session::SessionInfo;

/// Unified interface for session transports backed by PTY/SSH (and future
/// tmux/serial/telnet implementations).
///
/// The `Send` bound keeps implementor burden low for future backends such as
/// tmux, serial, or telnet that may carry platform-specific state.
pub trait SessionBackend: Send {
    /// Returns the metadata for this session.
    fn info(&self) -> &SessionInfo;

    /// Returns the capability flags for this session transport.
    fn capabilities(&self) -> &CapabilityFlags;

    /// Write raw bytes to the session's input channel.
    fn write(&mut self, data: &[u8]) -> Result<(), String>;

    /// Resize the terminal to the given dimensions.
    fn resize(&mut self, rows: u16, cols: u16) -> Result<(), String>;

    /// Close the session, releasing all associated resources.
    ///
    /// Uses consuming `self: Box<Self>` semantics — the implementor takes full
    /// ownership and is dropped when the method returns.
    fn close(self: Box<Self>) -> Result<(), String>;
}
