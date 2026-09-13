//! Backward-compatibility shim — see
//! [`crate::services::tmux::protocol::codec`] for the canonical definitions.
//!
//! Removed in PR-T5.

pub use crate::services::tmux::protocol::codec::{escape_output, unescape_output};