//! transport abstraction for [`TmuxController`](super::controller::TmuxController).
//!
//! ## Why a trait
//!
//! Prior to Wave 5 the controller was hardcoded to a local
//! `tokio::process::Child`. Wave 5 introduces a second transport — an
//! SSH exec channel — and we want both to drive the same reader /
//! writer / monitor task machinery inside the controller. A trait
//! abstraction lets us:
//!
//! - Add future transports (docker exec, telnet, serial, ...) without
//!   touching the controller's task orchestration.
//! - Mock both implementations in unit tests without spawning a real
//!   tmux binary or a real SSH server.
//!
//! The trait surface intentionally mirrors the three pipes the
//! controller consumes (`stdout` for the line reader, `stdin` for the
//! writer task, `stderr` for the drain task) plus the two lifecycle
//! primitives (`wait` for the monitor task, `kill` for `close()`). All
//! five methods take `&mut self` so the [`TmuxBackend`] can hand each
//! stream to its owning task exactly once.
//!
//! ## Implementations
//!
//! - [`LocalTmuxBackend`] wraps a `tokio::process::Child` and exposes
//!   its three pipes. This is the Wave 1 path that ships today.
//! - [`SshTmuxBackend`] wraps the channels of an
//!   [`SshConnectResult`](crate::infrastructure::ssh::SshConnectResult)
//!   produced by
//!   [`SshBackend::connect_exec`](crate::infrastructure::ssh::SshBackend::connect_exec).
//!   Bytes from the russh data loop are bridged through the same
//!   `sync_mpsc::Receiver<Option<Vec<u8>>>` the shell path uses; we
//!   adapt them to [`tokio::io::AsyncRead`] / [`tokio::io::AsyncWrite`]
//!   here so the controller's reader / writer tasks can stay
//!   transport-agnostic.
//!
//! Both impls are `Send + Sync + 'static` so they can sit behind a
//! `Box<dyn TmuxBackend>` on the controller.

use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::thread;
use std::time::Duration;

use futures_core::future::BoxFuture;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::mpsc;

use crate::error::StringError;

#[cfg(test)]
use std::sync::mpsc as sync_mpsc;

/// Abstract transport that owns a tmux `-CC` child / channel and its
/// I/O streams.
///
/// Implementations are constructed by
/// [`TmuxController::spawn_local`](super::controller::TmuxController::spawn_local) /
/// [`TmuxController::spawn_attach`](super::controller::TmuxController::spawn_attach)
/// after deciding whether to route through local PTY or SSH exec. The
/// controller never holds more than one `TmuxBackend` at a time — see
/// the trait's `take_*` methods for the ownership rules.
///
/// ## Lifecycle
///
/// ```text
///   ┌──────────────────────┐
///   │ TmuxController       │
///   │ backend: Box<dyn ...>│
///   └──────┬───────────────┘
///          │ spawn_*_task(backend.take_stdout()? as Box<dyn AsyncRead>)
///          │ spawn_*_task(backend.take_stdin()? as Box<dyn AsyncWrite>)
///          │ spawn_*_task(backend.take_stderr()? as Box<dyn AsyncRead>)
///          │ tokio::spawn(backend.wait())       // monitor task
///          │ controller.close() → backend.kill()
/// ```
///
/// Each `take_*` returns `Err` if the same backend has already yielded
/// that stream — the controller's `spawn_with_args` calls each
/// exactly once.
pub trait TmuxBackend: Send + Sync + 'static {
    /// Take the stdout reader (for the reader task to split lines from).
    /// Returns `None` on subsequent calls.
    ///
    /// `Err` is reserved for actual I/O errors (e.g. the child had no
    /// stdout pipe configured). Implementations should treat "already
    /// taken" as a programming error rather than an I/O error.
    fn take_stdout(&mut self) -> Result<Box<dyn AsyncRead + Send + Unpin>, String>;

    /// Take the stdin writer (for the writer task to drain commands
    /// into). Same ownership rules as [`take_stdout`](TmuxBackend::take_stdout).
    fn take_stdin(&mut self) -> Result<Box<dyn AsyncWrite + Send + Unpin>, String>;

    /// Take the stderr reader (for the drain task — tmux should not
    /// write much here, but if it does we want it in the rolling log).
    fn take_stderr(&mut self) -> Result<Box<dyn AsyncRead + Send + Unpin>, String>;

    /// Async wait for the backend to exit. Returns the exit code on
    /// clean termination, or `Err` on a wait / EOF failure. tmux's
    /// exit status is opaque to us — we only forward it into the
    /// `tmux-controller-exit` event payload.
    fn wait(&mut self) -> BoxFuture<'_, Result<i32, String>>;

    /// Best-effort kill. Used by
    /// [`TmuxController::close`](super::controller::TmuxController::close)
    /// to signal a teardown. Idempotent — `close()` may call this
    /// multiple times if the monitor task races.
    fn kill(&mut self) -> Result<(), String>;
}

