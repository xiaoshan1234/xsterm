//! tmux `-CC` (control mode) integration — xsterm's tmux client module.
//!
//! xsterm drives tmux as a single child process per controller: one
//! `tmux -CC` invocation owns N panes (and therefore N xsterm sessions).
//! See [`doc/requirements/prd-0.1/req-006-tmux.md` §2 (D1)](../../../doc/requirements/prd-0.1/req-006-tmux.md)
//! for the design rationale.
//!
//! ## Module layout
//!
//! | File             | Responsibility                                                                |
//! |------------------|-------------------------------------------------------------------------------|
//! | [`escape`]       | [`escape::unescape_output`] / [`escape::escape_output`] — octal `\nnn` codec for `%output`. |
//! | [`events`]       | [`events::ControlEvent`] enum — one variant per `%xxx` notification line.              |
//! | [`parser`]       | [`parser::ControlParser`] — pure state machine: line → `Option<ControlEvent>`.         |
//! | [`commands`]     | High-level command builders returning newline-terminated stdin payloads.       |
//! | [`controller`]   | [`controller::TmuxController`] — spawns the tmux child, owns reader / writer / monitor.    |
//! | [`dispatch`]     | [`dispatch::spawn_dispatch_task`] + `dispatch_event` — turns `ControlEvent`s into Tauri events and Promise resolutions. |
//!
//! ## Public API (re-exported here)
//!
//! - [`TmuxController`] — the main entry point used by `SessionManager`.
//!
//! Internal types (`ControlParser`, `ControlEvent`, the command builders,
//! and the codec functions) are `pub(crate)` so sibling modules can use
//! them but the public API stays narrow.
//!
//! ## Relationship to `infrastructure::tmux`
//!
//! This module owns the **business / orchestration** side (the
//! `TmuxController` state machine, the line protocol, the Promise
//! coordination). The **transport abstraction** — the
//! [`TmuxBackend`](crate::infrastructure::tmux::backend::TmuxBackend)
//! trait and its `Local` / `Ssh` impls — stays in
//! [`crate::infrastructure::tmux::backend`] because it is parallel to
//! [`PtySystem`](crate::infrastructure::pty::PtySystem) /
//! [`SshBackend`](crate::infrastructure::ssh::SshBackend).

pub(crate) mod commands;
pub(crate) mod controller;
pub(crate) mod dispatch;
pub(crate) mod escape;
pub(crate) mod events;
pub(crate) mod parser;

#[allow(unused_imports)]
pub use controller::TmuxController;
