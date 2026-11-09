use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::shared::error::StringError;
use crate::shared::session::AttachedTmuxServer;

/// store key + payload key for the `attachedTmuxServers` list.
///
/// Centralised so the frontend (which never sees these literals — it goes
/// through `sessionService.autoAttachTmuxServers` / etc.) and the backend
/// `commands::session` handlers stay in sync.
const ATTACHED_TMUX_STORE: &str = "attached_tmux.json";
const ATTACHED_TMUX_KEY: &str = "servers";

/// Load the persisted attached tmux servers list from disk.
///
/// Internal helper used by `auto_attach_tmux_servers` before re-attaching
/// every previously-known server. Returns an empty list when the store has
/// no entry yet.
pub(crate) async fn load_attached_tmux_servers(
    app: AppHandle,
) -> Result<Vec<AttachedTmuxServer>, String> {
    let store = app.store(ATTACHED_TMUX_STORE).map_err_string()?;
    match store.get(ATTACHED_TMUX_KEY) {
        Some(value) => {
            let servers: Vec<AttachedTmuxServer> =
                serde_json::from_value(value.clone()).map_err_string()?;
            tracing::debug!("Loaded {} attached tmux servers", servers.len());
            Ok(servers)
        }
        None => Ok(vec![]),
    }
}

/// Synchronous variant shared by the `commands::session` handlers (which
/// already hold an `AppHandle`). Errors are logged at `warn` level instead
/// of propagated so a transient store failure does not mask a successful
/// `attach_tmux`.
pub(crate) fn save_attached_tmux_servers_impl(
    app: &AppHandle,
    servers: &[AttachedTmuxServer],
) -> Result<(), String> {
    let store = app.store(ATTACHED_TMUX_STORE).map_err_string()?;
    store.set(
        ATTACHED_TMUX_KEY,
        serde_json::to_value(servers).map_err_string()?,
    );
    store.save().map_err_string()?;
    Ok(())
}
