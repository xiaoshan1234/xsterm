use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::mpsc;
use std::thread::JoinHandle;

use crate::error::StringError;
use crate::infrastructure::session_backend::SessionBackend;
use crate::models::capabilities::CapabilityFlags;
use crate::models::session::SessionInfo;

/// Default terminal dimensions used when no explicit size is provided.
const DEFAULT_ROWS: u16 = 24;
const DEFAULT_COLS: u16 = 80;

/// Channel capacity for the writer → write_thread inbox. 64 messages give us
/// ~256 KB of headroom (matches typical JS paste chunking) while still
/// bounding memory if the writer thread falls behind. `sync_channel` is
/// used over `unbounded` to apply gentle backpressure on pathological
/// pastes without ever blocking normal typing.
const WRITER_CHANNEL_CAPACITY: usize = 64;

/// Abstraction over a PTY system that can allocate pseudo-terminal pairs.
pub trait PtySystem: Send + Sync {
    fn openpty(&self, size: PtySize) -> Result<Box<dyn PtyPair>, String>;
}

/// A pair of master/slave PTY endpoints.
pub trait PtyPair: Send + Sync {
    fn spawn(&mut self, cmd: CommandBuilder) -> Result<Box<dyn Child>, String>;
    fn master_writer(&mut self) -> Result<Box<dyn Write + Send>, String>;
    fn master_reader(&mut self) -> Result<Box<dyn Read + Send>, String>;
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String>;
}

/// A spawned child process attached to a PTY.
pub trait Child: Send + Sync {
    fn kill(self: Box<Self>) -> Result<(), String>;
}

/// Platform-native PTY system implementation backed by `portable-pty`.
pub struct NativePtySystem {
    // portable_pty::PtySystem is `Send` only — wrap in a Mutex so
    // `NativePtySystem: Sync` (required by `PtySystem: Send + Sync`).
    inner: std::sync::Mutex<Box<dyn portable_pty::PtySystem + Send>>,
}

impl NativePtySystem {
    /// Create a new native PTY system.
    pub fn new() -> Self {
        Self { inner: std::sync::Mutex::new(native_pty_system()) }
    }
}

impl PtySystem for NativePtySystem {
    fn openpty(&self, size: PtySize) -> Result<Box<dyn PtyPair>, String> {
        let pair = self.inner.lock().map_err_string()?.openpty(size).map_err_string()?;
        Ok(Box::new(NativePtyPair { inner: std::sync::Mutex::new(pair) }))
    }
}

struct NativePtyPair {
    // portable_pty::PtyPair is `Send` only (no Sync) — wrap in a Mutex so
    // `NativePtyPair: Sync` (required by `PtyPair: Send + Sync`).
    inner: std::sync::Mutex<portable_pty::PtyPair>,
}

impl PtyPair for NativePtyPair {
    fn spawn(&mut self, cmd: CommandBuilder) -> Result<Box<dyn Child>, String> {
        let guard = self.inner.lock().map_err_string()?;
        let child = guard.slave.spawn_command(cmd).map_err_string()?;
        Ok(Box::new(NativeChild { inner: std::sync::Mutex::new(child) }))
    }

    fn master_writer(&mut self) -> Result<Box<dyn Write + Send>, String> {
        let guard = self.inner.lock().map_err_string()?;
        guard.master.take_writer().map_err_string()
    }

    fn master_reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        let guard = self.inner.lock().map_err_string()?;
        guard.master.try_clone_reader().map_err_string()
    }

    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        let guard = self.inner.lock().map_err_string()?;
        guard.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err_string()
    }
}

pub struct NativeChild {
    /// The underlying child process. Kept alive to keep the process running.
    #[allow(dead_code)]
    inner: std::sync::Mutex<Box<dyn portable_pty::Child + Send>>,
}

impl Child for NativeChild {
    fn kill(self: Box<Self>) -> Result<(), String> {
        self.inner.lock().map_err_string()?.kill().map_err_string()
    }
}

/// Local session data, holding its metadata and the resources needed to drive
/// the underlying PTY for the session's.
///
/// The PTY master writer is owned exclusively by a dedicated writer thread
/// (see [`Write_thread`]); `write` only enqueues into a `mpsc::SyncSender`
/// and returns. This mirrors the pattern used by the SSH backend
/// (see `ssh.rs::SshSessionWrapper::write`) and by every other async
/// terminal emulator (alacritty, wezterm, kitty, oxideterm) — the IPC
/// handler must never perform a blocking syscall on a Tauri worker thread.
pub struct LocalSession {
    pub info: SessionInfo,
    pub writer_tx: mpsc::SyncSender<Vec<u8>>,
    pub capabilities: CapabilityFlags,
    pub handles: LocalSessionHandles,
}

impl SessionBackend for LocalSession {
    fn info(&self) -> &SessionInfo {
        &self.info
    }

    fn capabilities(&self) -> &CapabilityFlags {
        &self.capabilities
    }

