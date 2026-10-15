//! L1 — IPC 事件契约。
//!
//! 字符串字面量必须与 `src/services/pty.ts` 的 `listen<>` 调用精确匹配(R5)。

use serde::Serialize;

use crate::core::session::SessionId;

pub const TERMINAL_DATA: &str = "terminal-data";
pub const TERMINAL_EXIT: &str = "terminal-exit";

/// M2 起:`{ id, data }`,前端按 id 分发到对应 pane。
/// M1 沿用 M0 wire format `Vec<u8>` 的设计,见 [`doc/arch/ARCHITECTURE.md` §5.2]。
#[derive(Serialize, Clone)]
pub struct TerminalDataPayload {
    pub id: SessionId,
    pub data: Vec<u8>,
}

#[derive(Serialize, Clone)]
pub struct TerminalExitPayload {
    pub id: SessionId,
}
