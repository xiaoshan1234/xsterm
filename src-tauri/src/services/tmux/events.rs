//! Backward-compatibility shim — see
//! [`crate::services::tmux::protocol::events`] for the canonical definitions.
//!
//! Removed in PR-T5.

pub use crate::services::tmux::protocol::events::ProtocolEvent;

// Old name preserved as deprecated alias so external crates that import
// `ControlEvent` continue to compile during the P1 → P5 migration window.
#[deprecated(
    since = "0.1.4",
    note = "renamed to ProtocolEvent; canonical path is \
            crate::services::tmux::protocol::events::ProtocolEvent"
)]
pub use crate::services::tmux::protocol::events::ProtocolEvent as ControlEvent;