//! Event-emission abstraction over the Tauri [`AppHandle`].

use tauri::{AppHandle, Emitter};

use crate::shared::error::StringError;

/// Emits events to the frontend without coupling callers to Tauri directly.
pub trait AppBackend: Send + Sync {
    /// Emit an event with a pre-built JSON payload.
    fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String>;
}

/// Tauri-based implementation of [`AppBackend`].
#[derive(Clone)]
pub struct RealAppBackend {
    app: std::sync::Arc<AppHandle>,
}

impl RealAppBackend {
    /// Wrap a Tauri [`AppHandle`] as an [`AppBackend`].
    pub(crate) fn new(app: AppHandle) -> Self {
        Self {
            app: std::sync::Arc::new(app),
        }
    }
}

impl AppBackend for RealAppBackend {
    fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String> {
        self.app.emit(event, payload.clone()).map_err_string()
    }
}
