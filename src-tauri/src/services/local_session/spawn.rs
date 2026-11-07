//! PTY output forwarder: consumes xscore's output channel and emits
//! `session-output` / `session-disconnected` events on the [`AppBackend`].

use std::sync::Arc;
use std::time::Instant;

use tokio::sync::mpsc::UnboundedReceiver;

use crate::infrastructure::app_backend::AppBackend;

use super::bytes::{drain_should_break, utf8_safe_prefix_len};

/// Perf 005: how many bytes to accumulate before forcing an emit. Keeps
/// `yes` / `find /` style floods from translating to per-chunk IPC events.
pub(super) const DRAIN_SIZE_BYTES: usize = 64 * 1024;

/// Perf 005: time budget for a drain burst, bounding tail latency for slow
/// producers. With xscore's reader thread the channel delivers chunks as soon
/// as they are read, so this mostly matters while draining an already-buffered
/// flood.
pub(super) const DRAIN_INTERVAL: std::time::Duration = std::time::Duration::from_millis(8);

/// Spawn a background task that forwards PTY output to the frontend.
///
/// Chunks are drained from xscore's unbounded output channel and batched up to
/// [`DRAIN_SIZE_BYTES`] (or [`DRAIN_INTERVAL`]) before being emitted as a single
/// `session-output` event. Every emitted slice is a complete UTF-8 string; a
/// trailing incomplete codepoint is held in a remainder buffer and prefixed
/// onto the next burst so CJK / emoji are never split across events.
///
/// When the channel closes (the shell exited, or the PTY died) a final
/// `session-disconnected` event is emitted so the frontend can tear the
/// session down.
pub(super) fn spawn_output_forwarder(
    mut rx: UnboundedReceiver<Vec<u8>>,
    backend: Arc<dyn AppBackend>,
    session_id: u32,
) {
    let backend_clone = Arc::clone(&backend);
    backend.spawn(Box::new(move || {
        let mut remainder: Vec<u8> = Vec::new();

        loop {
            let Some(first) = rx.blocking_recv() else {
                break;
            };

            let mut accumulated = first;
            let burst_start = Instant::now();
            loop {
                match rx.try_recv() {
                    Ok(chunk) => {
                        accumulated.extend_from_slice(&chunk);
                        if drain_should_break(
                            accumulated.len(),
                            burst_start.elapsed(),
                            DRAIN_SIZE_BYTES,
                            DRAIN_INTERVAL,
                        ) {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }

            if !remainder.is_empty() {
                let mut joined = remainder.clone();
                joined.extend_from_slice(&accumulated);
                remainder.clear();
                accumulated = joined;
            }

            let safe_len = utf8_safe_prefix_len(&accumulated);
            let to_emit = if safe_len == accumulated.len() {
                std::mem::take(&mut accumulated)
            } else {
                remainder = accumulated[safe_len..].to_vec();
                accumulated[..safe_len].to_vec()
            };

            if !to_emit.is_empty()
                && backend_clone
                    .emit("session-output", &serde_json::json!([session_id, to_emit]))
                    .is_err()
            {
                break;
            }
        }

        let _ = backend_clone.emit("session-disconnected", &serde_json::json!(session_id));
    }));
}
