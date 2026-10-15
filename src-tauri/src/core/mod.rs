//! L0 — Core (pure Rust, no Tauri dependency).
//!
//! 全部模块对 [`crate::commands`] 公开;`tauri::*` 在本目录任何文件出现都视为架构违规
//! (R4,见 [`doc/arch/ARCHITECTURE.md` §4])。

// 公开 API 含 M2/M4/M5 才启用的项(`Shell::default_size`、`SessionInfo` 等),M1 不消费。
#![allow(dead_code)]

pub mod pty;
pub mod session;
pub mod shell;
