//! Output forwarder: drains an xscore transport receiver and emits
//! `terminal-output` / `terminal-disconnected` events.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::mpsc::UnboundedReceiver;

use crate::connect::app_backend::AppBackend;

/// Maximum bytes accumulated before forcing an emit.
const DRAIN_SIZE_BYTES: usize = 64 * 1024;

/// Time budget for a drain burst, bounding tail latency.
const DRAIN_INTERVAL: Duration = Duration::from_millis(8);

/// Spawn a task that batches transport output and forwards it to the frontend.
///
/// Emitted slices are always complete UTF-8; a trailing incomplete codepoint is
/// held over and prefixed onto the next burst. When the receiver closes, a
/// final `terminal-disconnected` event is emitted.
pub(crate) fn spawn_output_forwarder(
    mut rx: UnboundedReceiver<Vec<u8>>,
    backend: Arc<dyn AppBackend>,
    session_id: u32,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let mut remainder: Vec<u8> = Vec::new();

        loop {
            let Some(first) = rx.recv().await else {
                break;
            };

            let mut accumulated = first;
            let burst_start = Instant::now();
            loop {
                match rx.try_recv() {
                    Ok(chunk) => {
                        accumulated.extend_from_slice(&chunk);
                        if accumulated.len() >= DRAIN_SIZE_BYTES
                            || burst_start.elapsed() >= DRAIN_INTERVAL
                        {
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

            if !to_emit.is_empty() && backend.emit_bytes(session_id, to_emit).is_err() {
                break;
            }
        }

        let _ = backend.emit("terminal-disconnected", &serde_json::json!(session_id));
    })
}

fn utf8_safe_prefix_len(bytes: &[u8]) -> usize {
    match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        Err(e) => e.valid_up_to(),
    }
}
