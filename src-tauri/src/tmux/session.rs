//! Tmux control mode session lifecycle and I/O forwarding.

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::error::StringError;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::{Child, PtyPair, PtySystem};
use crate::infrastructure::ssh::{SshBackend, SshChannel, SshConnectResult};
use crate::models::session::{SessionInfo, SessionType, SshTmuxSessionConfig, TmuxSessionConfig};
use crate::tmux::channel_io::{
    build_tmux_command, CapturePaneQueue, ChannelReader, ChannelWriter,
};
use crate::tmux::commands::{build_tmux_argv, list_windows};
use crate::tmux::forwarder::spawn_control_forwarder;

/// Active tmux control mode session metadata and write handle.
pub struct TmuxSession {
    pub info: SessionInfo,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    capture_queue: CapturePaneQueue,
    exited: Arc<AtomicBool>,
    _ssh_channel: Option<Box<dyn SshChannel + Send>>,
}

/// Keeps the tmux child process and PTY pair alive for the session lifetime.
pub struct TmuxSessionHandles {
    _child: Arc<Mutex<Box<dyn Child>>>,
    _pair: Box<dyn PtyPair>,
}

impl TmuxSession {
    pub fn write_command(&mut self, command: &str) -> Result<(), String> {
        tracing::debug!("tmux session {} write command: {:?}", self.info.id, command);
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        writer
            .write_all(command.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())
    }

    /// Request an asynchronous capture of a pane's recent history.
    pub fn request_capture_pane(&self,
        pane_id: &str,
        history: usize,
    ) -> Result<(), String> {
        {
            let mut queue = self.capture_queue.lock().map_err(|e| e.to_string())?;
            queue.push_back(pane_id.to_string());
        }
        let command = crate::tmux::commands::capture_pane(pane_id, Some(history), true);
        tracing::debug!(
            "tmux session {} request capture-pane: {:?}",
            self.info.id,
            command.trim()
        );
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        writer
            .write_all(command.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())
    }

    #[allow(dead_code)]
    pub fn is_exited(&self) -> bool {
        self.exited.load(Ordering::Relaxed)
    }
}

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

    let mut cmd = portable_pty::CommandBuilder::new("tmux");
    cmd.arg("-CC");

    if let Some(socket) = &config.socket {
        cmd.arg("-L");
        cmd.arg(socket);
    }

    let argv = build_tmux_argv(&config.command, config.target.as_deref());
    for arg in &argv {
        cmd.arg(arg);
    }

    tracing::info!("tmux session {} spawn argv: tmux -CC {}", session_id, argv.join(" "));

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

    let writer = Arc::new(Mutex::new(Box::new(ChannelWriter::new(write_tx)) as Box<dyn Write + Send>));
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
            tracing::debug!("tmux session {} initial sync writing: {:?}", session_id, cmd.trim());
            let _ = w.write_all(cmd.as_bytes());
            let _ = w.flush();
            tracing::debug!("tmux session {} initial sync sent: {}", session_id, cmd.trim());
        } else {
            tracing::error!("tmux session {} failed to lock writer for sync", session_id);
        }
    });
}

#[cfg(test)]
mod integration_tests {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use super::*;
    use crate::infrastructure::app_backend::AppBackend;
    use crate::infrastructure::pty::NativePtySystem;
    use crate::models::session::TmuxSessionConfig;
    use crate::tmux::commands::list_panes;
    use crate::tmux::state::TmuxControlEvent;

    type EventLog = Vec<(String, Vec<u8>)>;

    #[derive(Clone, Default)]
    struct TestBackend {
        events: Arc<Mutex<EventLog>>,
    }

    impl AppBackend for TestBackend {
        fn emit(&self, event: &str, payload: &[u8]) -> Result<(), String> {
            self.events.lock().unwrap().push((event.to_string(), payload.to_vec()));
            Ok(())
        }

        fn spawn(&self, f: Box<dyn FnOnce() + Send>) {
            std::thread::spawn(f);
        }
    }

    #[test]
    fn real_tmux_session_emits_window_list() {
        if std::process::Command::new("tmux").arg("-V").output().is_err() {
            eprintln!("tmux not installed, skipping integration test");
            return;
        }

        let pty_system = NativePtySystem::new();
        let backend = TestBackend::default();
        let (mut session, _handles) = create_tmux_session(
            &pty_system,
            TmuxSessionConfig {
                name: Some("test".to_string()),
                socket: None,
                command: "new-session".to_string(),
                target: None,
            },
            backend.clone(),
            42,
        )
        .expect("failed to create tmux session");

        let tmux_session_id = wait_for_session_changed(&backend, Duration::from_millis(3000));
        session
            .write_command(&list_windows(&tmux_session_id))
            .expect("failed to write list-windows");

        let window_id = wait_for_window_list(&backend, Duration::from_millis(2000));
        session
            .write_command(&list_panes(&window_id))
            .expect("failed to write list-panes");

        std::thread::sleep(Duration::from_millis(1000));

        let events = backend.events.lock().unwrap();
        let has_output = events.iter().any(|(name, _)| name == "tmux-pane-output");
        let has_sync_request = events.iter().any(|(name, _)| name == "tmux-request-sync");

        let control_events: Vec<TmuxControlEvent> = events
            .iter()
            .filter(|(name, _)| name == "tmux-control-event")
            .map(|(_, payload)| serde_json::from_slice::<(u32, TmuxControlEvent)>(payload).unwrap().1)
            .collect();

        let has_active_window = control_events.iter().any(|e| match e {
            TmuxControlEvent::WindowList { windows } => windows.iter().any(|w| w.active),
            _ => false,
        });

        let has_panes = control_events.iter().any(|e| match e {
            TmuxControlEvent::PaneList { panes } => !panes.is_empty(),
            _ => false,
        });

        assert!(
            !control_events.is_empty() || has_output,
            "expected tmux-control-event or tmux-pane-output, got events: {:?}",
            events.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>()
        );
        assert!(has_sync_request, "expected tmux-request-sync event");
        assert!(
            has_active_window,
            "expected WindowList with active window, got control events: {:?}",
            control_events
        );
        assert!(
            has_panes,
            "expected PaneList with at least one pane, got control events: {:?}",
            control_events
        );
    }

    fn wait_for_window_list(backend: &TestBackend, timeout: Duration) -> String {
        let start = std::time::Instant::now();
        while start.elapsed() < timeout {
            let events = backend.events.lock().unwrap().clone();
            for (name, payload) in &events {
                if name != "tmux-control-event" {
                    continue;
                }
                let (_, control) =
                    serde_json::from_slice::<(u32, TmuxControlEvent)>(payload).unwrap();
                if let TmuxControlEvent::WindowList { windows } = control {
                    if let Some(active) = windows.iter().find(|w| w.active) {
                        return active.window_id.clone();
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("timed out waiting for WindowList with active window");
    }

    fn wait_for_session_changed(backend: &TestBackend, timeout: Duration) -> String {
        let start = std::time::Instant::now();
        while start.elapsed() < timeout {
            let events = backend.events.lock().unwrap().clone();
            for (name, payload) in &events {
                if name != "tmux-control-event" {
                    continue;
                }
                let (_, control) =
                    serde_json::from_slice::<(u32, TmuxControlEvent)>(payload).unwrap();
                if let TmuxControlEvent::SessionChanged { session_id, .. } = control {
                    return session_id;
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("timed out waiting for SessionChanged event");
    }
}
