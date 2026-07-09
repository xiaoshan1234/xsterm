use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::infrastructure::app_backend::AppBackend;
use crate::services::tmux_underlay::commander::TmuxCommander;
use crate::services::tmux_underlay::events::{emit_closed, emit_connection_error, emit_pane_output, emit_state_sync};
use crate::services::tmux_underlay::state::{TmuxPaneOutput, TmuxPaneSnapshot, TmuxSessionSnapshot, TmuxStateSnapshot, TmuxUnderlayState, TmuxWindowSnapshot};
use crate::services::tmux_underlay::underlay_session::{UnderlayReader, UnderlayWriter};

const STRUCTURE_SYNC_INTERVAL: Duration = Duration::from_millis(500);
const PANE_SYNC_INTERVAL: Duration = Duration::from_millis(200);
const COMMAND_TIMEOUT_MS: u64 = 100;

/// Spawn a background thread that polls tmux state and pane output.
///
/// The thread probes for tmux, then loops until `exited` is set to true.
/// It emits `tmux-state-sync` and `tmux-pane-output` events through `backend`.
pub fn spawn_poller(
    reader: Arc<Mutex<UnderlayReader>>,
    writer: Arc<Mutex<UnderlayWriter>>,
    backend: impl AppBackend + 'static,
    session_id: u32,
    state: Arc<Mutex<TmuxUnderlayState>>,
    exited: Arc<AtomicBool>,
) {
    let backend_clone = backend.clone();
    backend.spawn(Box::new(move || {
        let socket = {
            let state = state.lock();
            match state {
                Ok(s) => s.socket.clone(),
                Err(_) => None,
            }
        };
        let commander = TmuxCommander::new(socket.clone());

        tracing::info!(
            "[tmux-debug] spawn_poller: started for session_id={}, socket={:?}",
            session_id, socket
        );

        if let Err(e) = probe_tmux(
            &writer,
            &reader,
            &commander,
            &state,
            session_id,
        ) {
            tracing::error!("tmux underlay {} probe failed: {}", session_id, e);
            let _ = emit_connection_error(&backend_clone, session_id, &e);
            let _ = emit_closed(&backend_clone, session_id);
            return;
        }

        {
            let mut state = state.lock();
            if let Ok(ref mut s) = state {
                s.connected = true;
            }
        }

        tracing::info!("[tmux-debug] spawn_poller: probe succeeded, session_id={}", session_id);

        let mut last_structure_sync = Instant::now();
        let mut last_pane_sync = Instant::now();

        while !exited.load(Ordering::Relaxed) {
            let now = Instant::now();

            if now.duration_since(last_structure_sync) >= STRUCTURE_SYNC_INTERVAL {
                if let Err(e) = sync_structure(
                    &writer,
                    &reader,
                    &commander,
                    &state,
                    session_id,
                    &backend_clone,
                ) {
                    tracing::error!("tmux underlay {} structure sync failed: {}", session_id, e);
                    let _ = emit_connection_error(&backend_clone, session_id, &e);
                }
                last_structure_sync = now;
            }

            if now.duration_since(last_pane_sync) >= PANE_SYNC_INTERVAL {
                let pane_ids = {
                    let state = state.lock();
                    match state {
                        Ok(s) => s.snapshot.panes.keys().cloned().collect::<Vec<_>>(),
                        Err(_) => Vec::new(),
                    }
                };
                for pane_id in pane_ids {
                    if exited.load(Ordering::Relaxed) {
                        break;
                    }
                    if let Err(e) = capture_pane(
                        &writer,
                        &reader,
                        &commander,
                        &pane_id,
                        session_id,
                        &backend_clone,
                    ) {
                        tracing::error!(
                            "tmux underlay {} capture pane {} failed: {}",
                            session_id,
                            pane_id,
                            e
                        );
                    }
                }
                last_pane_sync = now;
            }

            std::thread::sleep(Duration::from_millis(50));
        }

        {
            let mut state = state.lock();
            if let Ok(ref mut s) = state {
                s.connected = false;
            }
        }
        let _ = emit_closed(&backend_clone, session_id);
        tracing::info!("[tmux-debug] spawn_poller: exited, session_id={}", session_id);
    }));
}

