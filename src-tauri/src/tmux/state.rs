//! Data models for tmux control mode state.

use serde::{Deserialize, Serialize};

/// A tmux pane (`%N`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct TmuxPane {
    pub id: String,
    pub session_id: String,
    pub window_id: String,
    pub title: String,
    pub is_active: bool,
    pub is_paused: bool,
    pub width: u16,
    pub height: u16,
}

/// A tmux window (`@N`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
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
pub struct TmuxSession {
    pub id: String,
    pub name: String,
    pub active_window_id: Option<String>,
    pub windows: Vec<String>,
}

/// Events emitted to the frontend when tmux control state changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
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
    /// Client detached.
    Exit { reason: Option<String> },
    /// Catch-all for notifications not yet modeled explicitly.
    Unknown { raw: String },
}

/// Output event for a single pane. Emitted separately from control events so
/// that the frontend can route it directly to the matching xterm.js instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmuxPaneOutput {
    pub pane_id: String,
    pub data: Vec<u8>,
}

/// Container for the complete tmux state tree. This is sent to the frontend
/// after initial synchronization.
#[allow(dead_code)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TmuxStateSnapshot {
    pub session: TmuxSession,
    pub windows: Vec<TmuxWindow>,
    pub panes: Vec<TmuxPane>,
}

/// Result of parsing a `list-panes` line from tmux.
#[allow(dead_code)]
#[derive(Debug, Clone, Default)]
pub(crate) struct ParsedPaneInfo {
    pub id: String,
    pub session_id: String,
    pub window_id: String,
    pub title: String,
    pub is_active: bool,
    pub width: u16,
    pub height: u16,
}

/// Result of parsing a `list-windows` line from tmux.
#[allow(dead_code)]
#[derive(Debug, Clone, Default)]
pub(crate) struct ParsedWindowInfo {
    pub id: String,
    pub session_id: String,
    pub name: String,
    pub active_pane_id: String,
    pub layout: String,
    pub is_active: bool,
}
