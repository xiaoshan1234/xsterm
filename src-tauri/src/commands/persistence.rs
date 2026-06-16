use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::models::group::GroupStore;
use crate::models::session::SessionInfo;

#[tauri::command]
pub async fn save_sessions(sessions: Vec<SessionInfo>, app: AppHandle) -> Result<(), String> {
    tracing::debug!("Saving {} sessions", sessions.len());
    let store = app.store("sessions.json").map_err(|e| e.to_string())?;
    store.set(
        "sessions",
        serde_json::to_value(sessions).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn load_sessions(app: AppHandle) -> Result<Vec<SessionInfo>, String> {
    let store = app.store("sessions.json").map_err(|e| e.to_string())?;
    match store.get("sessions") {
        Some(value) => {
            let sessions: Vec<SessionInfo> =
                serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
            tracing::debug!("Loaded {} sessions", sessions.len());
            Ok(sessions)
        }
        None => Ok(vec![]),
    }
}

#[tauri::command]
pub async fn save_groups(store_data: GroupStore, app: AppHandle) -> Result<(), String> {
    tracing::debug!(
        "Saving {} groups, next_id={}",
        store_data.groups.len(),
        store_data.next_group_id
    );
    let store = app.store("groups.json").map_err(|e| e.to_string())?;
    store.set(
        "groups",
        serde_json::to_value(&store_data).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn load_groups(app: AppHandle) -> Result<GroupStore, String> {
    let store = app.store("groups.json").map_err(|e| e.to_string())?;
    match store.get("groups") {
        Some(value) => {
            let data: GroupStore =
                serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
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
