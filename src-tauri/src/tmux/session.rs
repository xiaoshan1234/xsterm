//! Tmux control mode session lifecycle and I/O forwarding.

use std::collections::HashSet;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json;

use crate::error::StringError;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::{Child, PtyPair, PtySystem};
use crate::models::session::{SessionInfo, SessionType, TmuxSessionConfig};
use crate::tmux::commands::{list_panes, list_windows};
use crate::tmux::parser::{TmuxControlParser, TmuxMessage};
use crate::tmux::state::{TmuxControlEvent, TmuxPaneOutput};

const TMUX_READ_BUFFER_SIZE: usize = 8192;

/// Active tmux control mode session metadata and write handle.
pub struct TmuxSession {
    pub info: SessionInfo,
    writer: Box<dyn Write + Send>,
    #[allow(dead_code)]
    exited: Arc<AtomicBool>,
}

/// Keeps the tmux child process and PTY pair alive for the session lifetime.
pub struct TmuxSessionHandles {
    _child: Box<dyn Child>,
    _pair: Box<dyn PtyPair>,
}

impl TmuxSession {
    /// Write a raw tmux command string to the control mode stdin.
    pub fn write_command(&mut self, command: &str) -> Result<(), String> {
        self.writer
            .write_all(command.as_bytes())
            .map_err(|e| e.to_string())?;
        self.writer.flush().map_err(|e| e.to_string())
    }

    /// Returns true if the session has received `%exit` or EOF.
    #[allow(dead_code)]
    pub fn is_exited(&self) -> bool {
        self.exited.load(Ordering::Relaxed)
    }
}

/// Create a new tmux control mode session backed by a local PTY.
///
/// The `command` argument lets callers choose between `new-session`,
/// `attach-session`, or any other tmux subcommand that enters control mode.
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

    cmd.arg(&config.command);
    if let Some(target) = &config.target {
        cmd.arg(target);
    }

    let child = pair.spawn(cmd).map_err_string()?;
    let writer = pair.master_writer().map_err_string()?;
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
    spawn_control_forwarder(reader, backend, session_id, Arc::clone(&exited));

    let handles = TmuxSessionHandles {
        _child: child,
        _pair: pair,
    };

    Ok((
        TmuxSession {
            info,
            writer,
            exited,
        },
        handles,
    ))
}

/// Spawn a background thread that reads tmux control output, parses it, and
/// emits pane outputs and control events to the frontend.
fn spawn_control_forwarder(
    mut reader: Box<dyn Read + Send>,
    backend: impl AppBackend + 'static,
    session_id: u32,
    exited: Arc<AtomicBool>,
) {
    let paused_panes: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    let backend_clone = backend.clone();
    let paused_panes_clone = Arc::clone(&paused_panes);
    backend.spawn(Box::new(move || {
        let mut parser = TmuxControlParser::new();
        let mut buf = [0u8; TMUX_READ_BUFFER_SIZE];

        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    emit_closed(&backend_clone, session_id);
                    break;
                }
                Ok(n) => {
                    let chunk = &buf[..n];
                    for message in parser.parse(chunk) {
                        handle_message(
                            &backend_clone,
                            session_id,
                            &mut parser,
                            message,
                            &exited,
                            &paused_panes_clone,
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

        // Flush any trailing data.
        for message in parser.flush() {
            handle_message(
                &backend_clone,
                session_id,
                &mut parser,
                message,
                &exited,
                &paused_panes_clone,
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
) {
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
            );
        }
        TmuxMessage::CommandResponse { .. } => {
            // TODO: correlate command responses with pending requests for
            // initial state synchronization.
        }
    }
}

fn handle_notification<B: AppBackend>(
    backend: &B,
    session_id: u32,
    name: &str,
    args: Vec<String>,
    raw: &str,
    exited: &Arc<AtomicBool>,
    paused_panes: &Arc<Mutex<HashSet<String>>>,
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
            // The client has attached to a tmux session; request the full
            // window and pane list so the frontend can synchronize its state.
            request_state_sync(backend, session_id);
            TmuxControlEvent::SessionChanged {
                session_id: args[0].clone(),
                name: args[1].clone(),
            }
        }
        "pane-mode-changed" if !args.is_empty() => TmuxControlEvent::PaneModeChanged {
            pane_id: args[0].clone(),
            in_copy_mode: false,
        },
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

fn request_state_sync<B: AppBackend>(backend: &B, session_id: u32) {
    let commands = [
        list_windows("$0"),
        list_panes("@0"),
    ];
    for command in commands {
        let payload = (session_id, command);
        if let Err(e) = backend.emit("tmux-request-sync", &serde_json::to_vec(&payload).unwrap()) {
            tracing::error!("Failed to emit tmux sync request: {}", e);
        }
    }
}

fn emit_pane_output<B: AppBackend>(
    backend: &B,
    session_id: u32,
    pane_id: String,
    data: Vec<u8>,
) {
    let payload = TmuxPaneOutput { pane_id, data };
    let wrapped = (session_id, payload);
    if let Err(e) = backend.emit("tmux-pane-output", &serde_json::to_vec(&wrapped).unwrap()) {
        tracing::error!("Failed to emit tmux pane output: {}", e);
    }
}

fn emit_control_event<B: AppBackend>(
    backend: &B,
    session_id: u32,
    event: TmuxControlEvent,
) {
    let wrapped = (session_id, event);
    if let Err(e) = backend.emit("tmux-control-event", &serde_json::to_vec(&wrapped).unwrap()) {
        tracing::error!("Failed to emit tmux control event: {}", e);
    }
}

fn emit_closed<B: AppBackend>(backend: &B, session_id: u32) {
    let payload = serde_json::to_vec(&session_id).unwrap();
    if let Err(e) = backend.emit("session-closed", &payload) {
        tracing::error!("Failed to emit session closed: {}", e);
    }
}
