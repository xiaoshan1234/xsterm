use std::sync::Arc;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};

use crate::connect::event_emitter::{EventEmitter, TauriEventEmitter};
use crate::connect::output::OutputRouter;
use crate::connect::registry::TerminalRegistry;
use crate::feature::logging::terminal_log::TerminalLoggingBackend;
use crate::shared::terminal::{
    LocalTerminalConfig, SshConfig, TerminalInfo, TerminalLoggingConfig,
};

const MAX_WRITE_PAYLOAD_BYTES: usize = 1024 * 1024;

/// Create a new local shell session.
#[tauri::command]
pub async fn create_local_terminal(
    config: LocalTerminalConfig,
    logging: Option<TerminalLoggingConfig>,
    state: State<'_, Arc<TerminalRegistry>>,
    app: AppHandle,
) -> Result<TerminalInfo, String> {
    tracing::info!("Creating local session");
    let inner: Arc<dyn EventEmitter> = Arc::new(TauriEventEmitter::new(app));
    let backend: Arc<dyn EventEmitter> =
        Arc::new(TerminalLoggingBackend::new(inner, state.terminal_logs()));
    state
        .create_local(config, backend, logging)
        .inspect(|info| {
            tracing::info!("Local session created: id={}", info.id);
        })
}

/// Create a new SSH session.
#[tauri::command]
pub async fn create_ssh_terminal(
    config: SshConfig,
    logging: Option<TerminalLoggingConfig>,
    state: State<'_, Arc<TerminalRegistry>>,
    app: AppHandle,
) -> Result<TerminalInfo, String> {
    tracing::info!(
        "Creating SSH session: {}@{}:{}",
        config.username,
        config.host,
        config.port
    );
    let inner: Arc<dyn EventEmitter> = Arc::new(TauriEventEmitter::new(app));
    let backend: Arc<dyn EventEmitter> =
        Arc::new(TerminalLoggingBackend::new(inner, state.terminal_logs()));
    state
        .create_ssh(config, backend, logging)
        .await
        .inspect(|info| {
            tracing::info!("SSH session created: id={}", info.id);
        })
}

/// Write input data to an existing session.
///
/// Hot path for terminal input — including the paste pipeline. With Perf 004
/// (DashMap-backed registry) this no longer takes any global lock: the
/// payload size guard runs first, then `state.write` looks up the session
/// by id via `DashMap::get` and dispatches to the backend's
/// `write(&self, data)`.
#[tauri::command]
pub async fn write_terminal(
    session_id: u32,
    data: Vec<u8>,
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<(), String> {
    if data.len() > MAX_WRITE_PAYLOAD_BYTES {
        return Err(format!(
            "write payload too large: {} bytes (max {})",
            data.len(),
            MAX_WRITE_PAYLOAD_BYTES
        ));
    }
    state.write(session_id, &data).await
}

/// Bind a frontend channel to a session's raw output stream.
///
/// The frontend creates a Tauri `Channel` and passes it here; the output
/// forwarder then pushes raw bytes through it instead of emitting a JSON
/// byte-array event. A subsequent subscribe for the same session replaces the
/// previous channel. Returns a subscription id the frontend passes back when
/// unsubscribing so a stale unsubscribe cannot evict a newer subscription.
#[tauri::command]
pub fn subscribe_terminal_output(
    session_id: u32,
    channel: Channel<InvokeResponseBody>,
    state: State<'_, Arc<OutputRouter>>,
) -> Result<u64, String> {
    Ok(state.subscribe(session_id, channel))
}

/// Forget the channel bound to a session (frontend unmount / session close).
#[tauri::command]
pub fn unsubscribe_terminal_output(
    session_id: u32,
    subscription_id: u64,
    state: State<'_, Arc<OutputRouter>>,
) -> Result<(), String> {
    state.unsubscribe(session_id, subscription_id);
    Ok(())
}

/// Resize the PTY of an existing session.
#[tauri::command]
pub async fn resize_terminal(
    session_id: u32,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<(), String> {
    state.resize(session_id, rows, cols).await
}

/// Close an existing session.
#[tauri::command]
pub async fn close_terminal(
    session_id: u32,
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<(), String> {
    tracing::info!("Closing session: id={}", session_id);
    state.close(session_id).await
}

/// List metadata for all active sessions.
#[tauri::command]
pub fn list_terminals(
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<Vec<TerminalInfo>, String> {
    Ok(state.list())
}

/// Upload an image file to the SSH server for the given session and return the
/// remote path where it was stored.
#[tauri::command]
pub async fn upload_image_to_ssh_terminal(
    session_id: u32,
    filename: String,
    data: Vec<u8>,
    state: State<'_, Arc<TerminalRegistry>>,
) -> Result<String, String> {
    state.upload_image(session_id, &filename, data).await
}
