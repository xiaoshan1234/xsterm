use std::io::{Read, Write};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::collections::VecDeque;
use std::thread;
use std::time::Duration;

use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::ssh::{SshBackend, SshConnectResult};
use crate::models::session::{SessionInfo, SessionType, SshTmuxSessionConfig};
use crate::services::tmux::channel_io::{
    build_tmux_command, CapturePaneQueue, ChannelReader, ChannelWriter,
};
use crate::services::tmux::commands::list_windows;
use crate::services::tmux::forwarder::spawn_control_forwarder;
use crate::services::tmux::session::{TmuxSession, TmuxSessionHandles};
use crate::services::tmux::state_tracker::StateTracker;

/// Delay before requesting the initial state sync on an SSH tmux session to
/// give tmux time to enter control mode after the exec channel opens.
const INITIAL_SYNC_DELAY: Duration = Duration::from_millis(500);

/// Create an SSH-backed tmux `-CC` control session.
///
/// Opens an SSH exec channel running `tmux -CC new-session -A -s <target>`,
/// adapts the async tokio channels to synchronous I/O with `ChannelReader` and
/// `ChannelWriter`, and starts the control-mode forwarder.
pub fn create_ssh_tmux_session<B: AppBackend + 'static>(
    backend: B,
    ssh_backend: &dyn SshBackend,
    config: SshTmuxSessionConfig,
    session_id: u32,
) -> Result<TmuxSession, String> {
    let target = config.tmux.target.clone().unwrap_or_else(|| "xsterm".to_string());
    let name = config
        .tmux
        .name
        .clone()
        .unwrap_or_else(|| format!("{}@{}:{}", config.ssh.username, config.ssh.host, config.ssh.port));

    let command = build_tmux_command(
        &config.tmux.command,
        Some(&target),
        config.tmux.socket.as_deref(),
    );

    let SshConnectResult {
        channel,
        write_tx,
        read_rx,
        resize_tx: _,
    } = ssh_backend
        .connect_exec(
            &config.ssh.host,
            config.ssh.port,
            &config.ssh.auth,
            &config.ssh.username,
            &command,
        )
        .map_err(|e| format!("Failed to open SSH exec channel for tmux: {}", e))?;

    let reader = Box::new(ChannelReader::new(read_rx)) as Box<dyn Read + Send>;
    let writer = Arc::new(Mutex::new(
        Box::new(ChannelWriter::new(write_tx)) as Box<dyn Write + Send>,
    ));

    let info = SessionInfo {
        id: session_id,
        name,
        session_type: SessionType::SshTmux {
            host: config.ssh.host.clone(),
            port: config.ssh.port,
            user: config.ssh.username.clone(),
            socket: config.tmux.socket.clone(),
            command: config.tmux.command.clone(),
            target: target.clone(),
        },
        is_connected: true,
    };

    let exited = Arc::new(AtomicBool::new(false));
    let capture_queue: CapturePaneQueue = Arc::new(Mutex::new(VecDeque::new()));

    let session = TmuxSession {
        writer: Arc::clone(&writer),
        exited: Arc::clone(&exited),
        info,
        handles: TmuxSessionHandles {
            child: Mutex::new(None),
            _pair: None,
            _channel: Some(channel),
        },
    };

    schedule_initial_sync(Arc::clone(&writer), &target);

    spawn_control_forwarder(
        reader,
        writer,
        backend,
        session_id,
        Arc::new(StateTracker::new()),
        capture_queue,
        None,
        exited,
    );

    Ok(session)
}

/// Schedule a delayed `list-windows` request so the SSH session has time to
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
