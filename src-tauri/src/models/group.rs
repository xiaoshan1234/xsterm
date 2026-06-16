use serde::{Deserialize, Serialize};

/// A user-defined group of sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionGroup {
    pub id: u32,
    pub name: String,
    pub session_ids: Vec<u32>,
    pub collapsed: bool,
}

/// Persisted group storage, including the next allocated group id.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupStore {
    pub groups: Vec<SessionGroup>,
    pub next_group_id: u32,
}