// ---------------------------------------------------------------------------
// LocalTmuxBackend — wraps tokio::process::Child.
// ---------------------------------------------------------------------------

/// Local-tmux backend. Owns a [`tokio::process::Child`] spawned by
/// `tmux -CC …` and exposes its three pipes.
pub struct LocalTmuxBackend {
    child: tokio::process::Child,
}

impl LocalTmuxBackend {
    /// Build a backend from an already-spawned tmux child. Called by
    /// [`super::controller::TmuxController::spawn_with_args`] after
    /// `Command::new("tmux").args(...).spawn()` succeeds.
    pub fn new(child: tokio::process::Child) -> Self {
        Self { child }
    }
}

impl TmuxBackend for LocalTmuxBackend {
    fn take_stdout(&mut self) -> Result<Box<dyn AsyncRead + Send + Unpin>, String> {
        self.child
            .stdout
            .take()
            .ok_or_else(|| "tmux child has no stdout".to_string())
            .map(|s| Box::new(s) as Box<dyn AsyncRead + Send + Unpin>)
    }

    fn take_stdin(&mut self) -> Result<Box<dyn AsyncWrite + Send + Unpin>, String> {
        self.child
            .stdin
            .take()
            .ok_or_else(|| "tmux child has no stdin".to_string())
            .map(|s| Box::new(s) as Box<dyn AsyncWrite + Send + Unpin>)
    }

    fn take_stderr(&mut self) -> Result<Box<dyn AsyncRead + Send + Unpin>, String> {
        self.child
            .stderr
            .take()
            .ok_or_else(|| "tmux child has no stderr".to_string())
            .map(|s| Box::new(s) as Box<dyn AsyncRead + Send + Unpin>)
    }

