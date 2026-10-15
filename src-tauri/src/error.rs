//! L1 — IPC 错误。
//!
//! `AppError` 是命令 handler 唯一返回的错误类型。
//! 通过 `serde::Serialize` 序列化为字符串,前端接收为 `string`。
//! 不实现 `#[derive(Serialize)]` 以避免泄漏内部类型信息。

use crate::core::session::SessionError;

#[derive(Debug)]
pub enum AppError {
    LockPoisoned,
    Session(SessionError),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::LockPoisoned => write!(f, "internal lock poisoned"),
            Self::Session(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for AppError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Session(e) => Some(e),
            _ => None,
        }
    }
}

impl From<SessionError> for AppError {
    fn from(e: SessionError) -> Self {
        Self::Session(e)
    }
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
