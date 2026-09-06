//! Pure byte helpers shared by [`super::mod`] (via `spawn_output_forwarder`).
//!
//! Kept in its own file so the drain-budget tests (`drain_should_break`)
//! and the UTF-8 boundary tests (`utf8_safe_prefix_len`) sit next to
//! the helpers they exercise — and so the parent `mod.rs` does not
//! carry utility code unrelated to the public `create_local_session`
//! API.

use std::time::Duration;

/// Decide whether the drain loop should stop accumulating and emit.
///
/// Returns `true` when either the size budget or the time budget has
/// been hit. The time budget is only meaningful when at least one
/// microsecond has elapsed (a 0-elapsed burst is the "fresh from
/// `recv_timeout`" case where we should keep accumulating).
pub(super) fn drain_should_break(
    accumulated_bytes: usize,
    elapsed: Duration,
    size_budget: usize,
    time_budget: Duration,
) -> bool {
    accumulated_bytes >= size_budget || (elapsed > Duration::ZERO && elapsed >= time_budget)
}

/// Find the largest prefix length such that `bytes[..n]` is valid UTF-8
/// with every codepoint complete.
///
/// Used by the output forwarder to never split a multi-byte codepoint
/// across `session-output` events: any trailing incomplete codepoint
/// is held in `remainder` and prefixed onto the next burst.
pub(super) fn utf8_safe_prefix_len(bytes: &[u8]) -> usize {
    if bytes.is_empty() {
        return 0;
    }
    let mut i = bytes.len();
    while i > 0 && (bytes[i - 1] & 0xC0) == 0x80 {
        i -= 1;
    }
    if i == 0 {
        return 0;
    }
    let leading_pos = i - 1;
    let b = bytes[leading_pos];
    let expected_len: usize = if b < 0x80 {
        1
    } else if b < 0xC0 {
        return leading_pos;
    } else if b < 0xE0 {
        2
    } else if b < 0xF0 {
        3
    } else {
        4
    };
    let available = bytes.len() - leading_pos;
    if available < expected_len {
        leading_pos
    } else {
        bytes.len()
    }
}
