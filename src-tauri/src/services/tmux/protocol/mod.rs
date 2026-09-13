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
//! | [`codec`]    | Octal `\\nnn` codec for `%output` / `%extended-output` payloads (formerly `escape.rs`). |
//! | [`events`]   | Strongly-typed [`ProtocolEvent`] enum, one variant per `%xxx` line (formerly `events.rs`). |
//! | [`parser`]   | Byte-stream → `Vec<ProtocolEvent>` state machine (formerly `parser.rs`). |
//! | [`command`]  | [`TaggedCommand`] + [`CommandId`] + [`ResponseWaiter`] — the typed envelope every outbound command carries (NEW in P3). |
//!
//! ## Public API
//!
//! Re-exports below. Sibling modules (`controller`, `dispatch`) and the old
//! top-level shims (`tmux::commands`, `tmux::events`, etc.) all reach the
//! same symbols through here.

pub(crate) mod codec;
pub(crate) mod command;
pub(crate) mod events;
pub(crate) mod parser;
pub(crate) mod version;
pub(crate) mod wire;

pub use codec::{escape_output, unescape_output};
pub use command::{CommandId, CommandKind, ResponseOutcome, ResponseWaiter, TaggedCommand};
pub use events::ProtocolEvent;
pub use version::{parse_version, CapabilityMatrix, CommandListEntry, TmuxProtocolVersion};
pub use wire::{
    attach_session_create, detach_client, kill_pane, kill_server, kill_window,
    list_panes_with_format, list_windows, new_window_in_current, refresh_client_control,
    rename_window, resize_pane, send_keys, split_window, DEFAULT_PANE_LIST_FORMAT,
    DEFAULT_WINDOW_LIST_FORMAT,
};