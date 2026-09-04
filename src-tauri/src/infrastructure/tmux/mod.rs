//! Tmux `-CC` (control mode) integration — Wave 0 skeleton.
//!
//! xsterm drives tmux as a single child process per controller: one
//! `tmux -CC` invocation owns N panes (and therefore N xsterm sessions).
//! See `doc/requirements/prd-0.1/req-006-tmux.md` §2 (D1) for the design
//! rationale.
//!
//! ## Module layout
//!
//! | File             | Responsibility                                                                |
//! |------------------|-------------------------------------------------------------------------------|
//! | `events.rs`      | [`ControlEvent`] enum — one variant per `%xxx` notification line.              |
//! | `escape.rs`      | [`unescape_output`] / [`escape_output`] — octal `\nnn` codec for `%output`.    |
//! | `parser.rs`      | [`ControlParser`] — pure state machine: line → `Option<ControlEvent>`.         |
//! | `commands.rs`    | High-level command builders returning newline-terminated stdin payloads.       |
//! | `controller.rs`  | [`TmuxController`] — spawns the tmux child, owns reader / writer / monitor.    |
//! | `backend.rs`     | [`TmuxBackend`](backend::TmuxBackend) trait + Local / SSH impls.       |
//!
//! ## Public API (re-exported here)
//!
//! - [`TmuxController`] — the main entry point used by `SessionManager`.
//!
//! Internal types (`ControlParser`, `ControlEvent`, the command builders,
//! and the codec functions) are `pub(crate)` so sibling modules can use
//! them but the public API stays narrow.

pub(crate) mod backend;
pub(crate) mod commands;
pub(crate) mod controller;
pub(crate) mod escape;
pub(crate) mod events;
pub(crate) mod parser;

// Public re-exports — keep this surface narrow.
#[allow(unused_imports)]
pub use controller::TmuxController;