fn probe_tmux(
    writer: &Arc<Mutex<UnderlayWriter>>,
    reader: &Arc<Mutex<UnderlayReader>>,
    commander: &TmuxCommander,
    state: &Arc<Mutex<TmuxUnderlayState>>,
    session_id: u32,
) -> Result<(), String> {
    let target = {
        let state = state.lock().map_err(|e| e.to_string())?;
        state.target_session.clone()
    };

    tracing::info!(
        "[tmux-debug] probe_tmux: session_id={}, target={:?}",
        session_id, target
    );

    // Allow the shell to finish starting up before issuing commands.
    std::thread::sleep(Duration::from_millis(300));

    let version_cmd = commander.version();
    let version_output = send_command(writer, reader, &version_cmd, COMMAND_TIMEOUT_MS, false)?;
    tracing::info!(
        "[tmux-debug] probe_tmux: version_cmd={:?}, version_output={:?}",
        version_cmd, version_output
    );
    let has_version = version_output.split("tmux ").skip(1).any(|s| {
        s.chars().next().map(|c| c.is_ascii_digit() || c == 'n').unwrap_or(false)
    });
    if !has_version {
        return Err(format!(
            "tmux is not installed on the underlay session (session {})",
            session_id
        ));
    }

    let has_cmd = commander.has_session(&target);
    let has_output = send_command(writer, reader, &has_cmd, COMMAND_TIMEOUT_MS, false)?;
    tracing::info!(
        "[tmux-debug] probe_tmux: has_cmd={:?}, has_output={:?}",
        has_cmd, has_output
    );
    if has_output.to_lowercase().contains("can't find")
        || has_output.to_lowercase().contains("no such file")
        || has_output.to_lowercase().contains("error")
    {
        return Err(format!(
            "tmux session '{}' does not exist on the underlay session",
            target
        ));
    }

    tracing::info!("[tmux-debug] probe_tmux: session {} probe passed", session_id);
    Ok(())
}

fn sync_structure(
    writer: &Arc<Mutex<UnderlayWriter>>,
    reader: &Arc<Mutex<UnderlayReader>>,
    commander: &TmuxCommander,
    state: &Arc<Mutex<TmuxUnderlayState>>,
    session_id: u32,
    backend: &impl AppBackend,
) -> Result<(), String> {
    let target = {
        let state = state.lock().map_err(|e| e.to_string())?;
        state.target_session.clone()
    };

    tracing::info!("[tmux-debug] sync_structure: session_id={}, target={:?}", session_id, target);

    let windows_cmd = commander.list_windows(&target);
    let windows_output = send_command(writer, reader, &windows_cmd, COMMAND_TIMEOUT_MS, false)?;
    tracing::info!(
        "[tmux-debug] sync_structure: list_windows cmd={:?}, output={:?}",
        windows_cmd, windows_output
    );
    let windows = parse_windows(&windows_output);
    tracing::info!(
        "[tmux-debug] sync_structure: parsed {} windows",
        windows.len()
    );

    let mut panes: Vec<TmuxPaneSnapshot> = Vec::new();
    for window in &windows {
        let panes_cmd = commander.list_panes(&window.id);
        let panes_output = send_command(writer, reader, &panes_cmd, COMMAND_TIMEOUT_MS, false)?;
        tracing::info!(
            "[tmux-debug] sync_structure: list_panes window_id={:?}, cmd={:?}, output={:?}",
            window.id, panes_cmd, panes_output
        );
        panes.extend(parse_panes(&panes_output));
    }

    let mut snapshot = TmuxStateSnapshot::empty();
    if let Some(first_window) = windows.first() {
        snapshot.sessions.insert(
            first_window.session_id.clone(),
            TmuxSessionSnapshot {
                id: first_window.session_id.clone(),
                name: target.clone(),
            },
        );
    }
    for window in &windows {
        snapshot.windows.insert(
            window.id.clone(),
            TmuxWindowSnapshot {
                id: window.id.clone(),
                session_id: window.session_id.clone(),
                name: window.name.clone(),
                active: window.active,
                layout: window.layout.clone(),
            },
        );
    }
    for pane in &panes {
        snapshot.panes.insert(pane.id.clone(), pane.clone());
    }

    {
        let mut state = state.lock().map_err(|e| e.to_string())?;
        state.snapshot = snapshot;
    }

    emit_state_sync(backend, session_id, &state.lock().map_err(|e| e.to_string())?.snapshot)
}

