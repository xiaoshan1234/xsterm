//! Frontend-facing data models for the tmux `-CC` backend.
//!
//! All serializable types use `camelCase` so they match the TypeScript IPC
//! payloads produced by the Tauri event layer.

use serde::{Deserialize, Serialize};

use crate::services::tmux::parser::{PaneListEntry, WindowListEntry};

/// Event emitted to the frontend when tmux state changes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TmuxControlEvent {
    /// Pane terminal output.
    PaneOutput {
        #[serde(flatten)]
        output: TmuxPaneOutput,
    },
    /// Captured historical pane output.
    CapturedPaneOutput {
        #[serde(flatten)]
        output: TmuxPaneOutput,
    },
    /// Successful command response.
    CommandResponse { cmd_num: usize, lines: Vec<String> },
    /// Error command response.
    CommandError { cmd_num: usize, lines: Vec<String> },
    /// Client disconnect.
    Exit { reason: Option<String> },
    /// Active tmux session changed.
    SessionChanged { session_id: String, name: String },
    /// Tmux session renamed.
    SessionRenamed { name: String },
    /// Window added.
    WindowAdded { window_id: String },
    /// Window closed.
    WindowClosed { window_id: String },
    /// Window renamed.
    WindowRenamed { window_id: String, name: String },
    /// Window activated (became current).
    WindowActivated { window_id: String },
    /// Window layout changed.
    LayoutChanged { window_id: String, layout: String },
    /// Pane closed.
    PaneClosed { pane_id: String },
    /// Pane title changed.
    PaneTitleChanged { pane_id: String, title: String },
    /// Pane mode changed (e.g. copy mode).
    PaneModeChanged { pane_id: String, mode: String },
    /// Pane output paused.
    PanePaused { pane_id: String },
    /// Pane output resumed.
    PaneContinued { pane_id: String },
    /// Parsed `list-windows` response.
    WindowList { windows: Vec<TmuxWindow> },
    /// Parsed `list-panes` response.
    PaneList { panes: Vec<TmuxPane> },
    /// Fallback for unknown notifications.
    Unknown { raw: String },
}

/// Terminal output for a specific pane.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxPaneOutput {
    pub pane_id: String,
    pub data: Vec<u8>,
}

/// A tmux pane.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxPane {
    pub pane_id: String,
    pub window_id: String,
    pub session_id: String,
    pub active: bool,
    pub width: u16,
    pub height: u16,
    pub cwd: String,
    pub title: String,
}

impl From<PaneListEntry> for TmuxPane {
    fn from(entry: PaneListEntry) -> Self {
        Self {
            pane_id: entry.pane_id,
            window_id: entry.window_id,
            session_id: entry.session_id,
            active: entry.active,
            width: entry.width,
            height: entry.height,
            cwd: entry.cwd,
            title: entry.title,
        }
    }
}

/// A tmux window.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxWindow {
    pub window_id: String,
    pub session_id: String,
    pub name: String,
    pub active: bool,
    pub layout: String,
    pub panes: Vec<TmuxPane>,
}

impl From<WindowListEntry> for TmuxWindow {
    fn from(entry: WindowListEntry) -> Self {
        Self {
            window_id: entry.window_id,
            session_id: entry.session_id,
            name: entry.name,
            active: entry.active,
            layout: entry.layout,
            panes: Vec::new(),
        }
    }
}

/// A tmux session.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct TmuxSession {
    pub session_id: String,
    pub name: String,
    pub active_window_id: Option<String>,
    pub windows: Vec<TmuxWindow>,
}

/// Full state snapshot (planned for future use).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct TmuxStateSnapshot {
    pub session_id: String,
    pub active_window_id: Option<String>,
    pub active_pane_id: Option<String>,
    pub in_copy_mode: bool,
    pub windows: Vec<TmuxWindow>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_list_entry_converts_to_tmux_window() {
        let entry = WindowListEntry {
            window_id: "@1".to_string(),
            session_id: "$1".to_string(),
            name: "main".to_string(),
            active: true,
            layout: "babc,0x0".to_string(),
        };
        let window: TmuxWindow = entry.into();
        assert_eq!(window.window_id, "@1");
        assert_eq!(window.session_id, "$1");
        assert_eq!(window.name, "main");
        assert!(window.active);
        assert_eq!(window.layout, "babc,0x0");
        assert!(window.panes.is_empty());
    }

    #[test]
    fn pane_list_entry_converts_to_tmux_pane() {
        let entry = PaneListEntry {
            pane_id: "%1".to_string(),
            window_id: "@1".to_string(),
            session_id: "$1".to_string(),
            active: true,
            width: 80,
            height: 24,
            cwd: "/home".to_string(),
            title: "zsh".to_string(),
        };
        let pane: TmuxPane = entry.into();
        assert_eq!(pane.pane_id, "%1");
        assert_eq!(pane.window_id, "@1");
        assert_eq!(pane.session_id, "$1");
        assert!(pane.active);
        assert_eq!(pane.width, 80);
        assert_eq!(pane.height, 24);
        assert_eq!(pane.cwd, "/home");
        assert_eq!(pane.title, "zsh");
    }

    #[test]
    fn pane_output_serializes_to_camel_case() {
        let output = TmuxPaneOutput {
            pane_id: "%0".to_string(),
            data: vec![97, 98],
        };
        let json = serde_json::to_string(&output).unwrap();
        assert!(json.contains("paneId"));
        assert!(!json.contains("pane_id"));
    }

    #[test]
    fn window_list_event_serializes_to_camel_case() {
        let window = TmuxWindow {
            window_id: "@1".to_string(),
            session_id: "$1".to_string(),
            name: "main".to_string(),
            active: true,
            layout: "babc".to_string(),
            panes: Vec::new(),
        };
        let event = TmuxControlEvent::WindowList { windows: vec![window] };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("windowId"));
        assert!(!json.contains("window_id"));
    }
}
