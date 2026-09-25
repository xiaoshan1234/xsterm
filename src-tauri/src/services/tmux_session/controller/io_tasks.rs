//! I/O tasks that drive a running `tmux -CC` child process:
//!
//! - [`spawn_reader_task`]: stdout → [`ProtocolParser`] → dispatch channel
//! - [`spawn_writer_task`]: stdin channel → stdin pipe
//! - [`spawn_stderr_drain_task`]: stderr → tracing
//! - [`spawn_monitor_task`]: `backend.wait()` → dispatch `Exit` event
//! - [`schedule_initial_state_sync`]: delayed `list-windows` query
//!
//! Plus the [`preview_hex`] helper used by the reader's debug logging.

use super::super::protocol::events::ProtocolEvent;
use super::super::protocol::parser::ProtocolParser;
use super::super::protocol::wire as tmux_cmd;
use super::TmuxController;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, Mutex};

use crate::infrastructure::tmux::backend::TmuxBackend;

/// Delay before the initial state sync query (Bug 017). The control-
/// mode forwarder needs this long to start reading responses before
/// we send the first query; otherwise the query and `new-window`
/// race and the server returns the wrong thing.
const INITIAL_STATE_SYNC_DELAY: Duration = Duration::from_millis(500);

/// Schedule a delayed `list-windows` query on a background OS thread so
/// the control-mode forwarder has time to start reading responses. The
/// dispatch task's `WindowList` handler then automatically issues a
/// follow-up `list-panes ""` query and registers the first pane for
/// `await_first_pane` — eliminating the race in Bug 016 / 017 where
/// the `list-panes` response was processed before its sender was
/// installed on the controller.
///
/// `session_name` is read from the controller's own `session_name`
/// slot (set by `spawn_create` / `spawn_attach`). Send `-t <session>`
/// instead of `-a` so we enumerate windows for THIS controller's
/// session only.
pub(super) fn schedule_initial_state_sync(
    controller: Arc<TmuxController>,
    stdin_tx: mpsc::UnboundedSender<String>,
) {
    thread::spawn(move || {
        thread::sleep(INITIAL_STATE_SYNC_DELAY);
        // Read the session name from the controller (single source of
        // truth). Empty string is a defensive fallback — in production
        // `spawn_create` already rejects configs without a session
        // name; if we somehow got here without one (e.g. test fixture
        // using `spawn_with_args`), we send `-a` as before rather than
        // crashing the spawn path.
        let session_name = controller.session_name().unwrap_or_default();
        let command = tmux_cmd::list_windows(&session_name);
        if stdin_tx.send(command).is_err() {
            tracing::debug!(
                "schedule_initial_state_sync: controller already closed stdin_tx; skipping"
            );
        }
    });
}

/// Spawn the stdout reader task.
///
/// Reads lines from `stdout`, feeds each line through a fresh
/// [`ProtocolParser`], and pushes the resulting [`ProtocolEvent`]s into
/// `dispatch_tx`. Exits when `stdout` returns EOF (tmux closed the pipe,
/// e.g. on `kill -9`) or when the consumer drops `dispatch_tx`.
///
/// **`tmux -CC` wraps its wire protocol in a DCS (Device Control
/// String) passthrough sequence**: stdout looks like
///
/// ```text
/// ESC P 1000 p %begin 1788701964 296 0 \n
/// %output %5 hello\n
/// %end 1788701964 296 0 \n
/// ESC \
/// ```
///
/// The DCS start marker (`ESC P 1000 p`, 7 bytes) is concatenated
/// to the first notification line with no intervening newline, and
/// the DCS end marker (`ESC \`, 2 bytes) may be appended to the last
/// notification. A naive `\n`-line splitter therefore hands the
/// parser a line like `"ESC P 1000 p%begin ..."` — the leading
/// `ESC P 1000 p` prefix causes the parser's `Unknown` branch to
/// drop the *entire* line (including the `%begin` notification
/// inside it). Strip both markers before feeding the parser.
pub(super) fn spawn_reader_task<R>(stdout: R, dispatch_tx: mpsc::UnboundedSender<ProtocolEvent>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut parser = ProtocolParser::new();
        let mut lines = BufReader::new(stdout).lines();
        tracing::info!("tmux reader: task started");
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    // DEBUG AID: log every raw byte tmux emits so we can
                    // diagnose wire-protocol mismatches from the rolling
                    // log without re-running with a debugger.
                    tracing::debug!(
                        "tmux reader: RAW line ({} bytes, hex preview {:?}): {:?}",
                        line.len(),
                        preview_hex(&line, 64),
                        line
                    );
                    // Strip DCS passthrough markers so the parser sees
                    // a clean `%xxx` line stream. See the function
                    // doc above for the byte sequence.
                    const DCS_START: &str = "\u{1b}P1000p";
                    const DCS_END: &str = "\u{1b}\\";
                    let stripped = line
                        .strip_prefix(DCS_START)
                        .unwrap_or(&line)
                        .trim_end_matches(DCS_END);
                    let was_dcs =
                        stripped.as_ptr() != line.as_ptr() || stripped.len() != line.len();
                    tracing::debug!(
                        "tmux reader: stripped line (DCS {}): {:?}",
                        if was_dcs { "yes" } else { "no" },
                        stripped
                    );
                    if let Some(event) = parser.feed(stripped) {
                        tracing::debug!("tmux reader: parser emitted event: {:?}", event);
                        if dispatch_tx.send(event).is_err() {
                            tracing::debug!("tmux reader: dispatch channel closed, exiting");
                            break;
                        }
                    }
                }
                Ok(None) => {
                    tracing::info!("tmux reader: stdout EOF (tmux closed pipe or exited)");
                    break;
                }
                Err(e) => {
                    tracing::error!("tmux reader: line read error: {e}");
                    break;
                }
            }
        }
        tracing::info!("tmux reader: task exiting");
    });
}

