//! tmux `-CC` protocol layer (stateless).
//!
//! Everything in this module owns **no runtime state** — it only knows how to
//! encode a wire-format command and how to parse a byte stream into typed
//! [`events::ProtocolEvent`]s. State (sessions, windows, panes, command ID
//! registry) lives one layer up in [`super::controller`].
//!
//! ## Module layout
//!
//! | File         | Responsibility |
//! |--------------|----------------|
//! | [`wire`]     | High-level builders that turn a [`command::CommandKind`] into the textual wire payload tmux understands (formerly `commands.rs`). |
//! | [`codec`]    | Octal `\nnn` codec for `%output` / `%extended-output` payloads (formerly `escape.rs`). |
//! | [`events`]   | Strongly-typed [`ProtocolEvent`] enum, one variant per `%xxx` line (formerly `events.rs`). |
//! | [`parser`]   | Byte-stream → `Vec<ProtocolEvent>` state machine (formerly `parser.rs`). |
//! | [`command`]  | [`TaggedCommand`] + [`CommandId`] + [`ResponseWaiter`] — the typed envelope every outbound command carries (NEW in P3). |
//!
//! Sibling modules (`controller`, `dispatch`) and the old top-level shims
//! (`tmux::commands`, `tmux::events`, etc.) all reach these symbols
//! through their own submodule paths — no `pub use` re-exports are needed
//! here.

pub(crate) mod codec;
pub(crate) mod command;
pub(crate) mod events;
pub(crate) mod parser;
pub(crate) mod wire;
