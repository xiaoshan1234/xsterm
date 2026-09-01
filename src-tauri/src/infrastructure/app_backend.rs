use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter};

use crate::error::StringError;

/// Abstraction over the application backend used by the service layer.
///
/// Allows services to emit events to the frontend and spawn background tasks
/// without depending on Tauri directly.
pub trait AppBackend: Send + Sync + Clone {
    /// Emit an event to the frontend with a JSON payload. Callers pass a
    /// pre-built `serde_json::Value` (typically via `serde_json::json!`) so
    /// the backend can hand it directly to Tauri's emitter without a
    /// round-trip through bytes. See doc/maintenance/perf.md Perf 006.
    fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String>;

    /// Emit a raw byte payload to the frontend without going through JSON
    /// serialization. The payload is delivered to the frontend as a
    /// `Uint8Array` via a Tauri `Channel<Vec<u8>>`. See Perf 001 in
    /// `doc/maintenance/perf.md`.
    ///
    /// The Rust → JS handler attached to the underlying channel is a
    /// no-op (we never expect JS → Rust traffic on this channel); the
    /// handler is required by Tauri's `Channel::new` API.
    fn emit_binary(&self, bytes: Vec<u8>) -> Result<(), String>;

    /// Spawn a background thread.
    fn spawn(&self, f: Box<dyn FnOnce() + Send>);
}

/// Tauri-based implementation of [`AppBackend`].
#[derive(Clone)]
pub struct RealAppBackend {
    app: std::sync::Arc<AppHandle>,
    /// Channel used to deliver raw binary `session-output` frames to the
    /// frontend without the JSON-serialization overhead of `app.emit`. The
    /// frontend listens on the matching channel ID and consumes binary
    /// frames via `DataView`. See Perf 001.
    pub session_output_channel: Channel<Vec<u8>>,
}

impl RealAppBackend {
    /// Wrap a Tauri [`AppHandle`] as an [`AppBackend`].
    pub(crate) fn new(app: AppHandle) -> Self {
        let channel = Channel::<Vec<u8>>::new(|_payload| {
            // No-op: this channel is purely Rust → JS. Tauri requires a
            // handler that returns Result at construction time.
            let _ = _payload;
            Ok(())
        });
        Self {
            app: std::sync::Arc::new(app),
            session_output_channel: channel,
        }
    }
}

impl AppBackend for RealAppBackend {
    fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String> {
        self.app.emit(event, payload.clone()).map_err_string()
    }

    fn emit_binary(&self, bytes: Vec<u8>) -> Result<(), String> {
        self.session_output_channel.send(bytes).map_err_string()
    }

    fn spawn(&self, f: Box<dyn FnOnce() + Send>) {
        std::thread::spawn(f);
    }
}