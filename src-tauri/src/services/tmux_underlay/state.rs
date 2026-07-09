use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

/// A tmux session in the snapshot tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxSessionSnapshot {
    pub id: String,
    pub name: String,
}

/// A tmux window in the snapshot tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxWindowSnapshot {
    pub id: String,
    pub session_id: String,
    pub name: String,
    pub active: bool,
    pub layout: String,
}

/// A tmux pane in the snapshot tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxPaneSnapshot {
    pub id: String,
    pub window_id: String,
    pub session_id: String,
    pub title: String,
    pub active: bool,
    pub width: u16,
    pub height: u16,
}

/// Complete tmux state snapshot sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxStateSnapshot {
    pub sessions: HashMap<String, TmuxSessionSnapshot>,
    pub windows: HashMap<String, TmuxWindowSnapshot>,
    pub panes: HashMap<String, TmuxPaneSnapshot>,
}

impl TmuxStateSnapshot {
    pub fn empty() -> Self {
        Self {
            sessions: HashMap::new(),
            windows: HashMap::new(),
            panes: HashMap::new(),
        }
    }
}

/// Captured output for a single pane.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxPaneOutput {
    pub pane_id: String,
    pub data: Vec<u8>,
}

/// Connection or probing error reported to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxConnectionError {
    pub message: String,
}

/// Internal mutable state tracked by the underlay poller.
pub struct TmuxUnderlayState {
    pub target_session: String,
    pub socket: Option<String>,
    pub snapshot: TmuxStateSnapshot,
    pub connected: bool,
    pub poller_exited: Arc<AtomicBool>,
}

impl TmuxUnderlayState {
    pub fn new(target_session: String, socket: Option<String>) -> Self {
        Self {
            target_session,
            socket,
            snapshot: TmuxStateSnapshot::empty(),
            connected: false,
            poller_exited: Arc::new(AtomicBool::new(true)),
        }
    }
}
