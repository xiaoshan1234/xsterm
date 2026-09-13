pub(crate) mod app_backend;
pub(crate) mod binary_frame;
pub(crate) mod pty;
pub(crate) mod session_backend;
pub(crate) mod ssh;
/// tmux -CC (control mode) integration.
///
/// Module is fully consumed by [`SessionManager`](crate::services::session_manager::SessionManager),
/// the Tauri command layer, and the [`TmuxBackend`](tmux::backend::TmuxBackend)
/// abstraction. See [`tmux::mod`](self::tmux) for the public API surface.
pub(crate) mod tmux;