    fn wait(&mut self) -> BoxFuture<'_, Result<i32, String>> {
        Box::pin(async move {
            let status = self.child.wait().await.map_err_string()?;
            Ok(status.code().unwrap_or(-1))
        })
    }

    fn kill(&mut self) -> Result<(), String> {
        // Best-effort — start_kill is allowed to fail when the child
        // is already gone. `close()` swallows this and the monitor
        // task will pick up the actual exit status from `wait`.
        let _ = self.child.start_kill();
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// SshTmuxBackend — bridges SshConnectResult to AsyncRead / AsyncWrite.
// ---------------------------------------------------------------------------

/// SSH-exec backend. Owns the channels returned by
/// [`SshBackend::connect_exec`](crate::infrastructure::ssh::SshBackend::connect_exec)
/// and adapts them to [`AsyncRead`] / [`AsyncWrite`] so the tmux
/// controller's reader / writer tasks can stay transport-agnostic.
///
/// ## Bridge
///
/// The SSH data loop writes raw bytes (and `None` on EOF) to a
/// `sync_mpsc::Sender<Option<Vec<u8>>>`. To use them in a `tokio::io`
/// context, we spawn a bridge thread at construction time that moves
/// every `Some(bytes)` into a `tokio::sync::mpsc::UnboundedSender` we
/// own. The receiver half becomes the [`SshAsyncRead`]'s source.
/// When the bridge thread sees `None` (channel closed) it drops the
/// sender; the tokio receiver then returns `None` on `recv()`, which
/// [`SshAsyncRead::poll_read`] surfaces as an EOF.
///
/// On the write side, [`SshAsyncWrite`] is just a thin wrapper over
/// `mpsc::UnboundedSender<Vec<u8>>` that forwards every `poll_write`
/// into a send. When the SSH data loop's `write_rx.recv()` returns
/// `None` (all senders dropped) it sends `eof()` on the russh channel
/// — tmux on the remote side then sees EOF on stdin and can finish.
pub struct SshTmuxBackend {
    /// tokio mpsc receiver for incoming bytes from the SSH data loop
    /// (already bridged from the underlying `sync_mpsc`). `None` after
    /// `take_stdout` is called.
    stdout_rx: Option<tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>>,
    /// Write side of the SSH data loop. Cloned into the
    /// [`SshAsyncWrite`] wrapper on `take_stdin`.
    stdin_tx: mpsc::UnboundedSender<Vec<u8>>,
    /// Stderr is unused on the SSH exec path (russh exec channels
    /// don't expose stderr separately), so we always return an empty
    /// stream from `take_stderr`.
    stderr_rx: Option<tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>>,
    /// Holder for the SSH `BridgedChannel` marker + the keepalive
    /// unused sender. Dropping this sends EOF on the russh channel
    /// (through the data loop's `write_rx.recv() == None` path) and
    /// ends the bridge thread.
    _lifetime: SshBackendLifetime,
    /// Remote command's exit code (captured from
    /// `SSH_MSG_CHANNEL_EXIT_STATUS` and stored by the SSH data loop).
    /// `None` until the server sends the status; the [`wait`] impl
    /// reads it and returns it to the tmux controller so the monitor
    /// task can distinguish a clean tmux exit (0) from a startup
    /// failure (non-zero).
    ///
    /// [`wait`]: TmuxBackend::wait
    exit_code: Arc<std::sync::Mutex<Option<i32>>>,
    /// Notified when `exit_code` is populated. `wait()` cannot rely
    /// on the stdout channel closing as its wait signal (the stdout
    /// reader is a separate task and has already taken
    /// `self.stdout_rx`), so it needs an explicit notification that
    /// "ExitStatus has been received" (Bug 012).
    exit_code_tx: tokio::sync::watch::Sender<Option<i32>>,
}

/// Bundles the lifetime-tied bits of an [`SshTmuxBackend`] — the
/// `BridgedChannel` marker the [`SshConnectResult`](crate::infrastructure::ssh::SshConnectResult)
/// carries, plus a sender to the keepalive channel so the data loop
/// doesn't see it close prematurely. Dropping this struct triggers
/// EOF on the russh channel via the `write_rx` closure path.
struct SshBackendLifetime {
    _channel: Box<dyn crate::infrastructure::ssh::SshChannel + Send>,
    _keepalive_unused_tx: mpsc::UnboundedSender<Vec<u8>>,
}

impl SshTmuxBackend {
    /// Build a backend from the channels returned by
    /// [`SshBackend::connect_exec`](crate::infrastructure::ssh::SshBackend::connect_exec).
    ///
    /// Spawns one OS thread to bridge `sync_mpsc::Receiver` →
    /// `tokio::sync::mpsc::UnboundedSender`. The thread lives until
    /// the SSH channel closes (the bridge sender side is dropped by
    /// the SSH data loop in that case).
    pub fn from_connect_result(result: crate::infrastructure::ssh::SshConnectResult) -> Self {
        let crate::infrastructure::ssh::SshConnectResult {
            channel,
            write_tx,
            read_rx,
            resize_tx: _resize_tx,
            exit_code,
            exit_code_tx,
        } = result;

        // Spawn the bridge thread: read from the SSH `sync_mpsc`,
        // forward into a tokio mpsc we own. The thread exits when
        // the SSH channel closes (read_rx returns `None`) or when our
        // tokio receiver is dropped (which happens when the backend is
        // dropped).
        let (tokio_tx, tokio_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        thread::Builder::new()
            .name("xsterm-ssh-tmux-bridge".to_string())
            .spawn(move || {
                while let Ok(Some(bytes)) = read_rx.recv() {
                    if tokio_tx.send(bytes).is_err() {
                        // Reader is gone — backend was dropped.
                        break;
                    }
                }
            })
            .expect("failed to spawn ssh-tmux bridge thread");

        // Stderr placeholder: exec channels don't surface a separate
        // stderr, so the drain task gets an empty stream.
        let (stderr_tx, stderr_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        drop(stderr_tx);

        // The keepalive channel lives on the data loop side; we hold a
        // sender here so the loop's `keepalive_rx.recv()` never returns
        // None during normal operation (see `run_data_loop` for the
        // `keepalive_alive` flag that handles the closed case anyway).
        let (keepalive_tx, _keepalive_rx_unused) = mpsc::unbounded_channel::<Vec<u8>>();

        Self {
            stdout_rx: Some(tokio_rx),
            stdin_tx: write_tx,
            stderr_rx: Some(stderr_rx),
            exit_code,
            exit_code_tx,
            _lifetime: SshBackendLifetime {
                _channel: channel,
                _keepalive_unused_tx: keepalive_tx,
            },
        }
    }
}

impl TmuxBackend for SshTmuxBackend {
    fn take_stdout(&mut self) -> Result<Box<dyn AsyncRead + Send + Unpin>, String> {
        let rx = self
            .stdout_rx
            .take()
            .ok_or_else(|| "ssh tmux backend: stdout already taken".to_string())?;
        // Wrap the tokio mpsc receiver as a Stream of byte chunks and
        // feed it directly into the AsyncRead adapter. Chunking is
        // fine for the controller's `BufReader::lines()` consumption:
        // tmux writes one line per SSH data-loop message, so each
        // chunk maps to one logical line.
        let stream = ReceiverStream::new(rx);
        Ok(Box::new(SshAsyncRead::new(stream)))
    }

    fn take_stdin(&mut self) -> Result<Box<dyn AsyncWrite + Send + Unpin>, String> {
        Ok(Box::new(SshAsyncWrite::new(self.stdin_tx.clone())))
    }

    fn take_stderr(&mut self) -> Result<Box<dyn AsyncRead + Send + Unpin>, String> {
        let rx = self
            .stderr_rx
            .take()
            .ok_or_else(|| "ssh tmux backend: stderr already taken".to_string())?;
        let stream = ReceiverStream::new(rx);
        Ok(Box::new(SshAsyncRead::new(stream)))
    }

    fn wait(&mut self) -> BoxFuture<'_, Result<i32, String>> {
        // Wait until the SSH data loop observes
        // `SSH_MSG_CHANNEL_EXIT_STATUS` and writes the captured exit
        // code into `self.exit_code`. The stdout reader is a separate
        // task and has already taken `self.stdout_rx`, so this
        // `wait()` cannot use stdout EOF as its completion signal —
        // the explicit `exit_code_notify` is the only reliable signal
        // (Bug 012: the previous implementation returned
        // `unwrap_or(-1)` immediately after the reader task took
        // stdout_rx, masking the real exit code as 0/127). A bounded
        // 5 s timeout is used so a server that never sends
        // ExitStatus (rare; OpenSSH always does) does not hang
        // forever.
        let exit_code = Arc::clone(&self.exit_code);
        let mut exit_code_rx = self.exit_code_tx.subscribe();
        let _stdout_rx = self.stdout_rx.take();
        Box::pin(async move {
            // Poll the watch channel: if the value is already Some
            // (e.g. ExitStatus was processed before the monitor task
            // reached its `await`), return immediately. Otherwise
            // `changed().await` until a value arrives or the 5 s
            // deadline elapses. The watch channel retains the latest
            // value across `subscribe()` (Bug 013: a one-shot `Notify`
            // would lose the wakeup if the data loop fired before
            // this future was created).
            let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
            loop {
                if let Some(code) = exit_code_rx.borrow().clone() {
                    return Ok(code);
                }
                let now = tokio::time::Instant::now();
                if now >= deadline {
                    tracing::warn!(
                        "SshTmuxBackend::wait timed out after 5 s waiting for ExitStatus"
                    );
                    return Ok(exit_code.lock().ok().and_then(|g| *g).unwrap_or(-1));
                }
                let remaining = deadline - now;
                tokio::select! {
                    res = exit_code_rx.changed() => {
                        if res.is_err() {
                            return Ok(exit_code.lock().ok().and_then(|g| *g).unwrap_or(-1));
                        }
                    }
                    _ = tokio::time::sleep(remaining) => {
                        return Ok(exit_code.lock().ok().and_then(|g| *g).unwrap_or(-1));
                    }
                }
            }
        })
    }

    fn kill(&mut self) -> Result<(), String> {
        // Dropping the stdin sender is what triggers EOF on the
        // russh channel — the data loop sees `write_rx.recv() ==
        // None` and sends `eof()`. We hold one clone here; dropping
        // it closes the only live sender (the controller's writer
        // task also holds a clone, but the dispatch path goes through
        // `close()` → `kill()` then drops the writer too via the
        // controller going out of scope).
        //
        // The simpler approach used by the shell path — calling a
        // `kill_tx` oneshot — isn't needed here: dropping the
        // `SshBackendLifetime` (which holds the data loop's keepalive
        // channel) plus the controller-side `stdin_tx` drop is enough
        // to terminate the bridge. Idempotent: calling `kill()` more
        // than once is a no-op.
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Adapter: tokio mpsc::UnboundedReceiver<Vec<u8>> as AsyncRead.
// ---------------------------------------------------------------------------

/// Wraps the bridge thread's `tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>`
/// as a tokio [`AsyncRead`]. EOF on the underlying receiver is
/// surfaced as `Poll::Ready(Ok(()))` with an empty buffer.
struct ReceiverStream<T> {
    rx: tokio::sync::mpsc::UnboundedReceiver<T>,
}

impl<T> ReceiverStream<T> {
    fn new(rx: tokio::sync::mpsc::UnboundedReceiver<T>) -> Self {
        Self { rx }
    }
}

impl<T> futures_core::Stream for ReceiverStream<T> {
    type Item = T;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.rx.poll_recv(cx)
    }
}

/// Adapter that turns a `Stream<Item = Vec<u8>>` into an
/// `AsyncRead` by collecting each item into the caller's buffer.
struct SshAsyncRead<S> {
    inner: S,
    pending: Option<Vec<u8>>,
    pos: usize,
}

impl<S> SshAsyncRead<S> {
    fn new(inner: S) -> Self {
        Self {
            inner,
            pending: None,
            pos: 0,
        }
    }
}

impl<S> AsyncRead for SshAsyncRead<S>
where
    S: futures_core::Stream<Item = Vec<u8>> + Unpin,
{
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        loop {
            // Drain any bytes we held over from a previous partial write.
            if self.pending.is_some() {
                let p = self.pending.as_ref().unwrap();
                let p_len = p.len();
                let pos = self.pos;
                if pos < p_len {
                    let remaining = &p[pos..];
                    let n = remaining.len().min(buf.remaining());
                    buf.put_slice(&remaining[..n]);
                    self.pos = pos + n;
                    if self.pos >= p_len {
                        self.pending = None;
                        self.pos = 0;
                    }
                    return Poll::Ready(Ok(()));
                }
                self.pending = None;
                self.pos = 0;
            }

            // Pull the next chunk from the underlying stream.
            match Pin::new(&mut self.inner).poll_next(cx) {
                Poll::Ready(Some(bytes)) => {
                    if bytes.is_empty() {
                        // Skip empty chunks — they're harmless but waste
                        // a loop iteration.
                        continue;
                    }
                    if bytes.len() <= buf.remaining() {
                        buf.put_slice(&bytes);
                        return Poll::Ready(Ok(()));
                    }
                    // Buffer the overflow for the next call.
                    let n = buf.remaining();
                    buf.put_slice(&bytes[..n]);
                    self.pending = Some(bytes);
                    self.pos = n;
                    return Poll::Ready(Ok(()));
                }
                Poll::Ready(None) => return Poll::Ready(Ok(())),
                Poll::Pending => return Poll::Pending,
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Adapter: mpsc::UnboundedSender<Vec<u8>> as AsyncWrite.
// ---------------------------------------------------------------------------

/// Thin [`AsyncWrite`] over `mpsc::UnboundedSender<Vec<u8>>`. Every
/// `poll_write` forwards the buffer into a `send`; `poll_flush` and
/// `poll_shutdown` are no-ops (the underlying channel has no flush /
/// shutdown semantics — sending EOF means dropping the sender).
struct SshAsyncWrite {
    tx: mpsc::UnboundedSender<Vec<u8>>,
}

impl SshAsyncWrite {
    fn new(tx: mpsc::UnboundedSender<Vec<u8>>) -> Self {
        Self { tx }
    }
}

impl AsyncWrite for SshAsyncWrite {
    fn poll_write(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        match self.tx.send(buf.to_vec()) {
            Ok(()) => Poll::Ready(Ok(buf.len())),
            Err(_) => Poll::Ready(Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "ssh write channel closed",
            ))),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Poll::Ready(Ok(()))
    }

    fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::sync::mpsc as tmpsc;

    /// Helper: drive `SshAsyncRead::poll_read` once with a fresh chunk
    /// already queued in the underlying `tokio::sync::mpsc`.
    async fn drain_one_chunk(rx: tmpsc::UnboundedReceiver<Vec<u8>>) -> Vec<u8> {
        let stream = ReceiverStream::new(rx);
        let mut reader = SshAsyncRead::new(stream);
        let mut buf = Vec::new();
        reader
            .read_to_end(&mut buf)
            .await
            .expect("read_to_end succeeds");
        buf
    }

    /// `SshAsyncRead` returns queued bytes verbatim and signals EOF
    /// (empty read) when the underlying receiver closes.
    #[tokio::test]
    async fn ssh_async_read_drains_queued_bytes_then_eof() {
        let (tx, rx) = tmpsc::unbounded_channel::<Vec<u8>>();
        tx.send(b"hello ".to_vec()).unwrap();
        tx.send(b"world".to_vec()).unwrap();
        drop(tx);

        let bytes = drain_one_chunk(rx).await;
        assert_eq!(bytes, b"hello world");
    }

    /// `SshAsyncRead` correctly buffers chunks that exceed the
    /// reader's available capacity (this happens whenever the
    /// controller's `BufReader` requests a smaller read than the
    /// chunk the SSH data loop wrote).
    #[tokio::test]
    async fn ssh_async_read_buffers_partial_chunks_across_calls() {
        let (tx, rx) = tmpsc::unbounded_channel::<Vec<u8>>();
        tx.send(b"abcdefghij".to_vec()).unwrap();
        drop(tx);

        let stream = ReceiverStream::new(rx);
        let mut reader = SshAsyncRead::new(stream);

        let mut buf = [0u8; 3];
        let n = reader.read(&mut buf).await.expect("read 1");
        assert_eq!(n, 3);
        assert_eq!(&buf, b"abc");

        let n = reader.read(&mut buf).await.expect("read 2");
        assert_eq!(n, 3);
        assert_eq!(&buf, b"def");

        let n = reader.read(&mut buf).await.expect("read 3");
        assert_eq!(n, 3);
        assert_eq!(&buf, b"ghi");

        let n = reader.read(&mut buf).await.expect("read 4");
        assert_eq!(n, 1);
        assert_eq!(buf[0], b'j');

        let n = reader.read(&mut buf).await.expect("read eof");
        assert_eq!(n, 0);
    }

    /// `SshAsyncWrite` forwards every byte to the underlying
    /// `tokio::sync::mpsc::UnboundedSender`.
    #[tokio::test]
    async fn ssh_async_write_forwards_bytes_to_mpsc() {
        let (tx, mut rx) = tmpsc::unbounded_channel::<Vec<u8>>();
        let mut writer = SshAsyncWrite::new(tx);
        writer.write_all(b"abc").await.expect("write");
        writer.write_all(b"def").await.expect("write");
        writer.flush().await.expect("flush");

        let a = rx.recv().await.expect("recv 1");
        let b = rx.recv().await.expect("recv 2");
        assert_eq!(a, b"abc");
        assert_eq!(b, b"def");
    }

    /// `SshAsyncWrite::poll_write` returns `BrokenPipe` once the
    /// receiver side is dropped, instead of silently succeeding.
    #[tokio::test]
    async fn ssh_async_write_errors_when_receiver_dropped() {
        let (tx, rx) = tmpsc::unbounded_channel::<Vec<u8>>();
        drop(rx);
        let mut writer = SshAsyncWrite::new(tx);
        let err = writer.write(b"x").await.expect_err("must error");
        assert_eq!(err.kind(), std::io::ErrorKind::BrokenPipe);
    }

    /// `SshTmuxBackend::from_connect_result` correctly bridges a
    /// `sync_mpsc::Receiver<Option<Vec<u8>>>` into a tokio
    /// `AsyncRead`. The bridge thread keeps forwarding until the
    /// sender side is dropped (which is what the SSH data loop does
    /// when the russh channel closes).
    #[tokio::test]
    async fn ssh_tmux_backend_from_connect_result_bridges_sync_to_async() {
        let (read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
        let (write_tx, _write_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (_resize_tx, _resize_rx) = mpsc::unbounded_channel::<(u16, u16)>();

        let result = crate::infrastructure::ssh::SshConnectResult {
            channel: Box::new(crate::infrastructure::ssh::BridgedChannel),
            write_tx,
            read_rx,
            resize_tx: Some(_resize_tx),
            exit_code: Arc::new(std::sync::Mutex::new(None)),
            exit_code_tx: tokio::sync::watch::channel(None::<i32>).0,
        };
        let mut backend = SshTmuxBackend::from_connect_result(result);

        // Send a few chunks through the sync channel, then close it.
        read_tx.send(Some(b"line1\n".to_vec())).unwrap();
        read_tx.send(Some(b"line2\n".to_vec())).unwrap();
        drop(read_tx);

        let mut stdout = backend.take_stdout().expect("stdout");
        let mut buf = Vec::new();
        tokio::io::AsyncReadExt::read_to_end(&mut stdout, &mut buf)
            .await
            .expect("read_to_end succeeds");
        assert_eq!(buf, b"line1\nline2\n");
    }

    /// `SshTmuxBackend::take_stdout` and `take_stderr` are
    /// idempotently one-shot — second calls return `Err` rather than
    /// panicking or handing out a duplicate reader.
    #[tokio::test]
    async fn ssh_tmux_backend_take_stdout_is_one_shot() {
        let (_read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
        let (write_tx, _write_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (_resize_tx, _resize_rx) = mpsc::unbounded_channel::<(u16, u16)>();

        let result = crate::infrastructure::ssh::SshConnectResult {
            channel: Box::new(crate::infrastructure::ssh::BridgedChannel),
            write_tx,
            read_rx,
            resize_tx: Some(_resize_tx),
            exit_code: Arc::new(std::sync::Mutex::new(None)),
            exit_code_tx: tokio::sync::watch::channel(None::<i32>).0,
        };
        let mut backend = SshTmuxBackend::from_connect_result(result);

        let _ = backend.take_stdout().expect("first take_stdout");
        match backend.take_stdout() {
            Err(err) => assert!(err.contains("already taken"), "got: {err}"),
            Ok(_) => panic!("second take_stdout must error"),
        }
    }

    /// `SshTmuxBackend::take_stdin` clones the sender so the writer
    /// task can keep its own handle independent of the backend.
    #[tokio::test]
    async fn ssh_tmux_backend_take_stdin_clones_sender() {
        let (_read_tx, read_rx) = sync_mpsc::channel::<Option<Vec<u8>>>();
        let (write_tx, mut write_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (_resize_tx, _resize_rx) = mpsc::unbounded_channel::<(u16, u16)>();

        let result = crate::infrastructure::ssh::SshConnectResult {
            channel: Box::new(crate::infrastructure::ssh::BridgedChannel),
            write_tx,
            read_rx,
            resize_tx: Some(_resize_tx),
            exit_code: Arc::new(std::sync::Mutex::new(None)),
            exit_code_tx: tokio::sync::watch::channel(None::<i32>).0,
        };
        let mut backend = SshTmuxBackend::from_connect_result(result);

        let mut stdin = backend.take_stdin().expect("stdin");
        tokio::io::AsyncWriteExt::write_all(&mut stdin, b"tmux-cmd\n")
            .await
            .expect("write");
        drop(stdin);

        let cmd = write_rx.recv().await.expect("recv from cloned sender");
        assert_eq!(cmd, b"tmux-cmd\n");
    }
}
