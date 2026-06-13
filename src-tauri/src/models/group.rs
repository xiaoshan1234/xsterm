use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionGroup {
    pub id: u32,
    pub name: String,
    pub session_ids: Vec<u32>,
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupStore {
    pub groups: Vec<SessionGroup>,
    pub next_group_id: u32,
}
