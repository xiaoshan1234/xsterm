use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::shared::error::StringError;
use crate::shared::session::AttachedTmuxServer;

const ATTACHED_TMUX_STORE: &str = "attached_tmux.json";
const ATTACHED_TMUX_KEY: &str = "servers";

/// Persist the live tmux server list.
///
/// This information remains available for explicit reconnect flows and
/// diagnostics, but the application no longer reattaches it automatically.
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
