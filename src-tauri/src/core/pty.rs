//! L0 — portable-pty 薄封装。
//!
//! 仅依赖 `portable-pty` 与 `std::io::Read`。不依赖 Tauri。
//! 调用方: [`crate::core::session::SessionManager::spawn`]。

use std::io::Read;

use portable_pty::{native_pty_system, Child, MasterPty, PtySize};

use crate::core::shell::Shell;

/// 单个 PTY 会话所需的全部句柄。
///
/// 由 [`open`] 创建；`master` 用于 resize，`reader` 移交 reader 线程，
/// `child` 持有以保活子进程。
pub struct PtyPair {
    pub master: Box<dyn MasterPty + Send>,
    pub reader: Box<dyn Read + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}

#[derive(Debug)]
pub enum PtyError {
    Open(String),
    Spawn(String),
    CloneReader(String),
    CloneWriter(String),
    Resize(String),
    Write(String),
}

impl std::fmt::Display for PtyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Open(m)
            | Self::Spawn(m)
            | Self::CloneReader(m)
            | Self::CloneWriter(m)
            | Self::Resize(m)
            | Self::Write(m) => write!(f, "pty error: {m}"),
        }
    }
}

impl std::error::Error for PtyError {}

/// 打开一个 PTY,使用给定的 shell 启动子进程。
pub fn open(shell: &dyn Shell, size: PtySize) -> Result<PtyPair, PtyError> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(size)
        .map_err(|e| PtyError::Open(e.to_string()))?;

    let command = shell
        .build_command()
        .map_err(|e| PtyError::Spawn(format!("build command: {e}")))?;
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| PtyError::Spawn(e.to_string()))?;

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| PtyError::CloneReader(e.to_string()))?;

    Ok(PtyPair {
        master: pair.master,
        reader,
        child,
    })
}
