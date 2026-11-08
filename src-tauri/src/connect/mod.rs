//! Connection layer (L0/L1 adapter) built directly on xscore transports.
//!
//! The frontend needs a real disconnect signal (`terminal-disconnected`), which
//! xscore's L1 `TerminalHandle` broadcast does not provide. We therefore consume
//! xscore's L0 transports (`LocalPty`, `SshConnection`, `TmuxControl::output`),
//! whose receivers close on process/channel exit, and unify them behind a small
//! transport enum.

pub(crate) mod app_backend;
pub(crate) mod forward;
pub(crate) mod local;
pub(crate) mod registry;
pub(crate) mod session;
pub(crate) mod ssh;
pub(crate) mod ssh_exec;
pub(crate) mod tmux;
