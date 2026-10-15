//! L0 — 会话管理。
//!
//! 维护 `SessionId → SessionHandle` 映射,负责 spawn / write / resize / close。
//! Reader 在新线程中循环 `read` → 通过 `mpsc::Sender<ReaderMessage>` 发回主线程,
//! 由 L1 的 dispatch 线程 `app.emit("terminal-data", ...)`。**本模块不接触 Tauri**。
//!
//! 命名遵循 [`doc/rules/rust-name-rules.md`],枚举变体 `UpperCamelCase`。

use std::collections::HashMap;
use std::io::Write;
use std::sync::mpsc;

use portable_pty::{Child, MasterPty, PtySize};

use crate::core::pty::{self, PtyError, PtyPair};
use crate::core::shell::{self, ShellError, ShellKind};

/// 进程内会话 id。newtype(见命名规范 §类型)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct SessionId(pub u64);

impl std::fmt::Display for SessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionInfo {
    pub id: SessionId,
    pub shell_kind: ShellKind,
    pub alive: bool,
}

#[derive(Debug)]
pub enum SessionError {
    NotFound(SessionId),
    Shell(ShellError),
    Pty(PtyError),
    Io(String),
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(id) => write!(f, "session {id} not found"),
            Self::Shell(e) => write!(f, "{e}"),
            Self::Pty(e) => write!(f, "{e}"),
            Self::Io(m) => write!(f, "io: {m}"),
        }
    }
}

impl std::error::Error for SessionError {}

impl From<ShellError> for SessionError {
    fn from(e: ShellError) -> Self {
        Self::Shell(e)
    }
}

impl From<PtyError> for SessionError {
    fn from(e: PtyError) -> Self {
        Self::Pty(e)
    }
}

/// 单个会话的可变句柄。`writer` 用于 `write_terminal`,`master` 用于 `resize_terminal`,
/// `child` 持有以保活子进程(struct drop 时会发送信号,见 portable-pty 文档)。
pub struct SessionHandle {
    pub shell_kind: ShellKind,
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
    _child: Box<dyn Child + Send + Sync>,
}

/// Reader 线程 → dispatch 线程的内部消息。
///
/// M1 阶段 dispatch 层只把 `chunk` 透传给前端(沿用 M0 的 wire format);
/// `id` 字段保留,M2 多会话时把它合入 IPC payload。
#[derive(Debug)]
pub enum ReaderMessage {
    Data { id: SessionId, chunk: Vec<u8> },
    Exit { id: SessionId },
}

/// 持有所有活跃会话 + reader 消息通道 sender。
pub struct SessionManager {
    map: HashMap<SessionId, SessionHandle>,
    next_id: u64,
    reader_tx: mpsc::Sender<ReaderMessage>,
}

const READER_BUF_BYTES: usize = 8192;

impl SessionManager {
    pub fn new(reader_tx: mpsc::Sender<ReaderMessage>) -> Self {
        Self {
            map: HashMap::new(),
            next_id: 1,
            reader_tx,
        }
    }

    /// 启动一个 shell 子进程,返回新会话 id。
    /// 副作用:派生一个 reader 线程,持续把数据写进 `reader_tx`。
    pub fn spawn(&mut self, kind: ShellKind, size: PtySize) -> Result<SessionId, SessionError> {
        let shell = shell::build(kind)?;
        let PtyPair {
            master,
            reader,
            child,
        } = pty::open(shell.as_ref(), size)?;
        let writer = master
            .take_writer()
            .map_err(|e| SessionError::Pty(PtyError::CloneWriter(e.to_string())))?;

        let id = SessionId(self.next_id);
        self.next_id = self
            .next_id
            .checked_add(1)
            .ok_or_else(|| SessionError::Io("session id overflow".into()))?;

        self.start_reader(id, reader);

        self.map.insert(
            id,
            SessionHandle {
                shell_kind: kind,
                writer,
                master,
                _child: child,
            },
        );
        Ok(id)
    }

    fn start_reader(&self, id: SessionId, mut reader: Box<dyn std::io::Read + Send>) {
        let tx = self.reader_tx.clone();
        std::thread::spawn(move || {
            let mut buf = vec![0u8; READER_BUF_BYTES];
            loop {
                let n = match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => n,
                    Err(_) => break,
                };
                let chunk = buf[..n].to_vec();
                if tx.send(ReaderMessage::Data { id, chunk }).is_err() {
                    break;
                }
            }
            let _ = tx.send(ReaderMessage::Exit { id });
        });
    }

    pub fn write(&mut self, id: SessionId, data: &[u8]) -> Result<(), SessionError> {
        let handle = self.map.get_mut(&id).ok_or(SessionError::NotFound(id))?;
        handle
            .writer
            .write_all(data)
            .map_err(|e| SessionError::Io(e.to_string()))?;
        handle
            .writer
            .flush()
            .map_err(|e| SessionError::Io(e.to_string()))?;
        Ok(())
    }

    pub fn resize(&mut self, id: SessionId, size: PtySize) -> Result<(), SessionError> {
        let handle = self.map.get_mut(&id).ok_or(SessionError::NotFound(id))?;
        handle
            .master
            .resize(size)
            .map_err(|e| SessionError::Pty(PtyError::Resize(e.to_string())))?;
        Ok(())
    }

    pub fn close(&mut self, id: SessionId) -> Result<(), SessionError> {
        self.map
            .remove(&id)
            .map(|_| ())
            .ok_or(SessionError::NotFound(id))
    }

    pub fn list(&self) -> Vec<SessionInfo> {
        self.map
            .iter()
            .map(|(id, h)| SessionInfo {
                id: *id,
                shell_kind: h.shell_kind,
                alive: true,
            })
            .collect()
    }

    pub fn get(&self, id: SessionId) -> Option<&SessionHandle> {
        self.map.get(&id)
    }
}

/// 命令层在 [`lib::run`] 启动 dispatch 线程时使用这个容量。
pub fn reader_channel() -> (mpsc::Sender<ReaderMessage>, mpsc::Receiver<ReaderMessage>) {
    mpsc::channel()
}
