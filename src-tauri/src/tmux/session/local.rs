//! Local PTY-backed tmux control mode session creation.
//!
//! This submodule spawns `tmux -CC` on the local machine using the portable
//! PTY abstraction. The returned [`TmuxSession`] shares its write path with
//! SSH-backed sessions; the [`TmuxSessionHandles`] keep the child process and
//! PTY pair alive for the lifetime of the session.

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::error::StringError;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::{Child, PtySystem};
use crate::models::session::{SessionInfo, SessionType, TmuxSessionConfig};
use crate::tmux::channel_io::CapturePaneQueue;
use crate::tmux::commands::build_tmux_argv;
use crate::tmux::forwarder::spawn_control_forwarder;
use crate::tmux::session::{TmuxSession, TmuxSessionHandles};

const TMUX_BINARY: &str = "tmux";
const CONTROL_MODE_FLAG: &str = "-CC";
const SOCKET_FLAG: &str = "-L";

/// Create a new tmux control mode session backed by a local PTY.
pub fn create_tmux_session(
    pty_system: &dyn PtySystem,
    config: TmuxSessionConfig,
    backend: impl AppBackend + 'static,
    session_id: u32,
) -> Result<(TmuxSession, TmuxSessionHandles), String> {
    let mut pair = pty_system
        .openpty(crate::infrastructure::pty::default_pty_size())
        .map_err_string()?;

    let mut cmd = portable_pty::CommandBuilder::new(TMUX_BINARY);
    cmd.arg(CONTROL_MODE_FLAG);

    if let Some(socket) = &config.socket {
        cmd.arg(SOCKET_FLAG);
        cmd.arg(socket);
    }

    let argv = build_tmux_argv(&config.command, config.target.as_deref());
    for arg in &argv {
        cmd.arg(arg);
    }

    tracing::info!(
        "tmux session {} spawn argv: tmux -CC {}",
        session_id,
        argv.join(" ")
    );

    let child = pair.spawn(cmd).map_err_string()?;
    tracing::info!("tmux session {} child spawned", session_id);

    let writer = Arc::new(Mutex::new(pair.master_writer().map_err_string()?));
    let reader = pair.master_reader().map_err_string()?;

    let info = SessionInfo {
        id: session_id,
        name: config.name.clone().unwrap_or_else(|| "tmux".to_string()),
        session_type: SessionType::Tmux {
            socket: config.socket.clone(),
            command: config.command.clone(),
        },
        is_connected: true,
    };

    let exited = Arc::new(AtomicBool::new(false));
    let capture_queue: CapturePaneQueue = Arc::new(Mutex::new(std::collections::VecDeque::new()));
    let child_for_forwarder: Arc<Mutex<Box<dyn Child>>> = Arc::new(Mutex::new(child));

    spawn_control_forwarder(
        reader,
        backend,
        session_id,
        Arc::clone(&exited),
        Some(Arc::clone(&child_for_forwarder)),
        Arc::clone(&capture_queue),
    );

    let handles = TmuxSessionHandles {
        _child: child_for_forwarder,
        _pair: pair,
    };

    Ok((
        TmuxSession {
            info,
            writer,
            capture_queue,
            exited,
            _ssh_channel: None,
        },
        handles,
    ))
}
