//! Data models for tmux control mode state.

use serde::{Deserialize, Serialize};

use super::parser::{PaneListEntry, WindowListEntry};

/// A tmux pane (`%N`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxPane {
    pub id: String,
    pub session_id: String,
    pub window_id: String,
    pub title: String,
    pub is_active: bool,
    pub is_paused: bool,
    pub in_copy_mode: bool,
    pub width: u16,
    pub height: u16,
}

/// A tmux window (`@N`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxWindow {
    pub id: String,
    pub session_id: String,
    pub name: String,
    pub active_pane_id: Option<String>,
    pub layout: String,
    pub panes: Vec<String>,
    pub is_active: bool,
}

/// A tmux session (`$N`).
#[allow(dead_code)]
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxSession {
    pub id: String,
    pub name: String,
    pub active_window_id: Option<String>,
    pub windows: Vec<String>,
}

/// Events emitted to the frontend when tmux control state changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum TmuxControlEvent {
    /// The active tmux session for this client changed.
    SessionChanged { session_id: String, name: String },
    /// The current tmux session was renamed.
    SessionRenamed { name: String },
    /// A new window was created.
    WindowAdded { window: TmuxWindow },
    /// A window was closed.
    WindowClosed { window_id: String },
    /// A window was renamed.
    WindowRenamed { window_id: String, name: String },
    /// The active window changed.
    WindowActivated { window_id: String },
    /// Window layout changed.
    LayoutChanged { window_id: String, layout: String },
    /// A new pane appeared.
    PaneAdded { pane: TmuxPane },
    /// A pane was closed.
    PaneClosed { pane_id: String },
    /// Pane title changed.
    PaneTitleChanged { pane_id: String, title: String },
    /// Pane entered or left copy/scroll mode.
    PaneModeChanged { pane_id: String, in_copy_mode: bool },
    /// Flow control: pane output paused.
    PanePaused { pane_id: String },
    /// Flow control: pane output resumed.
    PaneContinued { pane_id: String },
    WindowList { windows: Vec<TmuxWindowListEntry> },
    PaneList { panes: Vec<TmuxPaneListEntry> },
    CommandError { cmd_num: u64, message: String },
    Exit { reason: Option<String> },
    Unknown { raw: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxWindowListEntry {
    pub window_id: String,
    pub session_id: String,
    pub name: String,
    pub active: bool,
    pub layout: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxPaneListEntry {
    pub pane_id: String,
    pub window_id: String,
    pub session_id: String,
    pub title: String,
    pub active: bool,
    pub width: u16,
    pub height: u16,
}

impl From<WindowListEntry> for TmuxWindowListEntry {
    fn from(w: WindowListEntry) -> Self {
        TmuxWindowListEntry {
            window_id: w.window_id,
            session_id: w.session_id,
            name: w.name,
            active: w.active,
            layout: w.layout,
        }
    }
}

impl From<PaneListEntry> for TmuxPaneListEntry {
    fn from(p: PaneListEntry) -> Self {
        TmuxPaneListEntry {
            pane_id: p.pane_id,
            window_id: p.window_id,
            session_id: p.session_id,
            title: p.title,
            active: p.active,
            width: p.width,
            height: p.height,
        }
    }
}

/// Output event for a single pane. Emitted separately from control events so
/// that the frontend can route it directly to the matching xterm.js instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxPaneOutput {
    pub pane_id: String,
    pub data: Vec<u8>,
}

/// Container for the complete tmux state tree. This is sent to the frontend
/// after initial synchronization.
#[allow(dead_code)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxStateSnapshot {
    pub session: TmuxSession,
    pub windows: Vec<TmuxWindow>,
    pub panes: Vec<TmuxPane>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    #[test]
    fn window_list_serializes_to_camel_case() {
        let event = TmuxControlEvent::WindowList {
            windows: vec![TmuxWindowListEntry {
                window_id: "@0".to_string(),
                session_id: "$0".to_string(),
                name: "bash".to_string(),
                active: true,
                layout: "c080,80x24,0,0,0".to_string(),
            }],
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"windowId\""), "expected camelCase windowId in {}", json);
        assert!(json.contains("\"sessionId\""), "expected camelCase sessionId in {}", json);
        assert!(!json.contains("\"window_id\""), "snake_case should not appear in {}", json);
    }

    #[test]
    fn pane_list_serializes_to_camel_case() {
        let event = TmuxControlEvent::PaneList {
            panes: vec![TmuxPaneListEntry {
                pane_id: "%0".to_string(),
                window_id: "@0".to_string(),
                session_id: "$0".to_string(),
                title: "bash".to_string(),
                active: true,
                width: 80,
                height: 24,
            }],
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"paneId\""), "expected camelCase paneId in {}", json);
        assert!(json.contains("\"windowId\""), "expected camelCase windowId in {}", json);
        assert!(json.contains("\"sessionId\""), "expected camelCase sessionId in {}", json);
        assert!(!json.contains("\"pane_id\""), "snake_case should not appear in {}", json);
    }

    #[test]
    fn pane_output_serializes_to_camel_case() {
        let output = TmuxPaneOutput {
            pane_id: "%0".to_string(),
            data: vec![1, 2, 3],
        };
        let json = serde_json::to_string(&output).unwrap();
        assert!(json.contains("\"paneId\""), "expected camelCase paneId in {}", json);
        assert!(!json.contains("\"pane_id\""), "snake_case should not appear in {}", json);
    }
}
