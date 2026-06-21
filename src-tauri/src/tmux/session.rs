//! Tmux control mode session lifecycle and I/O forwarding.

use std::collections::HashSet;
use std::io::{self, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc as sync_mpsc, Arc, Mutex};

use serde_json;

use crate::error::StringError;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::{Child, PtyPair, PtySystem};
use crate::infrastructure::ssh::{SshBackend, SshChannel, SshConnectResult};
use crate::models::session::{SessionInfo, SessionType, SshTmuxSessionConfig, TmuxSessionConfig};
use crate::tmux::commands::{build_tmux_argv, list_windows};
use crate::tmux::parser::{TmuxControlParser, TmuxMessage};
use crate::tmux::state::{TmuxControlEvent, TmuxPaneOutput};

const TMUX_READ_BUFFER_SIZE: usize = 8192;

/// Active tmux control mode session metadata and write handle.
pub struct TmuxSession {
    pub info: SessionInfo,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    #[allow(dead_code)]
    exited: Arc<AtomicBool>,
    #[allow(dead_code)]
    _ssh_channel: Option<Box<dyn SshChannel + Send>>,
}

/// Keeps the tmux child process and PTY pair alive for the session lifetime.
pub struct TmuxSessionHandles {
    _child: Arc<Mutex<Box<dyn Child>>>,
    _pair: Box<dyn PtyPair>,
}

impl TmuxSession {
    pub fn write_command(&mut self, command: &str) -> Result<(), String> {
        tracing::info!("tmux session {} write command: {:?}", self.info.id, command);
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
        name: config
            .name
            .clone()
            .unwrap_or_else(|| "tmux".to_string()),
        session_type: SessionType::Tmux {
            socket: config.socket.clone(),
            command: config.command.clone(),
        },
        is_connected: true,
    };

    let exited = Arc::new(AtomicBool::new(false));
    let child_for_forwarder: Arc<Mutex<Box<dyn Child>>> = Arc::new(Mutex::new(child));
    spawn_control_forwarder(
        reader,
        backend,
        session_id,
        Arc::clone(&exited),
        Some(Arc::clone(&child_for_forwarder)),
    );

    let handles = TmuxSessionHandles {
        _child: child_for_forwarder,
        _pair: pair,
    };

    Ok((
        TmuxSession {
            info,
            writer,
            exited,
            _ssh_channel: None,
        },
        handles,
    ))
}

struct ChannelWriter {
    tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
}

impl Write for ChannelWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.tx
            .send(buf.to_vec())
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "SSH channel closed"))?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

struct ChannelReader {
    rx: sync_mpsc::Receiver<Option<Vec<u8>>>,
    buffer: Vec<u8>,
    pos: usize,
}

impl Read for ChannelReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.buffer.len() {
            match self.rx.recv() {
                Ok(Some(data)) => {
                    self.buffer = data;
                    self.pos = 0;
                }
                Ok(None) => return Ok(0),
                Err(_) => return Err(io::Error::new(io::ErrorKind::BrokenPipe, "SSH channel closed")),
            }
        }
        let remaining = &self.buffer[self.pos..];
        let to_copy = remaining.len().min(buf.len());
        buf[..to_copy].copy_from_slice(&remaining[..to_copy]);
        self.pos += to_copy;
        Ok(to_copy)
    }
}

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
    } = ssh_backend.connect_exec(
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

    let writer = Arc::new(Mutex::new(Box::new(ChannelWriter { tx: write_tx }) as Box<dyn Write + Send>));
    let reader = Box::new(ChannelReader {
        rx: read_rx,
        buffer: Vec::new(),
        pos: 0,
    });

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
    spawn_control_forwarder(
        reader,
        backend,
        session_id,
        Arc::clone(&exited),
        None,
    );

    let writer_for_sync = Arc::clone(&writer);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if let Ok(mut w) = writer_for_sync.lock() {
            let cmd = list_windows("$0");
            tracing::info!("tmux session {} main-thread sync writing: {:?}", session_id, cmd.trim());
            let _ = w.write_all(cmd.as_bytes());
            let _ = w.flush();
            tracing::info!("tmux session {} main-thread sync sent: {}", session_id, cmd.trim());
        } else {
            tracing::error!("tmux session {} failed to lock writer for sync", session_id);
        }
    });

    Ok(TmuxSession {
        info,
        writer,
        exited,
        _ssh_channel: Some(channel),
    })
}

