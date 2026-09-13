use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::error::StringError;
use crate::models::group::GroupStore;
use crate::models::session::{AttachedTmuxServer, SessionInfo};

/// Persist the given session list to disk.
#[tauri::command]
pub async fn save_sessions(sessions: Vec<SessionInfo>, app: AppHandle) -> Result<(), String> {
    tracing::debug!("Saving {} sessions", sessions.len());
    let store = app.store("sessions.json").map_err_string()?;
    store.set("sessions", serde_json::to_value(sessions).map_err_string()?);
    store.save().map_err_string()?;
    Ok(())
}

/// Load the persisted session list from disk.
#[tauri::command]
pub async fn load_sessions(app: AppHandle) -> Result<Vec<SessionInfo>, String> {
    let store = app.store("sessions.json").map_err_string()?;
    match store.get("sessions") {
        Some(value) => {
            let sessions: Vec<SessionInfo> =
                serde_json::from_value(value.clone()).map_err_string()?;
            tracing::debug!("Loaded {} sessions", sessions.len());
            Ok(sessions)
        }
        None => Ok(vec![]),
    }
}

/// store key + payload key for the `attachedTmuxServers` list.
///
/// Centralised so the frontend (which never sees these literals — it goes
/// through `sessionService.autoAttachTmuxServers` / etc.) and the backend
/// `commands::session` handlers stay in sync.
const ATTACHED_TMUX_STORE: &str = "attached_tmux.json";
const ATTACHED_TMUX_KEY: &str = "servers";

/// Persist the attached tmux servers list to disk.
///
/// Called by the `create_tmux_session` / `attach_tmux_session` Tauri
/// commands after the controller is set up. The list mirrors the live
/// `SessionManager::tmux_controllers` registry: a freshly-`create`d
/// "default" tmux server is added; a freshly-`attach`ed server is added;
/// `close_session` removes the entry when the last pane on a controller
/// is closed.
#[tauri::command]
pub async fn save_attached_tmux_servers(
    servers: Vec<AttachedTmuxServer>,
    app: AppHandle,
) -> Result<(), String> {
    tracing::debug!("Saving {} attached tmux servers", servers.len());
    save_attached_tmux_servers_impl(&app, &servers)
}

/// Load the persisted attached tmux servers list from disk.
///
/// Called by the frontend on app startup (via
/// `sessionService.getAttachedTmuxServers`) and by `auto_attach_tmux_servers`
/// before re-attaching every previously-known server. Returns an empty list
/// when the store has no entry yet.
#[tauri::command]
pub async fn load_attached_tmux_servers(app: AppHandle) -> Result<Vec<AttachedTmuxServer>, String> {
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
/// already hold an `AppHandle`) and the `#[tauri::command]` wrapper. Errors
/// are logged at `warn` level instead of propagated so a transient store
/// failure does not mask a successful `create_tmux`/`attach_tmux`.
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

/// Persist the group storage to disk.
#[tauri::command]
pub async fn save_groups(store_data: GroupStore, app: AppHandle) -> Result<(), String> {
    tracing::debug!(
        "Saving {} groups, next_id={}",
        store_data.groups.len(),
        store_data.next_group_id
    );
    let store = app.store("groups.json").map_err_string()?;
    store.set(
        "groups",
        serde_json::to_value(&store_data).map_err_string()?,
    );
    store.save().map_err_string()?;
    Ok(())
}

/// Load the persisted group storage from disk.
#[tauri::command]
pub async fn load_groups(app: AppHandle) -> Result<GroupStore, String> {
    let store = app.store("groups.json").map_err_string()?;
    match store.get("groups") {
        Some(value) => {
            let data: GroupStore = serde_json::from_value(value.clone()).map_err_string()?;
            tracing::debug!(
                "Loaded {} groups, next_id={}",
                data.groups.len(),
                data.next_group_id
            );
            Ok(data)
        }
        None => Ok(GroupStore {
            groups: vec![],
            next_group_id: 1,
        }),
    }
}
