//! L0 — Shell 抽象。
//!
//! `Shell` trait 描述如何为一个目标 shell 构建启动命令。
//! M1 落地 PowerShell 与 Bash;Wsl / GitBash 在 M5 由 Settings UI 启用时再实现 `build_command`。

use portable_pty::{CommandBuilder, PtySize};

/// IPC 标识;wire format 与 `src/domain/shell.ts` 联合对齐(见 ARCHITECTURE §5.1)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum ShellKind {
    #[serde(rename = "powershell")]
    PowerShell,
    #[serde(rename = "wsl")]
    Wsl,
    #[serde(rename = "git_bash")]
    GitBash,
    #[serde(rename = "bash")]
    Bash,
}

#[derive(Debug)]
pub enum ShellError {
    /// 该 ShellKind 在当前里程碑尚未实现 `build_command`。
    Unsupported(ShellKind),
}

impl std::fmt::Display for ShellError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported(kind) => write!(f, "shell kind {kind:?} is not implemented yet"),
        }
    }
}

impl std::error::Error for ShellError {}

/// 单一 shell 实现负责回答:用哪个二进制、哪些参数、默认窗口大小。
pub trait Shell: Send + Sync {
    fn kind(&self) -> ShellKind;
    fn build_command(&self) -> Result<CommandBuilder, ShellError>;
    fn default_size() -> PtySize
    where
        Self: Sized;
}

const DEFAULT_ROWS: u16 = 24;
const DEFAULT_COLS: u16 = 80;

/// 根据 [`ShellKind`] 构造具体实现;未实现的变体返回 [`ShellError::Unsupported`],不 panic。
pub fn build(kind: ShellKind) -> Result<Box<dyn Shell>, ShellError> {
    match kind {
        ShellKind::PowerShell => Ok(Box::new(PowerShell)),
        ShellKind::Bash => Ok(Box::new(Bash)),
        ShellKind::Wsl | ShellKind::GitBash => Err(ShellError::Unsupported(kind)),
    }
}

/// 平台默认 shell:Windows → PowerShell;其他 → Bash。
pub fn detect_default_kind() -> ShellKind {
    if cfg!(target_os = "windows") {
        ShellKind::PowerShell
    } else {
        ShellKind::Bash
    }
}

pub struct PowerShell;

impl Shell for PowerShell {
    fn kind(&self) -> ShellKind {
        ShellKind::PowerShell
    }

    fn build_command(&self) -> Result<CommandBuilder, ShellError> {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.args(["-NoLogo", "-NoProfile"]);
        Ok(cmd)
    }

    fn default_size() -> PtySize {
        PtySize {
            rows: DEFAULT_ROWS,
            cols: DEFAULT_COLS,
            pixel_width: 0,
            pixel_height: 0,
        }
    }
}

pub struct Bash;

impl Shell for Bash {
    fn kind(&self) -> ShellKind {
        ShellKind::Bash
    }

    fn build_command(&self) -> Result<CommandBuilder, ShellError> {
        let mut cmd = CommandBuilder::new("/bin/bash");
        cmd.arg("--login");
        Ok(cmd)
    }

    fn default_size() -> PtySize {
        PtySize {
            rows: DEFAULT_ROWS,
            cols: DEFAULT_COLS,
            pixel_width: 0,
            pixel_height: 0,
        }
    }
}