    fn write(&self, data: &[u8]) -> Result<(), String> {
        // sync_channel send is non-blocking unless full; with capacity 64 and
        // ~4 KB chunks per paste, normal typing never fills it.
        self.writer_tx.try_send(data.to_vec()).map_err(|e| match e {
            mpsc::TrySendError::Full(_) => format!(
                "PTY writer inbox full for session {} (writer thread is blocked on the PTY)",
                self.info.id
            ),
            mpsc::TrySendError::Disconnected(_) => {
                format!("PTY writer thread closed for session {}", self.info.id)
            }
        })
    }

    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self.handles.resize(rows, cols)
    }

    fn close(mut self: Box<Self>) -> Result<(), String> {
        if let Some(child) = self.handles.child.take() {
            child.kill()?;
        }
        // Drop the sender to signal the writer thread to exit its loop, then
        // join it. `close` is the only place that drops the sender; without
        // this, the writer thread would block on `recv()` forever.
        drop(self.writer_tx);
        if let Some(handle) = self.handles.writer_thread.take() {
            // Best-effort join. A panic in the writer is already logged and
            // we don't want close() to abort the whole teardown.
            let _ = handle.join();
        }
        // `self.handles._pair` is dropped when the box is dropped, which on
        // Windows triggers `ClosePseudoConsole` and tears down the ConPTY.
        Ok(())
    }
}

/// Handles that must be kept alive for the lifetime of a local session.
pub struct LocalSessionHandles {
    /// The spawned child process. Kept alive to keep the session running.
    ///
    /// Stored as `Option` so that [`SessionManager::close`] can take ownership
    /// of the child and explicitly kill it.
    pub child: Option<Box<dyn Child>>,
    /// Keep the PTY pair alive — on Windows, dropping the pair calls
    /// `ClosePseudoConsole` which destroys the ConPTY and kills the session.
    pub _pair: Box<dyn PtyPair>,
    /// Dedicated writer thread that owns the PTY master writer and drains
    /// the `writer_tx` inbox. Joined in `LocalSession::close`.
    pub writer_thread: Option<JoinHandle<()>>,
}

impl LocalSessionHandles {
    /// Resize the underlying PTY to the requested dimensions.
    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self._pair.resize(rows, cols)
    }
}

/// Spawn the dedicated writer thread. The returned `SyncSender` is the only
/// way to push bytes into the PTY from any other thread; the thread holds the
/// `Box<dyn Write + Send>` exclusively and never yields it to anyone.
pub fn spawn_writer_thread(
    writer: Box<dyn Write + Send>,
) -> (mpsc::SyncSender<Vec<u8>>, JoinHandle<()>) {
    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(WRITER_CHANNEL_CAPACITY);
    let handle = std::thread::Builder::new()
        .name(format!("xsterm-pty-writer"))
        .spawn(move || {
            let mut writer = writer;
            loop {
                match rx.recv() {
                    Ok(data) => {
                        // No flush: PTY is a stream; write_all pushes to the
                        // kernel buffer and the slave side drains naturally.
                        // Per-keystroke flush is a perf hit — see
                        // doc/maintenance/perf.md Perf 002.
                        if writer.write_all(&data).is_err() {
                            // PTY closed — exit silently.
                            break;
                        }
                    }
                    Err(mpsc::RecvError) => {
                        // All senders dropped — normal shutdown path.
                        break;
                    }
                }
            }
        })
        .expect("failed to spawn xsterm-pty-writer thread");
    (tx, handle)
}

/// Helper to build a default [`PtySize`].
pub(crate) fn default_pty_size() -> PtySize {
    PtySize {
        rows: DEFAULT_ROWS,
        cols: DEFAULT_COLS,
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    struct CollectingWrite {
        received: Arc<Mutex<Vec<u8>>>,
    }

    impl Write for CollectingWrite {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.received.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn writer_thread_delivers_messages_in_order_and_exits_on_drop() {
        let received = Arc::new(Mutex::new(Vec::new()));
        let writer: Box<dyn Write + Send> = Box::new(CollectingWrite {
            received: received.clone(),
        });
        let (tx, handle) = spawn_writer_thread(writer);

        tx.send(b"hello ".to_vec()).expect("send 1");
        tx.send(b"world".to_vec()).expect("send 2");
        tx.send(b"!".to_vec()).expect("send 3");

        // Drop the sender — the writer thread should drain pending messages
        // and exit cleanly when its recv() returns Err.
        drop(tx);
        handle.join().expect("writer thread join");

        assert_eq!(*received.lock().unwrap(), b"hello world!".to_vec());
    }

    #[test]
    fn writer_thread_joins_with_pending_messages_still_in_flight() {
        // Multiple senders, one drops early — remaining sender keeps
        // delivering until all are dropped.
        let received = Arc::new(Mutex::new(Vec::new()));
        let writer: Box<dyn Write + Send> = Box::new(CollectingWrite {
            received: received.clone(),
        });
        let (tx, handle) = spawn_writer_thread(writer);
        let tx2 = tx.clone();

        tx.send(b"alpha ".to_vec()).unwrap();
        drop(tx);
        tx2.send(b"beta".to_vec()).unwrap();
        drop(tx2);

        handle.join().unwrap();
        assert_eq!(*received.lock().unwrap(), b"alpha beta".to_vec());
    }
}