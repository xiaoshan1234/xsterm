//! Tmux control mode session lifecycle and shared I/O.
//!
//! This module defines the [`TmuxSession`] handle used by both local PTY and
//! SSH exec-channel sessions. Creation helpers live in the `local` and `ssh`
//! submodules and are re-exported here for callers; shared write methods live
//! on [`TmuxSession`] itself.

mod local;
mod ssh;

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::infrastructure::pty::Child;
use crate::infrastructure::ssh::SshChannel;
use crate::models::session::SessionInfo;
use crate::services::tmux::channel_io::CapturePaneQueue;

pub use local::create_tmux_session;
pub use ssh::create_ssh_tmux_session;

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
    _pair: Box<dyn crate::infrastructure::pty::PtyPair>,
}

impl TmuxSession {
    /// Write a raw command string to the tmux control mode stdin.
    pub fn write_command(&mut self, command: &str) -> Result<(), String> {
        tracing::debug!(
            "tmux session {} write command: {:?} exited={}",
            self.info.id,
            command,
            self.is_exited()
        );
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        writer
            .write_all(command.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())
    }

    /// Request an asynchronous capture of a pane's recent history.
    pub fn request_capture_pane(&self, pane_id: &str, history: usize) -> Result<(), String> {
        {
            let mut queue = self.capture_queue.lock().map_err(|e| e.to_string())?;
            queue.push_back(pane_id.to_string());
        }
        let command = crate::services::tmux::commands::capture_pane(pane_id, Some(history), true);
        tracing::debug!(
            "tmux session {} request capture-pane: {:?} exited={}",
            self.info.id,
            command.trim(),
            self.is_exited()
        );
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        writer
            .write_all(command.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())
    }

    /// Returns `true` if the forwarder has observed an `%exit` notification.
    pub fn is_exited(&self) -> bool {
        self.exited.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod integration_tests {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use super::*;
    use crate::infrastructure::app_backend::AppBackend;
    use crate::infrastructure::pty::NativePtySystem;
    use crate::models::session::TmuxSessionConfig;
    use crate::services::tmux::commands::{list_panes, list_windows};
    use crate::services::tmux::state::TmuxControlEvent;

    type EventLog = Vec<(String, Vec<u8>)>;

    #[derive(Clone, Default)]
    struct TestBackend {
        events: Arc<Mutex<EventLog>>,
    }

    impl AppBackend for TestBackend {
        fn emit(&self, event: &str, payload: &[u8]) -> Result<(), String> {
            self.events
                .lock()
                .unwrap()
                .push((event.to_string(), payload.to_vec()));
            Ok(())
        }

        fn spawn(&self, f: Box<dyn FnOnce() + Send>) {
            std::thread::spawn(f);
        }
    }

    #[test]
    fn real_tmux_session_emits_window_list() {
        if std::process::Command::new("tmux")
            .arg("-V")
            .output()
            .is_err()
        {
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
            .map(|(_, payload)| {
                serde_json::from_slice::<(u32, TmuxControlEvent)>(payload)
                    .unwrap()
                    .1
            })
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