fn capture_pane(
    writer: &Arc<Mutex<UnderlayWriter>>,
    reader: &Arc<Mutex<UnderlayReader>>,
    commander: &TmuxCommander,
    pane_id: &str,
    session_id: u32,
    backend: &impl AppBackend,
) -> Result<(), String> {
    let cmd = commander.capture_pane(pane_id, -250);
    tracing::info!(
        "[tmux-debug] capture_pane: session_id={}, pane_id={:?}, cmd={:?}",
        session_id, pane_id, cmd
    );
    let output = send_command(writer, reader, &cmd, COMMAND_TIMEOUT_MS, true)?;
    if output.is_empty() {
        return Ok(());
    }
    tracing::info!(
        "[tmux-debug] capture_pane: session_id={}, pane_id={:?}, output_len={}",
        session_id, pane_id, output.len()
    );
    let event = TmuxPaneOutput {
        pane_id: pane_id.to_string(),
        data: output.into_bytes(),
    };
    emit_pane_output(backend, session_id, &event)
}

fn send_command(
    writer: &Arc<Mutex<UnderlayWriter>>,
    reader: &Arc<Mutex<UnderlayReader>>,
    command: &str,
    timeout_ms: u64,
    stop_on_idle: bool,
) -> Result<String, String> {
    tracing::info!("[tmux-debug] send_command: sending {:?}", command);
    {
        let writer = writer.lock().map_err(|e| e.to_string())?;
        writer.write_command(command)?;
    }
    let reader = reader.lock().map_err(|e| e.to_string())?;
    let bytes = reader.read_with_timeout(timeout_ms, stop_on_idle)?;
    let output = String::from_utf8_lossy(&bytes).to_string();
    tracing::info!("[tmux-debug] send_command: output={:?}", output);
    Ok(output)
}

fn parse_windows(output: &str) -> Vec<TmuxWindowSnapshot> {
    let mut windows = Vec::new();
    for line in output.lines() {
        let line = strip_ansi_escapes(line.trim());
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(5, '|').collect();
        if parts.len() < 5 || !parts[1].starts_with('@') {
            tracing::info!("[tmux-debug] parse_windows: skipping malformed line {:?} (parts={:?})", line, parts);
            continue;
        }
        windows.push(TmuxWindowSnapshot {
            session_id: parts[0].to_string(),
            id: parts[1].to_string(),
            active: parts[2] == "1",
            layout: parts[3].to_string(),
            name: parts[4].to_string(),
        });
    }
    windows
}

fn parse_panes(output: &str) -> Vec<TmuxPaneSnapshot> {
    let mut panes = Vec::new();
    for line in output.lines() {
        let line = strip_ansi_escapes(line.trim());
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(7, '|').collect();
        if parts.len() < 7 || !parts[2].starts_with('%') {
            tracing::info!("[tmux-debug] parse_panes: skipping malformed line {:?} (parts={:?})", line, parts);
            continue;
        }
        panes.push(TmuxPaneSnapshot {
            session_id: parts[0].to_string(),
            window_id: parts[1].to_string(),
            id: parts[2].to_string(),
            active: parts[3] == "1",
            width: parts[4].parse::<u16>().unwrap_or(80),
            height: parts[5].parse::<u16>().unwrap_or(24),
            title: parts[6].to_string(),
        });
    }
    panes
}

/// Remove ANSI escape sequences (colors, cursor moves, bracketed paste, etc.)
/// from a string so that tmux command output can be parsed reliably.
fn strip_ansi_escapes(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            match chars.next() {
                Some('[') => {
                    while let Some(ch) = chars.next() {
                        if ch.is_ascii() && (ch as u32) >= 0x40 && (ch as u32) <= 0x7E {
                            break;
                        }
                    }
                }
                Some(']') => {
                    while let Some(ch) = chars.next() {
                        if ch == '\u{7}' || ch == '\u{1b}' {
                            if ch == '\u{1b}' {
                                chars.next();
                            }
                            break;
                        }
                    }
                }
                Some('(') => {
                    chars.next();
                }
                Some(_) => {}
                None => break,
            }
        } else {
            result.push(c);
        }
    }
    result
}
