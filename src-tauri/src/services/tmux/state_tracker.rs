//! Per-session mutable state tracking for flow control and copy mode.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use crate::services::tmux::events::{
    TmuxStateSyncPane, TmuxStateSyncSession, TmuxStateSyncSnapshot, TmuxStateSyncWindow,
};
use crate::services::tmux::parser::{PaneListEntry, WindowListEntry};

/// Accumulated list state and flow-control tracking for a single tmux control session.
pub struct StateTracker {
    paused_panes: Mutex<HashSet<String>>,
    copy_mode_panes: Mutex<HashSet<String>>,
    snapshot_data: Mutex<SnapshotData>,
}

struct SnapshotData {
    windows: Option<Vec<WindowListEntry>>,
    panes: Option<Vec<PaneListEntry>>,
}

impl Default for StateTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl StateTracker {
    /// Create a new, empty state tracker.
    pub fn new() -> Self {
        Self {
            paused_panes: Mutex::new(HashSet::new()),
            copy_mode_panes: Mutex::new(HashSet::new()),
            snapshot_data: Mutex::new(SnapshotData {
                windows: None,
                panes: None,
            }),
        }
    }

    /// Mark a pane as paused.
    pub fn mark_paused(&self, pane_id: &str) {
        if let Ok(mut set) = self.paused_panes.lock() {
            set.insert(pane_id.to_string());
        }
    }

    /// Mark a pane as continued (no longer paused).
    pub fn mark_continued(&self, pane_id: &str) {
        if let Ok(mut set) = self.paused_panes.lock() {
            set.remove(pane_id);
        }
    }

    /// Return whether a pane is currently paused.
    pub fn is_paused(&self, pane_id: &str) -> bool {
        self.paused_panes
            .lock()
            .map(|set| set.contains(pane_id))
            .unwrap_or(false)
    }

    /// Toggle copy-mode membership for a pane.
    pub fn toggle_copy_mode(&self, pane_id: &str) {
        if let Ok(mut set) = self.copy_mode_panes.lock() {
            if set.contains(pane_id) {
                set.remove(pane_id);
            } else {
                set.insert(pane_id.to_string());
            }
        }
    }

    /// Return whether a pane is currently in copy mode.
    pub fn is_in_copy_mode(&self, pane_id: &str) -> bool {
        self.copy_mode_panes
            .lock()
            .map(|set| set.contains(pane_id))
            .unwrap_or(false)
    }

    /// Replace the latest window list snapshot.
    pub fn update_windows(&self, windows: Vec<WindowListEntry>) {
        if let Ok(mut data) = self.snapshot_data.lock() {
            data.windows = Some(windows);
        }
    }

    /// Replace the latest pane list snapshot.
    pub fn update_panes(&self, panes: Vec<PaneListEntry>) {
        if let Ok(mut data) = self.snapshot_data.lock() {
            data.panes = Some(panes);
        }
    }

    /// Build a combined `tmux-state-sync` snapshot from the latest windows and panes.
    ///
    /// Returns `None` if either list has not yet been received.
    pub fn build_snapshot(&self) -> Option<TmuxStateSyncSnapshot> {
        let data = self.snapshot_data.lock().ok()?;
        let windows = data.windows.as_ref()?;
        let panes = data.panes.as_ref()?;

        let mut sessions = HashMap::new();
        let mut windows_out = HashMap::new();
        let mut panes_out = HashMap::new();

        for entry in windows {
            sessions
                .entry(entry.session_id.clone())
                .or_insert_with(|| TmuxStateSyncSession {
                    id: entry.session_id.clone(),
                    name: entry.name.clone(),
                });
            windows_out.insert(
                entry.window_id.clone(),
                TmuxStateSyncWindow {
                    id: entry.window_id.clone(),
                    session_id: entry.session_id.clone(),
                    name: entry.name.clone(),
                    active: entry.active,
                    layout: entry.layout.clone(),
                },
            );
        }

        for entry in panes {
            panes_out.insert(
                entry.pane_id.clone(),
                TmuxStateSyncPane {
                    id: entry.pane_id.clone(),
                    window_id: entry.window_id.clone(),
                    session_id: entry.session_id.clone(),
                    title: entry.title.clone(),
                    active: entry.active,
                    width: entry.width,
                    height: entry.height,
                },
            );
        }

        Some(TmuxStateSyncSnapshot {
            sessions,
            windows: windows_out,
            panes: panes_out,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_paused_and_continued_panes() {
        let tracker = StateTracker::new();
        tracker.mark_paused("%0");
        assert!(tracker.is_paused("%0"));
        tracker.mark_continued("%0");
        assert!(!tracker.is_paused("%0"));
    }

    #[test]
    fn toggles_copy_mode() {
        let tracker = StateTracker::new();
        assert!(!tracker.is_in_copy_mode("%0"));
        tracker.toggle_copy_mode("%0");
        assert!(tracker.is_in_copy_mode("%0"));
        tracker.toggle_copy_mode("%0");
        assert!(!tracker.is_in_copy_mode("%0"));
    }

    #[test]
    fn distinct_pane_ids_are_independent() {
        let tracker = StateTracker::new();
        tracker.mark_paused("%0");
        tracker.toggle_copy_mode("%1");
        assert!(tracker.is_paused("%0"));
        assert!(!tracker.is_paused("%1"));
        assert!(!tracker.is_in_copy_mode("%0"));
        assert!(tracker.is_in_copy_mode("%1"));
    }

    #[test]
    fn snapshot_requires_both_windows_and_panes() {
        let tracker = StateTracker::new();
        assert!(tracker.build_snapshot().is_none());

        tracker.update_windows(vec![WindowListEntry {
            window_id: "@1".to_string(),
            session_id: "$1".to_string(),
            name: "main".to_string(),
            active: true,
            layout: "babc,0x0".to_string(),
        }]);
        assert!(tracker.build_snapshot().is_none());

        tracker.update_panes(vec![PaneListEntry {
            pane_id: "%1".to_string(),
            window_id: "@1".to_string(),
            session_id: "$1".to_string(),
            active: true,
            width: 80,
            height: 24,
            cwd: "/home".to_string(),
            title: "zsh".to_string(),
        }]);
        let snapshot = tracker.build_snapshot().expect("full snapshot");
        assert_eq!(snapshot.windows.len(), 1);
        assert_eq!(snapshot.panes.len(), 1);
        assert_eq!(snapshot.sessions.len(), 1);
        assert!(snapshot.sessions.contains_key("$1"));
        assert_eq!(snapshot.panes["%1"].title, "zsh");
    }

    #[test]
    fn session_name_is_derived_from_window_list_not_pane_title() {
        let tracker = StateTracker::new();
        tracker.update_windows(vec![WindowListEntry {
            window_id: "@1".to_string(),
            session_id: "$1".to_string(),
            name: "editor".to_string(),
            active: true,
            layout: "babc".to_string(),
        }]);
        tracker.update_panes(vec![PaneListEntry {
            pane_id: "%1".to_string(),
            window_id: "@1".to_string(),
            session_id: "$1".to_string(),
            active: true,
            width: 80,
            height: 24,
            cwd: "/home".to_string(),
            title: "not-the-session-name".to_string(),
        }]);
        let snapshot = tracker.build_snapshot().expect("full snapshot");
        assert_eq!(snapshot.sessions["$1"].name, "editor");
    }
}
