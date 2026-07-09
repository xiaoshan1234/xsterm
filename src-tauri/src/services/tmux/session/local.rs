use std::collections::VecDeque;
use std::ffi::OsString;
use std::io::Write;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::CommandBuilder;

use crate::error::StringError;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::{default_pty_size, PtySystem};
use crate::models::session::{SessionInfo, SessionType, TmuxSessionConfig};
use crate::services::tmux::channel_io::CapturePaneQueue;
use crate::services::tmux::commands::{build_tmux_argv, list_windows};
use crate::services::tmux::forwarder::spawn_control_forwarder;
use crate::services::tmux::session::{TmuxSession, TmuxSessionHandles};
use crate::services::tmux::state_tracker::StateTracker;

/// Create a local tmux `-CC` control session backed by a PTY.
///
/// Spawns `tmux -CC new-session -A -s <target>` (or the configured command)
/// on a PTY pair, starts the control-mode forwarder, and returns a handle to
/// the new session.
pub fn create_tmux_session<B: AppBackend + 'static>(
    backend: B,
    pty_system: &dyn PtySystem,
    config: TmuxSessionConfig,
    session_id: u32,
) -> Result<TmuxSession, String> {
    let target = config
        .target
        .clone()
        .unwrap_or_else(|| "xsterm".to_string());
    let name = config.name.clone().unwrap_or_else(|| target.clone());

    let tmux_args = build_tmux_argv(&config.command, Some(&target), config.socket.as_deref());

    let mut pair = pty_system.openpty(default_pty_size()).map_err_string()?;

    let cmd = CommandBuilder::from_argv(
        tmux_args.into_iter().map(|s| s.into()).collect::<Vec<OsString>>(),
    );

    let child = pair.spawn(cmd).map_err_string()?;
    let writer = pair.master_writer().map_err_string()?;
    let reader = pair.master_reader().map_err_string()?;

    let info = SessionInfo {
        id: session_id,
        name,
        session_type: SessionType::Tmux {
            socket: config.socket.clone(),
            command: config.command.clone(),
            target: target.clone(),
        },
        is_connected: true,
    };

    let writer = Arc::new(Mutex::new(writer));
    let exited = Arc::new(AtomicBool::new(false));
    let capture_queue: CapturePaneQueue = Arc::new(Mutex::new(VecDeque::new()));

    let child = Arc::new(Mutex::new(Some(child)));

    let session = TmuxSession {
        writer: Arc::clone(&writer),
        exited: Arc::clone(&exited),
        capture_queue: Arc::clone(&capture_queue),
        info,
        handles: TmuxSessionHandles {
            child: Mutex::new(Some(Arc::clone(&child))),
            forwarder: None,
            _pair: Some(pair),
            _channel: None,
        },
    };

    spawn_control_forwarder(
        reader,
        writer,
        backend,
        session_id,
        Arc::new(StateTracker::new()),
        capture_queue,
        Some(child),
        exited,
    );

    schedule_initial_sync(Arc::clone(&session.writer), &target);

    Ok(session)
}

/// Delay before requesting the initial state sync on a local tmux session to
/// give the control-mode forwarder time to start reading responses.
const INITIAL_SYNC_DELAY: Duration = Duration::from_millis(500);

/// Schedule a delayed `list-windows` request so the local session has time to
/// establish the tmux control channel before we ask for state.
fn schedule_initial_sync(writer: Arc<Mutex<Box<dyn Write + Send>>>, target: &str) {
    let target = target.to_string();
    thread::spawn(move || {
        thread::sleep(INITIAL_SYNC_DELAY);
        let command = list_windows(&target);
        let result = writer
            .lock()
            .map_err(|e| e.to_string())
            .and_then(|mut w| {
                w.write_all(command.as_bytes())
                    .map_err(|e| e.to_string())?;
                w.flush().map_err(|e| e.to_string())
            });
        if let Err(e) = result {
            tracing::error!("Failed to send initial state sync: {}", e);
        }
    });
}
