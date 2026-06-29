//! Mutable per-session state tracked while dispatching tmux control messages.
//!
//! Tmux control mode notifies the client when a pane's output is paused or
//! resumed (`%pause` / `%continue`) and when a pane enters or leaves copy/
//! scroll mode (`%pane-mode-changed`). This module tracks those per-pane
//! flags so that the dispatcher can:
//!
//! - suppress output for paused panes (flow control)
//! - report whether a pane is currently in copy/scroll mode

use std::collections::HashSet;
use std::sync::Mutex;

/// Per-session mutable state used while dispatching control messages.
///
/// This struct is intentionally cheap to clone/share: it is protected by
/// short-lived mutexes because updates come from a single forwarding thread
/// and reads are also on that thread.
pub struct StateTracker {
    paused_panes: Mutex<HashSet<String>>,
    copy_mode_panes: Mutex<HashSet<String>>,
}

impl Default for StateTracker {
    fn default() -> Self {
        Self {
            paused_panes: Mutex::new(HashSet::new()),
            copy_mode_panes: Mutex::new(HashSet::new()),
        }
    }
}

impl StateTracker {
    /// Mark `pane_id` as paused so its output will be suppressed.
    pub fn mark_paused(&self, pane_id: &str) {
        if let Ok(mut set) = self.paused_panes.lock() {
            set.insert(pane_id.to_string());
        }
    }

    /// Mark `pane_id` as no longer paused.
    pub fn mark_continued(&self, pane_id: &str) {
        if let Ok(mut set) = self.paused_panes.lock() {
            set.remove(pane_id);
        }
    }

    /// Returns `true` if `pane_id` is currently paused.
    pub fn is_paused(&self, pane_id: &str) -> bool {
        self.paused_panes
            .lock()
            .map(|set| set.contains(pane_id))
            .unwrap_or(false)
    }

    /// Toggle copy/scroll mode for `pane_id` and return the new state.
    pub fn toggle_copy_mode(&self, pane_id: &str) -> bool {
        let was_in_copy_mode = self.is_in_copy_mode(pane_id);
        if let Ok(mut set) = self.copy_mode_panes.lock() {
            if was_in_copy_mode {
                set.remove(pane_id);
            } else {
                set.insert(pane_id.to_string());
            }
        }
        !was_in_copy_mode
    }

    /// Returns `true` if `pane_id` is currently in copy/scroll mode.
    pub fn is_in_copy_mode(&self, pane_id: &str) -> bool {
        self.copy_mode_panes
            .lock()
            .map(|set| set.contains(pane_id))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_paused_and_continued_panes() {
        let tracker = StateTracker::default();
        assert!(!tracker.is_paused("%0"));
        tracker.mark_paused("%0");
        assert!(tracker.is_paused("%0"));
        tracker.mark_continued("%0");
        assert!(!tracker.is_paused("%0"));
    }

    #[test]
    fn toggles_copy_mode() {
        let tracker = StateTracker::default();
        assert!(!tracker.is_in_copy_mode("%0"));
        assert!(tracker.toggle_copy_mode("%0"));
        assert!(tracker.is_in_copy_mode("%0"));
        assert!(!tracker.toggle_copy_mode("%0"));
        assert!(!tracker.is_in_copy_mode("%0"));
    }
}
