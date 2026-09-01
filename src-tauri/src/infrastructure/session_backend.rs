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
///
/// `write` and `resize` take `&self` (not `&mut self`) so the manager can
/// hold an `Arc<ActiveSession>` and dispatch operations through shared
/// references — the underlying channel senders and internal locks
/// (`SyncSender`, `UnboundedSender`, `Arc<StdMutex<MasterPty>>`) are all
/// designed for shared access. See doc/maintenance/perf.md Perf 004.
///
/// `Sync` is required so `Arc<ActiveSession>` stored in the DashMap-backed
/// registry can be shared across Tauri IPC worker threads.
pub trait SessionBackend: Send + Sync {
    /// Returns the metadata for this session.
    fn info(&self) -> &SessionInfo;

    /// Returns the capability flags for this session transport.
    fn capabilities(&self) -> &CapabilityFlags;

    /// Write raw bytes to the session's input channel.
    fn write(&self, data: &[u8]) -> Result<(), String>;

    /// Resize the terminal to the given dimensions.
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String>;

    /// Close the session, releasing all associated resources.
    ///
    /// Uses consuming `self: Box<Self>` semantics — the implementor takes full
    /// ownership and is dropped when the method returns.
    fn close(self: Box<Self>) -> Result<(), String>;
}
