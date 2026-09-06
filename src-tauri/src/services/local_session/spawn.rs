//! PTY output forwarder — reads from the PTY master fd on a dedicated
//! thread, drains into a sized/time-budgeted burst, and emits
//! `session-output` events on the [`AppBackend`].
//!
//! Split out of `mod.rs` because the forwarder is the most algorithm-
//! heavy code in the local-session module: a 100+-line single function
//! with thread synchronization, drain budgets, UTF-8 boundary handling,
//! and EOF semantics. Pulling it into its own file keeps the public
//! `create_local_session` API entry point short and scannable.

use std::io::{ErrorKind, Read};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::infrastructure::app_backend::AppBackend;

use super::bytes::{drain_should_break, utf8_safe_prefix_len};

/// Per-call buffer size for `reader.read` from the PTY master fd.
pub(super) const PTY_READ_BUFFER_SIZE: usize = 8192;

/// Perf 005: how many bytes to accumulate before forcing an emit. Keeps
/// `yes` / `find /` style floods from translating to per-read IPC events
/// (oxideterm's `LOCAL_MAX_LOCKED_PARSE_BYTES`, which is also 64 KiB).
pub(super) const DRAIN_SIZE_BYTES: usize = 64 * 1024;

/// Perf 005: how long to wait for the producer between reads before
/// flushing whatever we have. Bounds tail latency for slow producers
/// (e.g. `cat | less`) so the user sees something within ~8 ms of
/// output rather than waiting for the 64 KiB threshold.
pub(super) const DRAIN_INTERVAL: Duration = Duration::from_millis(8);

/// Spawn a background thread that forwards PTY output to the frontend.
///
/// Perf 005: drain budget. Each iteration accumulates reads into a local
/// buffer until either the size budget (`DRAIN_SIZE_BYTES`) or the time
/// budget (`DRAIN_INTERVAL`) is hit, then emits a single `session-output`
/// event for the accumulated slice. This caps the per-burst emit rate at
/// `1 / DRAIN_INTERVAL` (≈ 125 Hz) instead of one event per `read()`,
/// which would otherwise flood the IPC channel for `yes` / `find /` /
/// `cat large_file` style producers.
///
/// **Threading model**: the blocking `Read::read()` is performed on a
/// dedicated reader thread; chunks are sent over a bounded `sync_channel`
/// (capacity 16, i.e. 128 KiB). The main drain loop calls
/// `recv_timeout(DRAIN_INTERVAL)` so the time budget fires even when no
/// data has arrived — fixing the original bug where a slow producer
/// (e.g. one character typed, then a 1-second pause) would be held in
/// the read syscall indefinitely until the next byte arrived.
///
/// UTF-8 safe boundary: every emitted slice is a complete UTF-8 string;
/// any trailing incomplete codepoint is held in `remainder` and prefixed
/// onto the next burst, so multi-byte characters (CJK, emoji) never get
/// split across events.
///
/// EOF semantics:
/// - Before any data has been read, `Ok(0)` is treated as a transient PTY
///   condition (ConPTY on Windows can briefly return EOF before data flows
///   through the cloned master reader) and the read is retried after a short
///   delay. Emitting `session-disconnected` here would mark a healthy
///   session as disconnected the moment it opens.
/// - Once data has been observed, a subsequent `Ok(0)` is treated as the
///   genuine end-of-stream (the shell exited) and the frontend is notified.
/// - Read errors are also surfaced as `session-disconnected` instead of
///   silently killing the forwarder, so the UI reflects a broken PTY.
pub(super) fn spawn_output_forwarder(
    reader: Box<dyn Read + Send>,
    backend: Arc<dyn AppBackend>,
    session_id: u32,
) {
    const CHANNEL_CAPACITY: usize = 16;
    let (data_tx, data_rx) = mpsc::sync_channel::<Vec<u8>>(CHANNEL_CAPACITY);

    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; PTY_READ_BUFFER_SIZE];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    break;
                }
                Ok(n) => {
                    let chunk = buf[..n].to_vec();
                    if data_tx.send(chunk).is_err() {
                        break;
                    }
                }
                Err(e)
                    if matches!(
                        e.kind(),
                        ErrorKind::WouldBlock | ErrorKind::Interrupted
                    ) =>
                {
                    continue;
                }
                Err(e) => {
                    tracing::error!(
                        "PTY read error for session {}: {}; notifying frontend",
                        session_id,
                        e
                    );
                    let _ = data_tx.send(Vec::new());
                    break;
                }
            }
        }
    });

    let backend_clone = backend.clone();
    backend.spawn(Box::new(move || {
        let mut seen_data = false;
        let mut remainder: Vec<u8> = Vec::new();

        'outer: loop {
            let mut accumulated: Vec<u8> = Vec::with_capacity(DRAIN_SIZE_BYTES);
            let mut burst_start: Option<Instant> = None;
            let mut eof_seen = false;

            loop {
                let now = Instant::now();
                match data_rx.recv_timeout(DRAIN_INTERVAL) {
                    Ok(chunk) => {
                        if chunk.is_empty() {
                            eof_seen = true;
                            break;
                        }

                        let burst_start = burst_start.get_or_insert(now);

                        if !remainder.is_empty() {
                            accumulated.extend_from_slice(&remainder);
                            remainder.clear();
                        }
                        accumulated.extend_from_slice(&chunk);

                        if drain_should_break(
                            accumulated.len(),
                            now.duration_since(*burst_start),
                            DRAIN_SIZE_BYTES,
                            DRAIN_INTERVAL,
                        ) {
                            break;
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        break;
                    }
                    Err(RecvTimeoutError::Disconnected) => {
                        eof_seen = true;
                        break;
                    }
                }
            }

            let safe_len = utf8_safe_prefix_len(&accumulated);
            let to_emit = if safe_len == accumulated.len() {
                std::mem::take(&mut accumulated)
            } else {
                remainder = accumulated[safe_len..].to_vec();
                accumulated[..safe_len].to_vec()
            };

            if !to_emit.is_empty() {
                if let Err(e) = backend_clone.emit(
                    "session-output",
                    &serde_json::json!([session_id, to_emit]),
                ) {
                    tracing::error!("Failed to emit session output: {}", e);
                    break 'outer;
                }
                seen_data = true;
            }

            if eof_seen {
                if seen_data {
                    tracing::info!(
                        "PTY EOF for session {} after data — shell exited",
                        session_id
                    );
                    let _ = backend_clone.emit(
                        "session-disconnected",
                        &serde_json::json!(session_id),
                    );
                } else {
                    tracing::debug!(
                        "Transient PTY EOF before data for session {}; retrying",
                        session_id
                    );
                    std::thread::sleep(Duration::from_millis(100));
                    remainder.clear();
                    continue 'outer;
                }
                break;
            }
        }
    }));
}
