//! Event-emission abstraction over the Tauri [`AppHandle`].

use tauri::{AppHandle, Emitter, Manager};

use crate::connect::output::OutputRouter;
use crate::shared::error::StringError;

use std::sync::Arc;

/// Emits events to the frontend without coupling callers to Tauri directly.
pub trait AppBackend: Send + Sync {
    /// Emit an event with a pre-built JSON payload.
    fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String>;

    /// Push raw output bytes for a session through its frontend channel.
    ///
    /// Unlike [`AppBackend::emit`] this bypasses JSON entirely; the payload is
    /// delivered as binary to the WebView.
    fn emit_bytes(&self, session_id: u32, bytes: Vec<u8>) -> Result<(), String>;
}

/// Tauri-based implementation of [`AppBackend`].
#[derive(Clone)]
pub struct RealAppBackend {
    app: Arc<AppHandle>,
}

impl RealAppBackend {
    /// Wrap a Tauri [`AppHandle`] as an [`AppBackend`].
    pub(crate) fn new(app: AppHandle) -> Self {
        Self { app: Arc::new(app) }
    }
}

impl AppBackend for RealAppBackend {
    fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String> {
        self.app.emit(event, payload.clone()).map_err_string()
    }

    fn emit_bytes(&self, session_id: u32, bytes: Vec<u8>) -> Result<(), String> {
        self.app
            .state::<Arc<OutputRouter>>()
            .send(session_id, bytes)
    }
}
