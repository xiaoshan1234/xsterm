use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::Child;
use crate::services::tmux::channel_io::CapturePaneQueue;
use crate::services::tmux::handlers::{handle_message, DispatchState};
use crate::services::tmux::parser::TmuxControlParser;

/// Interval between checks for the underlying child process status.
const CHILD_CHECK_INTERVAL: Duration = Duration::from_millis(500);

/// Buffer size for reading from the tmux control-mode transport.
const READ_BUFFER_SIZE: usize = 8192;

/// Spawn a background thread that reads tmux control-mode bytes, parses them,
/// and dispatches the resulting messages to the frontend.
///
/// The forwarder exits when the reader reaches EOF, the child process exits, or
/// an `%exit` notification is received.
pub fn spawn_control_forwarder<B: AppBackend + 'static>(
    reader: Box<dyn Read + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    backend: B,
    session_id: u32,
    state: Arc<DispatchState>,
    capture_queue: CapturePaneQueue,
    child: Option<Arc<Mutex<Option<Box<dyn Child>>>>>,
    exited: Arc<AtomicBool>,
) {
    backend.spawn(Box::new(move || {
        run_forwarder_loop(
            reader,
            writer,
            backend,
            session_id,
            state,
            capture_queue,
            child,
            exited,
        );
    }));
}

fn run_forwarder_loop<B: AppBackend>(
    mut reader: Box<dyn Read + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    backend: B,
    session_id: u32,
    state: Arc<DispatchState>,
    capture_queue: CapturePaneQueue,
    child: Option<Arc<Mutex<Option<Box<dyn Child>>>>>,
    exited: Arc<AtomicBool>,
) {
    let mut parser = TmuxControlParser::with_classifier(move || {
        capture_queue.lock().ok()?.pop_front()
    });
    let mut buf = [0u8; READ_BUFFER_SIZE];
    let mut last_child_check = Instant::now();

    loop {
        if exited.load(Ordering::Relaxed) {
            break;
        }

        match reader.read(&mut buf) {
            Ok(0) => {
                tracing::info!("tmux control reader EOF for session {}", session_id);
                exited.store(true, Ordering::Relaxed);
                break;
            }
            Ok(n) => {
                let messages = parser.parse(&buf[..n]);
                for message in messages {
                    let mut writer_guard = match writer.lock() {
                        Ok(guard) => guard,
                        Err(e) => {
                            tracing::error!("tmux writer lock poisoned for session {}: {}", session_id, e);
                            break;
                        }
                    };
                    match handle_message(
                        message,
                        &state,
                        &backend,
                        session_id,
                        writer_guard.as_mut(),
                        &exited,
                    ) {
                        Ok(true) => {
                            tracing::info!("tmux session {} closing after exit notification", session_id);
                            return;
                        }
                        Ok(false) => {}
                        Err(e) => {
                            tracing::error!("Error handling tmux message for session {}: {}", session_id, e);
                        }
                    }
                }
            }
            Err(e) => {
                tracing::error!("tmux control read error for session {}: {}", session_id, e);
                exited.store(true, Ordering::Relaxed);
                break;
            }
        }

        if check_child_status(&child, &mut last_child_check) {
            tracing::info!("tmux child process exited for session {}", session_id);
            exited.store(true, Ordering::Relaxed);
            break;
        }
    }

    if let Err(e) = crate::services::tmux::events::emit_closed(&backend, session_id) {
        tracing::error!("Failed to emit session-closed for session {}: {}", session_id, e);
    }
}

/// Check whether the underlying child process has exited, throttling checks to
/// `CHILD_CHECK_INTERVAL`.
fn check_child_status(
    child: &Option<Arc<Mutex<Option<Box<dyn Child>>>>>,
    last_check: &mut Instant,
) -> bool {
    let child = match child {
        Some(c) => c,
        None => return false,
    };

    if last_check.elapsed() < CHILD_CHECK_INTERVAL {
        return false;
    }
    *last_check = Instant::now();

    match child.lock() {
        Ok(mut c) => match c.as_mut() {
            Some(c) => match c.try_wait() {
                Ok(Some(_status)) => true,
                Ok(None) => false,
                Err(e) => {
                    tracing::error!("Failed to check child status: {}", e);
                    false
                }
            },
            None => false,
        },
        Err(e) => {
            tracing::error!("Child lock poisoned: {}", e);
            false
        }
    }
}
