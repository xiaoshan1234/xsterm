//! Backward-compatibility shim — see
//! [`crate::services::tmux::protocol::parser`] for the canonical definitions.
//!
//! Removed in PR-T5.

pub use crate::services::tmux::protocol::parser::ProtocolParser;

// Old name preserved as deprecated alias during the P1 → P5 migration window.
#[deprecated(
    since = "0.1.4",
    note = "renamed to ProtocolParser; canonical path is \
            crate::services::tmux::protocol::parser::ProtocolParser"
)]
pub use crate::services::tmux::protocol::parser::ProtocolParser as ControlParser;