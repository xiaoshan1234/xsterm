use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::Child;
use crate::tmux::channel_io::CapturePaneQueue;
use crate::tmux::handlers::{handle_message, DispatchState};
use crate::tmux::parser::TmuxControlParser;
use crate::tmux::events::emit_closed;

const TMUX_READ_BUFFER_SIZE: usize = 8192;
const CHILD_CHECK_INTERVAL: Duration = Duration::from_secs(1);

/// Spawn a background thread that reads tmux control mode output and dispatches
/// messages to the frontend.
pub fn spawn_control_forwarder(
    mut reader: Box<dyn Read + Send>,
    backend: impl AppBackend + 'static,
    session_id: u32,
    exited: Arc<AtomicBool>,
    child: Option<Arc<Mutex<Box<dyn Child>>>>,
    capture_queue: CapturePaneQueue,
) {
    let state = Arc::new(DispatchState::default());
    let backend_clone = backend.clone();
    let state_clone = Arc::clone(&state);
    let capture_queue_clone = Arc::clone(&capture_queue);

    backend.spawn(Box::new(move || {
        let classifier_queue = Arc::clone(&capture_queue_clone);
        let mut parser = TmuxControlParser::with_classifier(move || {
            classifier_queue.lock().ok()?.pop_front()
        });
        let mut buf = [0u8; TMUX_READ_BUFFER_SIZE];
        let mut last_child_check = Instant::now();

        loop {
            check_child_status(
                child.as_ref(),
                &backend_clone,
                session_id,
                &exited,
                &mut last_child_check,
            );

            match reader.read(&mut buf) {
                Ok(0) => {
                    emit_closed(&backend_clone, session_id);
                    break;
                }
                Ok(n) => {
                    tracing::trace!("tmux session {} read {} bytes", session_id, n);
                    for message in parser.parse(&buf[..n]) {
                        tracing::trace!("tmux session {} parsed {:?}", session_id, message);
                        handle_message(
                            &backend_clone,
                            session_id,
                            message,
                            &state_clone,
                            &exited,
                        );
                    }
                }
                Err(e) => {
                    tracing::error!("tmux session {} read error: {}", session_id, e);
                    emit_closed(&backend_clone, session_id);
                    break;
                }
            }
        }

        for message in parser.flush() {
            handle_message(
                &backend_clone,
                session_id,
                message,
                &state_clone,
                &exited,
            );
        }

        exited.store(true, Ordering::Relaxed);
    }));
}

/// Periodically check whether the local tmux child has exited.
fn check_child_status<B: AppBackend>(
    child: Option<&Arc<Mutex<Box<dyn Child>>>>,
    backend: &B,
    session_id: u32,
    exited: &Arc<AtomicBool>,
    last_check: &mut Instant,
) -> bool {
    let child_ref = match child {
        Some(c) => c,
        None => return false,
    };

    if last_check.elapsed() < CHILD_CHECK_INTERVAL {
        return false;
    }
    *last_check = Instant::now();

    let status = child_ref
        .lock()
        .ok()
        .and_then(|mut c| c.try_wait().ok()?);

    if let Some(status) = status {
        tracing::info!("tmux session {} child exited with status {:?}", session_id, status);
        emit_closed(backend, session_id);
        exited.store(true, Ordering::Relaxed);
        true
    } else {
        false
    }
}
