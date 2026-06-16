use tauri::{AppHandle, Emitter};

use crate::error::StringError;

/// Abstraction over the application backend used by the service layer.
///
/// Allows services to emit events to the frontend and spawn background tasks
/// without depending on Tauri directly.
pub trait AppBackend: Send + Sync + Clone {
    /// Emit an event to the frontend with a JSON-serialized payload.
    fn emit(&self, event: &str, payload: &[u8]) -> Result<(), String>;
    /// Spawn a background thread.
    fn spawn(&self, f: Box<dyn FnOnce() + Send>);
}

/// Tauri-based implementation of [`AppBackend`].
#[derive(Clone)]
pub struct RealAppBackend {
    app: std::sync::Arc<tauri::AppHandle>,
}

impl RealAppBackend {
    /// Wrap a Tauri [`AppHandle`] as an [`AppBackend`].
    pub(crate) fn new(app: AppHandle) -> Self {
        Self { app: std::sync::Arc::new(app) }
    }
}

impl AppBackend for RealAppBackend {
    fn emit(&self, event: &str, payload: &[u8]) -> Result<(), String> {
        let json: serde_json::Value = serde_json::from_slice(payload).map_err_string()?;
        self.app.emit(event, json).map_err_string()
    }

    fn spawn(&self, f: Box<dyn FnOnce() + Send>) {
        std::thread::spawn(f);
    }
}
