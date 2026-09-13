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
pub(crate) mod errors;
pub(crate) mod escape;
pub(crate) mod events;
pub(crate) mod parser;
pub(crate) mod protocol;

pub(crate) mod bridge;

#[allow(unused_imports)]
pub use controller::TmuxController;

/// Bridge [`TmuxError`] back to a `String` at the Tauri command
/// boundary (`commands::session`). All Tauri command signatures today
/// return `Result<_, String>`; with this impl in place, command
/// bodies can `?`-propagate a `TmuxError` and Tauri serialises the
/// `String` payload to the frontend as-is.
///
/// We do this at the **module boundary** (this file) instead of next
/// to the error enum because the conversion is an explicit project
/// policy: `services::tmux::*` returns `TmuxError`; only the
/// `tauri::command` surface converts to `String`. Putting the impl
/// next to `TmuxError` would tempt internal call sites to bail into
/// `String` early and defeat the variant-matching value of the
/// typed error.
impl From<errors::TmuxError> for String {
    fn from(err: errors::TmuxError) -> String {
        // `to_string()` is provided by `thiserror`'s `Display` impl;
        // we keep no extra prefix here because Tauri already wraps
        // command errors with the command name when surfacing them
        // to the frontend.
        err.to_string()
    }
}

#[cfg(test)]
mod from_impl_tests {
    use super::errors::{CommandKind, TmuxError};

    #[test]
    fn from_does_not_swallow_variant_detail() {
        // The point of `TmuxError` is that the variant is matched
        // before conversion; this test pins the `to_string()`
        // output so a stray `#[error("...")]` change can't silently
        // regress log greps that distinguish "server not running"
        // from "internal invariant violated".
        let s: String = TmuxError::ServerNotRunning {
            socket: "alt".into(),
        }
        .to_string()
        .into();
        assert!(s.contains("alt"));
        assert!(s.contains("server not running"));
        let s: String = TmuxError::CommandNotFound {
            kind: CommandKind::Pane,
            id: "%3".into(),
        }
        .into();
        assert!(s.contains("pane"));
        assert!(s.contains("%3"));
    }
}
