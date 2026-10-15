//! L1 — IPC 事件契约。
//!
//! 字符串字面量必须与 `src/services/pty.ts` 的 `listen<>` 调用精确匹配(R5)。

#![allow(dead_code)] // `TerminalDataPayload` 是文档型 type alias,M2 会显式使用

pub const TERMINAL_DATA: &str = "terminal-data";

/// M1 沿用 M0 的 wire format:`Vec<u8>` → JSON `number[]`。
/// M2 起会演化为 `{ id, data }`,见 [`doc/arch/ARCHITECTURE.md` §5.2]。
pub type TerminalDataPayload = Vec<u8>;