/// First `max_bytes` of `s` rendered as escaped hex (each byte
/// `"\\xNN"`), used by `spawn_reader_task` for a compact diagnostic
/// preview of long lines without flooding the rolling log.
fn preview_hex(s: &str, max_bytes: usize) -> String {
    let bytes = s.as_bytes();
    let take = bytes.len().min(max_bytes);
    let mut out = String::with_capacity(take * 4 + 8);
    for &b in &bytes[..take] {
        if b.is_ascii_graphic() || b == b' ' {
            out.push(b as char);
        } else {
            out.push_str(&format!("\\x{:02x}", b));
        }
    }
    if bytes.len() > take {
        out.push_str(&format!("…(+{} bytes)", bytes.len() - take));
    }
    out
}

/// Spawn the stdin writer task.
///
/// Drains `stdin_rx` and writes each command (newline-terminated, no
/// further framing needed) to `stdin`. Exits when all senders are
/// dropped (the last sender is `TmuxController::stdin_tx`, dropped by
/// [`TmuxController::close`]). On exit, calls `shutdown().await` on
/// `stdin` so tmux sees EOF on its stdin.
pub(super) fn spawn_writer_task<W>(mut stdin: W, mut stdin_rx: mpsc::UnboundedReceiver<String>)
where
    W: tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        while let Some(cmd) = stdin_rx.recv().await {
            if let Err(e) = stdin.write_all(cmd.as_bytes()).await {
                tracing::error!("tmux writer: write failed: {e}");
                break;
            }
            if let Err(e) = stdin.flush().await {
                tracing::error!("tmux writer: flush failed: {e}");
                break;
            }
        }
        let _ = stdin.shutdown().await;
    });
}

/// Spawn a stderr drain task.
///
/// tmux -CC does not normally write to stderr, but if it does (e.g. for a
/// tmux-internal warning) we want it in the rolling log file, not lost.
pub(super) fn spawn_stderr_drain_task<R>(stderr: R)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            tracing::warn!("tmux stderr: {line}");
        }
    });
}

/// Spawn the child-exit monitor task.
///
/// Takes the backend out of the shared mutex and `await`s
    /// `backend.wait()`. If the backend exited on its own (i.e.
    /// [`TmuxController::close`] did not set the `is_killed` flag), pushes a
    /// synthetic [`ProtocolEvent::Exit`] with the captured status as the
    /// reason.
///
/// takes a `Box<dyn TmuxBackend>` slot instead of a `Child`
/// directly — the trait's `wait()` abstracts over the local `Child` and
/// the SSH channel.
pub(super) fn spawn_monitor_task(
    backend: Arc<Mutex<Option<Box<dyn TmuxBackend>>>>,
    is_killed: Arc<AtomicBool>,
    dispatch_tx: mpsc::UnboundedSender<ProtocolEvent>,
) {
    tokio::spawn(async move {
        let mut backend = {
            let mut guard = backend.lock().await;
            match guard.take() {
                Some(b) => b,
                None => return, // close() already took it.
            }
        };
        let reason = match backend.wait().await {
            Ok(0) => None,
            Ok(code) => Some(format!("exit code: {code}")),
            Err(e) => Some(format!("wait error: {e}")),
        };
        tracing::debug!(
            "tmux controller monitor: backend.wait() returned reason={:?}, is_killed={}",
            reason,
            is_killed.load(Ordering::SeqCst)
        );
        if !is_killed.load(Ordering::SeqCst) {
            let _ = dispatch_tx.send(ProtocolEvent::Exit { reason });
        }
    });
}