fn build_tmux_command(config: &TmuxSessionConfig) -> String {
    let mut parts = vec!["tmux".to_string(), "-CC".to_string()];
    if let Some(socket) = &config.socket {
        parts.push("-L".to_string());
        parts.push(socket.clone());
    }
    parts.extend(build_tmux_argv(&config.command, config.target.as_deref()));
    parts.join(" ")
}

pub fn spawn_control_forwarder(
    mut reader: Box<dyn Read + Send>,
    backend: impl AppBackend + 'static,
    session_id: u32,
    exited: Arc<AtomicBool>,
    child: Option<Arc<Mutex<Box<dyn Child>>>>,
) {
    let paused_panes: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    let copy_mode_panes: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    let backend_clone = backend.clone();
    let paused_panes_clone = Arc::clone(&paused_panes);
    let copy_mode_panes_clone = Arc::clone(&copy_mode_panes);
    backend.spawn(Box::new(move || {
        let mut parser = TmuxControlParser::new();
        let mut buf = [0u8; TMUX_READ_BUFFER_SIZE];
        let mut last_child_check = std::time::Instant::now();

        loop {
            if let Some(child_ref) = &child {
                if last_child_check.elapsed().as_secs() >= 1 {
                    last_child_check = std::time::Instant::now();
                    if let Ok(mut c) = child_ref.lock() {
                        match c.try_wait() {
                            Ok(Some(status)) => {
                                tracing::info!(
                                    "tmux session {} child exited with status {:?}",
                                    session_id,
                                    status
                                );
                                emit_closed(&backend_clone, session_id);
                                exited.store(true, Ordering::Relaxed);
                                break;
                            }
                            Ok(None) => {}
                            Err(e) => {
                                tracing::error!(
                                    "tmux session {} try_wait error: {}",
                                    session_id,
                                    e
                                );
                            }
                        }
                    }
                }
            }

            match reader.read(&mut buf) {
                Ok(0) => {
                    emit_closed(&backend_clone, session_id);
                    break;
                }
                Ok(n) => {
                    let chunk = &buf[..n];
                    tracing::info!("tmux session {} read {} bytes", session_id, n);
                    for message in parser.parse(chunk) {
                        tracing::info!("tmux session {} parsed {:?}", session_id, message);
                        handle_message(
                            &backend_clone,
                            session_id,
                            &mut parser,
                            message,
                            &exited,
                            &paused_panes_clone,
                            &copy_mode_panes_clone,
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
                &mut parser,
                message,
                &exited,
                &paused_panes_clone,
                &copy_mode_panes_clone,
            );
        }

        exited.store(true, Ordering::Relaxed);
    }));
}

fn handle_message<B: AppBackend>(
    backend: &B,
    session_id: u32,
    _parser: &mut TmuxControlParser,
    message: TmuxMessage,
    exited: &Arc<AtomicBool>,
    paused_panes: &Arc<Mutex<HashSet<String>>>,
    copy_mode_panes: &Arc<Mutex<HashSet<String>>>,
) {
    tracing::info!("tmux session {} handle message {:?}", session_id, message);
    match message {
        TmuxMessage::Output { pane_id, data }
        | TmuxMessage::ExtendedOutput { pane_id, data, .. } => {
            let is_paused = paused_panes
                .lock()
                .map(|set| set.contains(&pane_id))
                .unwrap_or(false);
            if !is_paused {
                emit_pane_output(backend, session_id, pane_id, data);
            }
        }
        TmuxMessage::Notification { name, args, raw } => {
            handle_notification(
                backend,
                session_id,
                &name,
                args,
                &raw,
                exited,
                paused_panes,
                copy_mode_panes,
            );
        }
        TmuxMessage::WindowList(windows) => {
            emit_control_event(
                backend,
                session_id,
                TmuxControlEvent::WindowList {
                    windows: windows.into_iter().map(Into::into).collect(),
                },
            );
        }
        TmuxMessage::PaneList(panes) => {
            emit_control_event(
                backend,
                session_id,
                TmuxControlEvent::PaneList {
                    panes: panes.into_iter().map(Into::into).collect(),
                },
            );
        }
        TmuxMessage::CommandResponse {
            cmd_num,
            success,
            lines,
            ..
        } => {
            if !success {
                let message = lines.join("\n");
                emit_control_event(
                    backend,
                    session_id,
                    TmuxControlEvent::CommandError { cmd_num, message },
                );
            }
        }
        TmuxMessage::Unknown { raw } => {
            tracing::info!("tmux session {} unknown line: {}", session_id, raw);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_notification<B: AppBackend>(
    backend: &B,
    session_id: u32,
    name: &str,
    args: Vec<String>,
    raw: &str,
    exited: &Arc<AtomicBool>,
    paused_panes: &Arc<Mutex<HashSet<String>>>,
    copy_mode_panes: &Arc<Mutex<HashSet<String>>>,
) {
    let event = match name {
        "pause" if !args.is_empty() => {
            let pane_id = args[0].clone();
            if let Ok(mut set) = paused_panes.lock() {
                set.insert(pane_id.clone());
            }
            TmuxControlEvent::PanePaused { pane_id }
        }
        "continue" if !args.is_empty() => {
            let pane_id = args[0].clone();
            if let Ok(mut set) = paused_panes.lock() {
                set.remove(&pane_id);
            }
            TmuxControlEvent::PaneContinued { pane_id }
        }
        "session-changed" if args.len() >= 2 => {
            request_state_sync(backend, session_id, &args[0]);
            TmuxControlEvent::SessionChanged {
                session_id: args[0].clone(),
                name: args[1].clone(),
            }
        }
        "window-add" if !args.is_empty() => {
            request_state_sync(backend, session_id, "$0");
            TmuxControlEvent::Unknown { raw: raw.to_string() }
        }
        "window-closed" if !args.is_empty() => TmuxControlEvent::WindowClosed {
            window_id: args[0].clone(),
        },
        "window-renamed" if args.len() >= 2 => TmuxControlEvent::WindowRenamed {
            window_id: args[0].clone(),
            name: args[1].clone(),
        },
        "layout-changed" if args.len() >= 2 => TmuxControlEvent::LayoutChanged {
            window_id: args[0].clone(),
            layout: args[1].clone(),
        },
        "pane-added" if !args.is_empty() => {
            request_state_sync(backend, session_id, "$0");
            TmuxControlEvent::Unknown { raw: raw.to_string() }
        }
        "pane-closed" if !args.is_empty() => TmuxControlEvent::PaneClosed {
            pane_id: args[0].clone(),
        },
        "pane-title-changed" if args.len() >= 2 => TmuxControlEvent::PaneTitleChanged {
            pane_id: args[0].clone(),
            title: args[1..].join(" "),
        },
        "pane-mode-changed" if !args.is_empty() => {
            let pane_id = args[0].clone();
            let in_copy_mode = if let Ok(mut set) = copy_mode_panes.lock() {
                if set.contains(&pane_id) {
                    set.remove(&pane_id);
                    false
                } else {
                    set.insert(pane_id.clone());
                    true
                }
            } else {
                false
            };
            TmuxControlEvent::PaneModeChanged {
                pane_id,
                in_copy_mode,
            }
        }
        "exit" => {
            exited.store(true, Ordering::Relaxed);
            TmuxControlEvent::Exit {
                reason: args.first().cloned(),
            }
        }
        _ => TmuxControlEvent::Unknown {
            raw: raw.to_string(),
        },
    };

    emit_control_event(backend, session_id, event);
}

fn request_state_sync<B: AppBackend>(backend: &B, session_id: u32, tmux_session_id: &str) {
    let command = list_windows(tmux_session_id);
    tracing::info!("tmux session {} requesting state sync: {}", session_id, command.trim());
    let payload = (session_id, command);
    if let Err(e) = backend.emit("tmux-request-sync", &serde_json::to_vec(&payload).unwrap()) {
        tracing::error!("Failed to emit tmux sync request: {}", e);
    }
}

fn emit_event<B: AppBackend, T: serde::Serialize>(
    backend: &B,
    event_name: &str,
    session_id: u32,
    payload: &T,
) {
    let wrapped = (session_id, payload);
    if let Err(e) = backend.emit(event_name, &serde_json::to_vec(&wrapped).unwrap()) {
        tracing::error!("Failed to emit {}: {}", event_name, e);
    }
}

fn emit_pane_output<B: AppBackend>(
    backend: &B,
    session_id: u32,
    pane_id: String,
    data: Vec<u8>,
) {
    let output = TmuxPaneOutput { pane_id, data };
    emit_event(backend, "tmux-pane-output", session_id, &output);
}

fn emit_control_event<B: AppBackend>(
    backend: &B,
    session_id: u32,
    event: TmuxControlEvent,
) {
    emit_event(backend, "tmux-control-event", session_id, &event);
}

fn emit_closed<B: AppBackend>(backend: &B, session_id: u32) {
    emit_event(backend, "session-closed", session_id, &session_id);
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
