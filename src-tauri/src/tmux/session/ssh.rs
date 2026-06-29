//! SSH exec-channel-backed tmux control mode session creation.
//!
//! This submodule connects to a remote host over SSH, executes `tmux -CC ...`
//! in an exec channel, and wires the channel's async sender/receiver into the
//! synchronous forwarding thread through [`ChannelReader`]/[`ChannelWriter`].

use std::io::Write;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::ssh::{SshBackend, SshConnectResult};
use crate::models::session::{SessionInfo, SessionType, SshTmuxSessionConfig};
use crate::tmux::channel_io::{build_tmux_command, CapturePaneQueue, ChannelReader, ChannelWriter};
use crate::tmux::commands::list_windows;
use crate::tmux::forwarder::spawn_control_forwarder;
use crate::tmux::session::TmuxSession;

/// Create a new tmux control mode session backed by an SSH exec channel.
pub fn create_ssh_tmux_session(
    ssh_backend: &dyn SshBackend,
    config: SshTmuxSessionConfig,
    backend: impl AppBackend + 'static,
    session_id: u32,
) -> Result<TmuxSession, String> {
    let command = build_tmux_command(&config.tmux);
    tracing::info!("tmux session {} SSH tmux command: {}", session_id, command);

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
        .map_err(|e| {
            tracing::error!("tmux session {} SSH connect_exec failed: {}", session_id, e);
            e
        })?;

    tracing::info!("tmux session {} SSH connect_exec succeeded", session_id);

    let writer = Arc::new(Mutex::new(
        Box::new(ChannelWriter::new(write_tx)) as Box<dyn Write + Send>
    ));
    let reader = Box::new(ChannelReader::new(read_rx));

    let info = SessionInfo {
        id: session_id,
        name: config
            .tmux
            .name
            .clone()
            .unwrap_or_else(|| format!("{}@{}", config.ssh.username, config.ssh.host)),
        session_type: SessionType::SshTmux {
            host: config.ssh.host,
            port: config.ssh.port,
            user: config.ssh.username,
            socket: config.tmux.socket.clone(),
            command: config.tmux.command.clone(),
        },
        is_connected: true,
    };

    let exited = Arc::new(AtomicBool::new(false));
    let capture_queue: CapturePaneQueue = Arc::new(Mutex::new(std::collections::VecDeque::new()));

    spawn_control_forwarder(
        reader,
        backend,
        session_id,
        Arc::clone(&exited),
        None,
        Arc::clone(&capture_queue),
    );

    schedule_initial_sync(writer.clone(), session_id);

    Ok(TmuxSession {
        info,
        writer,
        capture_queue,
        exited,
        _ssh_channel: Some(channel),
    })
}

/// Ask tmux for the window list after a short delay, giving attach time to settle.
fn schedule_initial_sync(writer: Arc<Mutex<Box<dyn Write + Send>>>, session_id: u32) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(500));
        if let Ok(mut w) = writer.lock() {
            let cmd = list_windows("$0");
            tracing::debug!(
                "tmux session {} initial sync writing: {:?}",
                session_id,
                cmd.trim()
            );
            let _ = w.write_all(cmd.as_bytes());
            let _ = w.flush();
            tracing::debug!(
                "tmux session {} initial sync sent: {}",
                session_id,
                cmd.trim()
            );
        } else {
            tracing::error!("tmux session {} failed to lock writer for sync", session_id);
        }
    });
}
